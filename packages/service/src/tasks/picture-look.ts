import type { DatabaseServices } from "@repo/database/core/query";
import { readDescriptionAttachment } from "@repo/database/models/description-attachments";
import { descriptionAttachmentOf } from "@repo/features/description-attachment-link";
import { LINK_ORIGIN } from "@repo/features/link-home";
import { type Picture, type PictureType, pictureTypeSchema } from "@repo/features/picture-wire";
import { type UnparsedWireValue, unparsedWire } from "@repo/wire";
import { describeWire, readEither } from "@repo/wire/effect";
import { Effect, Option, Result, Schema } from "effect";
import { Base64 } from "effect/encoding";
import { AGENT_TOOL } from "../agents/agent-runtime/tools.js";
import { logStoreFailure } from "../http/store-failure.js";
import type { DescriptionDocumentBinding } from "./description-notes.js";

/**
 * picture-look.ts -- `look_at_picture`, a model's eyes on one of the plan's pictures: the picture its text names, handed back as an image.
 *
 * A picture stands in a plan's text as `![alt](<address> "caption")`
 * (`@repo/features/description-attachment-link`), so every model that reads the
 * plan, the planning model's turn and a coding agent's brief alike, already
 * reads what each picture shows in its alt text and caption. Most never need
 * more, and a picture is a large cost in a model's context, so the picture
 * itself is not sent with the plan: the model names one by its address when
 * the words are not enough.
 *
 * The picture is read as the account the turn runs as, through the plan's
 * membership gate (`readDescriptionAttachment`), and only under the plan the call
 * is bound to: an address of another plan, or of a picture that plan does
 * not hold, is refused alike. A coding agent's door binds a call to the
 * plan its address names (`lookedTaskOf`), once that plan stands in the
 * agent's own workspace (`../agents/coder-host/agent-doors.ts`), so an
 * agent sees a picture in any plan of its workspace, its own task's or
 * another's, and one on no task sees one too.
 *
 * A plan may hold a video an agent recorded, which no model is handed in any
 * form: a look at one is refused, pointing the model at its alt text and
 * caption, and the MCP door hands on a look only of an image's type,
 * turning any other into that refusal (`lookNamedOnly`), so a video could
 * not reach a model even were it answered, as an image nor as its base64
 * spelled out.
 *
 * The result and its view name a picture and nothing of a plan, so a
 * look at any other picture we keep answers in the same words.
 */

const PICTURE_LOOK = {
  /** The longest address a call may name; a picture's address is well under it. */
  MAX_ADDRESS_CHARS: 512,
} as const;

/** Why a call shows nothing, in words the model can act on. */
export const PICTURE_LOOK_REFUSAL = {
  UNREADABLE: "Not looked: name the picture by its address, copied from the plan's text.",
  ELSEWHERE: "Not looked: that address is not a picture in a plan of your workspace.",
  NO_PICTURE: "Not looked: that plan holds no such picture.",
  VIDEO:
    "Not looked: that address is a video, which is never shown to a model. Its alt text and caption in the plan's text say what it shows.",
  UNAVAILABLE: "Not looked: the picture could not be read just now. The call may be made again.",
  OFF: "Not looked: your developer has Plans off, so no plan's picture is shown.",
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
    `The picture's address exactly as the plan's text writes it, inside its ![alt](address): ${LINK_ORIGIN}/<workspace>/plan/<plan>/files/<picture>.`,
  ),
});

const readInput = readEither(LOOK_INPUT);

/** The tool as a planning model and a coding agent are offered it: its name, its words, and its input schema. */
export const LOOK_AT_PICTURE_TOOL = {
  name: AGENT_TOOL.LOOK_AT_PICTURE,
  description:
    "See one of the pictures in a plan of your workspace, your own task's or another's, such as a " +
    "screenshot or a mockup, by the address its plan's text writes it at. Every picture " +
    'is written in the plan as ![alt text](address "caption"), and its alt text and caption ' +
    "already say what it shows: look only when they do not tell you enough for what you are " +
    "doing. Answers the picture, or `not-looked` and why.",
  inputSchema: LOOK_INPUT,
} as const;

/** The plan a call's address names, whose picture it looks at; nothing where the call names no picture's address. */
export function lookedTaskOf(input: UnparsedWireValue): string | undefined {
  const read = readInput(input);
  return Result.isSuccess(read)
    ? descriptionAttachmentOf(read.success.address.trim())?.taskId
    : undefined;
}

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
  plan: DescriptionDocumentBinding,
  input: UnparsedWireValue,
): Effect.Effect<PictureLookResult, never, DatabaseServices> {
  const read = readInput(input);
  if (Result.isFailure(read))
    return Effect.succeed(pictureNotLooked(PICTURE_LOOK_REFUSAL.UNREADABLE));
  const named = descriptionAttachmentOf(read.success.address.trim());
  if (named === undefined || named.taskId !== plan.taskId) {
    return Effect.succeed(pictureNotLooked(PICTURE_LOOK_REFUSAL.ELSEWHERE));
  }
  return readDescriptionAttachment(plan.userId, plan.taskId, named.attachmentId).pipe(
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
