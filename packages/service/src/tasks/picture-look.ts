import type { DatabaseServices } from "@luke/database/core/query";
import { readPlanAttachment } from "@luke/database/models/plan-attachments";
import { type Picture, type PictureType, pictureTypeSchema } from "@luke/features/picture-wire";
import { planAttachmentOf } from "@luke/features/plan-attachment-link";
import { type UnparsedWireValue, unparsedWire } from "@luke/wire";
import { describeWire, readEither } from "@luke/wire/effect";
import { Effect, Option, Result, Schema } from "effect";
import { Base64 } from "effect/encoding";
import type { ToolModelOutput } from "eve/tools";
import { AGENT_TOOL } from "../agents/agent-runtime/tools.js";
import { logStoreFailure } from "../http/store-failure.js";
import type { PlanDocumentBinding } from "./plan-notes.js";

/**
 * picture-look.ts -- `look_at_picture`, a model's eyes on one of the plan's pictures: the picture its text names, handed back as an image.
 *
 * A picture stands in a plan's text as `![alt](<address> "caption")`
 * (`@luke/features/plan-attachment-link`), so every model that reads the
 * plan, the planning model's turn and a coding agent's brief alike, already
 * reads what each picture shows in its alt text and caption. Most never need
 * more, and a picture is a large cost in a model's context, so the picture
 * itself is not sent with the plan: the model names one by its address when
 * the words are not enough, as the planning model looks at its whiteboard
 * (`board-look.ts`).
 *
 * The picture is read as the account the turn runs as, through the plan's
 * membership gate (`readPlanAttachment`), and only under the plan the
 * conversation is on, never the plan an address names: an address of
 * another plan, or of a picture this plan does not hold, is refused alike.
 *
 * A plan may hold a video an agent recorded, which no model is handed in any
 * form: a look at one is refused, pointing the model at its alt text and
 * caption, and both of the model's views, eve's here and the MCP door's,
 * hand on a look only of an image's type, turning any other into that
 * refusal (`lookNamedOnly`), so a video could not reach a model even were
 * it answered, as an image nor as its base64 spelled out.
 *
 * An image reaches the model as an image (`pictureLookModelOutput`),
 * never as its base64 spelled out as text, and stays out of the
 * conversation's stored messages (`storedPictureLookOutput`), which keep
 * only that the model looked: what the model saw once is no record of the
 * plan, and the plan keeps the picture already.
 *
 * The result and its two views name a picture and nothing of a plan, so a
 * look at any other picture Luke keeps answers in the same words.
 */

const PICTURE_LOOK = {
  /** The longest address a call may name; a picture's address is well under it. */
  MAX_ADDRESS_CHARS: 512,
} as const;

/** Why a call shows nothing, in words the model can act on. */
export const PICTURE_LOOK_REFUSAL = {
  UNREADABLE: "Not looked: name the picture by its address, copied from the plan's text.",
  ELSEWHERE: "Not looked: that address is not a picture in this task's plan.",
  NO_PICTURE: "Not looked: this task's plan holds no such picture.",
  VIDEO:
    "Not looked: that address is a video, which is never shown to a model. Its alt text and caption in the plan's text say what it shows.",
  TASKLESS: "Not looked: you work on no task, so there is no plan to look in.",
  UNAVAILABLE: "Not looked: the picture could not be read just now. The call may be made again.",
} as const;

export const PICTURE_LOOK_STATUS = {
  LOOKED: "looked",
  NOT_LOOKED: "not-looked",
} as const;

// A type rather than an interface, so a result is a `WireRecord` the model is handed as it stands.
export type PictureLookResult =
  | {
      readonly status: typeof PICTURE_LOOK_STATUS.LOOKED;
      readonly mediaType: PictureType;
      readonly image: string;
    }
  | { readonly status: typeof PICTURE_LOOK_STATUS.NOT_LOOKED; readonly reason: string };

const LOOK_INPUT = Schema.Struct({
  address: describeWire(
    Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(PICTURE_LOOK.MAX_ADDRESS_CHARS)),
    "The picture's address exactly as the plan's text writes it, inside its ![alt](address): https://tryluke.dev/<workspace>/plan/<plan>/files/<picture>.",
  ),
});

const readInput = readEither(LOOK_INPUT);

