import type { DatabaseServices } from "@repo/database/core/query";
import { readDescriptionAttachment } from "@repo/database/models/description-attachments";
import { LINK_ORIGIN } from "@repo/features/link-home";
import { type Picture, type PictureType, pictureTypeSchema } from "@repo/features/picture-wire";
import { descriptionAttachmentOf } from "@repo/features/description-attachment-link";
import { type UnparsedWireValue, unparsedWire } from "@repo/wire";
import { describeWire, readEither } from "@repo/wire/effect";
import { Effect, Option, Result, Schema } from "effect";
import { Base64 } from "effect/encoding";
import { AGENT_TOOL } from "../agents/agent-runtime/tools.js";
import { logStoreFailure } from "../http/store-failure.js";
import type { DescriptionDocumentBinding } from "./description-notes.js";

const PICTURE_LOOK = {
  MAX_ADDRESS_CHARS: 512,
} as const;

export const PICTURE_LOOK_REFUSAL = {
  UNREADABLE: "Not looked: name the picture by its address, copied from the description's text.",
  ELSEWHERE: "Not looked: that address is not a picture in a description of your workspace.",
  NO_PICTURE: "Not looked: that description holds no such picture.",
  VIDEO:
    "Not looked: that address is a video, which is never shown to a model. Its alt text and caption in the description's text say what it shows.",
  UNAVAILABLE: "Not looked: the picture could not be read just now. The call may be made again.",
  OFF: "Not looked: your developer has Descriptions off, so no description's picture is shown.",
} as const;

export const PICTURE_LOOK_STATUS = {
  LOOKED: "looked",
  NOT_LOOKED: "not-looked",
} as const;

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
    `The picture's address exactly as the description's text writes it, inside its ![alt](address): ${LINK_ORIGIN}/<workspace>/task/<task>/files/<picture>, or under /plan/ in place of /task/ for a picture written before the rename.`,
  ),
});

const readInput = readEither(LOOK_INPUT);

export const LOOK_AT_PICTURE_TOOL = {
  name: AGENT_TOOL.LOOK_AT_PICTURE,
  description:
    "See one of the pictures in a description of your workspace, your own task's or another's, such as a " +
    "screenshot or a mockup, by the address its description's text writes it at. Every picture " +
    'is written in the description as ![alt text](address "caption"), and its alt text and caption ' +
    "already say what it shows: look only when they do not tell you enough for what you are " +
    "doing. Answers the picture, or `not-looked` and why.",
  inputSchema: LOOK_INPUT,
} as const;

export function lookedTaskOf(input: UnparsedWireValue): string | undefined {
  const read = readInput(input);
  return Result.isSuccess(read)
    ? descriptionAttachmentOf(read.success.address.trim())?.taskId
    : undefined;
}

export function pictureNotLooked(reason: string): PictureLookResult {
  return { status: PICTURE_LOOK_STATUS.NOT_LOOKED, reason };
}

const isImageType = Schema.is(pictureTypeSchema);

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

export function runLookAtPicture(
  description: DescriptionDocumentBinding,
  input: UnparsedWireValue,
): Effect.Effect<PictureLookResult, never, DatabaseServices> {
  const read = readInput(input);
  if (Result.isFailure(read))
    return Effect.succeed(pictureNotLooked(PICTURE_LOOK_REFUSAL.UNREADABLE));
  const named = descriptionAttachmentOf(read.success.address.trim());
  if (named === undefined || named.taskId !== description.taskId) {
    return Effect.succeed(pictureNotLooked(PICTURE_LOOK_REFUSAL.ELSEWHERE));
  }
  return readDescriptionAttachment(description.userId, description.taskId, named.attachmentId).pipe(
    Effect.map((picture) =>
      Option.isNone(picture)
        ? pictureNotLooked(PICTURE_LOOK_REFUSAL.NO_PICTURE)
        : looked(picture.value),
    ),
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(pictureNotLooked(PICTURE_LOOK_REFUSAL.UNAVAILABLE))),
  );
}

const LookedSchema = Schema.Struct({ status: Schema.Literal(PICTURE_LOOK_STATUS.LOOKED) });

const isLookedStatus = Schema.is(LookedSchema);

const isLooked = Schema.is(
  Schema.Struct({ ...LookedSchema.fields, mediaType: pictureTypeSchema, image: Schema.String }),
);

export function lookNamedOnly(output: UnparsedWireValue): UnparsedWireValue {
  return isLookedStatus(output) && !isLooked(output)
    ? unparsedWire(pictureNotLooked(PICTURE_LOOK_REFUSAL.VIDEO))
    : output;
}