/** The tool as a planning model and a coding agent are offered it: its name, its words, and its input schema. */
export const LOOK_AT_PICTURE_TOOL = {
  name: AGENT_TOOL.LOOK_AT_PICTURE,
  description:
    "See one of the pictures in the task's plan, such as a screenshot or a mockup. Every picture " +
    'is written in the plan as ![alt text](address "caption"), and its alt text and caption ' +
    "already say what it shows: look only when they do not tell you enough for what you are " +
    "doing. Answers the picture, or `not-looked` and why.",
  inputSchema: LOOK_INPUT,
} as const;

/** A call that showed nothing, and why. */
export function pictureNotLooked(reason: string): PictureLookResult {
  return { status: PICTURE_LOOK_STATUS.NOT_LOOKED, reason };
}

const isImageType = Schema.is(pictureTypeSchema);

/** A picture as a look answers it: an image's type and its bytes in base64, or the refusal of a video, whose bytes go nowhere. */
function looked(picture: Picture): PictureLookResult {
  if (!isImageType(picture.contentType)) {
    return pictureNotLooked(PICTURE_LOOK_REFUSAL.VIDEO);
  }
  return {
    status: PICTURE_LOOK_STATUS.LOOKED,
    mediaType: picture.contentType,
    image: Base64.encode(picture.bytes),
  };
}

/**
 * One call of `look_at_picture`: the picture the address names, where it is
 * an image of the plan the call is bound to that the account reads;
 * `not-looked` and why otherwise, a video among them.
 */
export function runLookAtPicture(
  plan: PlanDocumentBinding,
  input: UnparsedWireValue,
): Effect.Effect<PictureLookResult, never, DatabaseServices> {
  const read = readInput(input);
  if (Result.isFailure(read))
    return Effect.succeed(pictureNotLooked(PICTURE_LOOK_REFUSAL.UNREADABLE));
  const named = planAttachmentOf(read.success.address.trim());
  if (named === undefined || named.taskId !== plan.taskId) {
    return Effect.succeed(pictureNotLooked(PICTURE_LOOK_REFUSAL.ELSEWHERE));
  }
  return readPlanAttachment(plan.userId, plan.taskId, named.attachmentId).pipe(
    Effect.map((picture) =>
      Option.isNone(picture)
        ? pictureNotLooked(PICTURE_LOOK_REFUSAL.NO_PICTURE)
        : looked(picture.value),
    ),
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(pictureNotLooked(PICTURE_LOOK_REFUSAL.UNAVAILABLE))),
  );
}

/** A look that answered a picture, as the store's view reads one: by its status alone, so nothing of a picture is kept whatever else it carries. */
const LookedSchema = Schema.Struct({ status: Schema.Literal(PICTURE_LOOK_STATUS.LOOKED) });

const isLookedStatus = Schema.is(LookedSchema);

/** A look's picture, as the model's view reads one: an image's type alone. */
const isLooked = Schema.is(
  Schema.Struct({ ...LookedSchema.fields, mediaType: pictureTypeSchema, image: Schema.String }),
);

/**
 * A result that is no image's look, as a model may be handed it: a look
 * answering anything but an image becomes the video's refusal, so what
 * else it carries never reaches a model as text, and any other result
 * stands as it is.
 */
export function lookNamedOnly(output: UnparsedWireValue): UnparsedWireValue {
  return isLookedStatus(output) && !isLooked(output)
    ? unparsedWire(pictureNotLooked(PICTURE_LOOK_REFUSAL.VIDEO))
    : output;
}

/**
 * What the model is shown of a call's result: a look's picture as an image,
 * and anything else as the JSON it is. Note that the output is eve's literal
 * shape, spelled here rather than built with eve's helpers, because this
 * module is in every function's bundle and eve's runtime belongs in none.
 */
export function pictureLookModelOutput(output: UnparsedWireValue): ToolModelOutput {
  if (!isLooked(output)) return { type: "json", value: lookNamedOnly(output) };
  return {
    type: "content",
    value: [
      { type: "text", text: "The picture you asked to see:" },
      { type: "file", data: { type: "data", data: output.image }, mediaType: output.mediaType },
    ],
  };
}

/** A call's result as the conversation keeps it: a look's status without its picture. */
export function storedPictureLookOutput(output: UnparsedWireValue): UnparsedWireValue {
  return isLookedStatus(output) ? unparsedWire({ status: output.status }) : output;
}
