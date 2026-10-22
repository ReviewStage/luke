import type { DatabaseServices } from "@luke/database/core/query";
import {
  type ChatMemberSubject,
  joinedMemberOf,
  readAttachmentFor,
} from "@luke/database/models/chat-store";
import { readConversationPicture } from "@luke/database/models/conversation-pictures";
import {
  CODING_AGENT_ATTACHMENT_TYPE,
  CODING_AGENT_BOUNDS,
  type CodingAgentAttachment,
} from "@luke/features/coding-agent-wire";
import { isVideoType } from "@luke/features/conversation-picture-wire";
import type { InboxImageType } from "@luke/features/inbox-wire";
import { Effect, Option, Result } from "effect";
import type { StoreFailure } from "../../http/store-failure.js";
import { AGENT_TOOL } from "../agent-runtime/tools.js";

/**
 * forwarded-images.ts -- pictures one agent hands another by their attachment ids, read as the forwarder may read them and made the files a Start or a steer carries.
 *
 * An id names a row of the one `attachment` table, and a forwarder may hand
 * on two kinds of row: a picture kept beside its own conversation
 * (`conversation-pictures.ts`), such as one `show_image` kept, and a
 * picture of a chat message it can read, as its reads of the chat scope it
 * (`chat-store.ts`'s `readAttachmentFor`): a coding agent its home channel
 * and the DMs it is one of, a person every channel. Any other id, another
 * conversation's picture or a DM the forwarder is not in among them, is
 * refused alike, so a refusal never says that a picture stands where the
 * forwarder cannot read it. A video kept beside the conversation, as
 * `show_image` keeps a recording, is refused by name, since a message
 * carries pictures alone. Each picture is held to the bound one image of
 * a message is held to, and all of them to a message's bytes together
 * (`CODING_AGENT_BOUNDS`); one past them is refused rather than shrunk,
 * since a `show_image` picture may be larger than a message takes. A
 * forwarded file is named by its id and its type's extension, never by a
 * path, so nothing of where it came from travels with it. The call refused
 * hands on nothing: the first id refused refuses them all.
 */

/** Why a forward handed on nothing. */
export const FORWARDED_IMAGE_REFUSAL = {
  /** The id names no picture the forwarder may hand on. */
  UNREACHED: "unreached",
  /** The id names a video the forwarder recorded, which no message carries as a file. */
  VIDEO: "video",
  /** The picture is past one image's bound. */
  TOO_LARGE: "too-large",
  /** The pictures together are past one message's bound. */
  TOO_MUCH: "too-much",
} as const;

export type ForwardedImageRefusal =
  | { readonly kind: typeof FORWARDED_IMAGE_REFUSAL.UNREACHED; readonly id: string }
  | { readonly kind: typeof FORWARDED_IMAGE_REFUSAL.VIDEO; readonly id: string }
  | {
      readonly kind: typeof FORWARDED_IMAGE_REFUSAL.TOO_LARGE;
      readonly id: string;
      readonly bytes: number;
    }
  | { readonly kind: typeof FORWARDED_IMAGE_REFUSAL.TOO_MUCH; readonly bytes: number };

/**
 * Who forwards: the account acting; the conversation whose own pictures it
 * may name, none for a caller with none; and the workspace's chat it reads
 * and the member it reads as, none where it reads no chat.
 */
export interface ImageForwarder {
  readonly userId: string;
  readonly conversationId: string | undefined;
  readonly chat:
    | { readonly organizationId: string; readonly reader: ChatMemberSubject }
    | undefined;
}

/** The extension a forwarded file is named with, by its type. */
const IMAGE_EXTENSION = {
  [CODING_AGENT_ATTACHMENT_TYPE.PNG]: "png",
  [CODING_AGENT_ATTACHMENT_TYPE.JPEG]: "jpg",
  [CODING_AGENT_ATTACHMENT_TYPE.WEBP]: "webp",
} as const satisfies Record<InboxImageType, string>;

/** Megabytes as a refusal says them, rounded up to a tenth so a picture just past a bound never reads as at it. */
function megabytes(bytes: number): string {
  return `${Math.ceil(bytes / 100_000) / 10} MB`;
}

/** The picture under the id as the forwarder may read it: its conversation's own first, then a chat message's; nothing otherwise. */
const pictureOf = (forwarder: ImageForwarder, readerId: string | undefined, id: string) =>
  Effect.gen(function* () {
    if (forwarder.conversationId !== undefined) {
      const own = yield* readConversationPicture(forwarder.conversationId, id);
      if (Option.isSome(own)) return own;
    }
    if (forwarder.chat === undefined || readerId === undefined) return Option.none();
    const { organizationId } = forwarder.chat;
    return yield* readAttachmentFor(forwarder.userId, organizationId, readerId, id);
  });

/** The member the forwarder reads the chat as, never made; none where it reads no chat or holds no seat in it. */
const readerOf = (forwarder: ImageForwarder) =>
  forwarder.chat === undefined
    ? Effect.succeed(undefined)
    : Effect.map(
        joinedMemberOf(forwarder.userId, forwarder.chat.organizationId, forwarder.chat.reader),
        (member) => Option.getOrUndefined(Option.map(member, (row) => row.id)),
      );

/**
 * The pictures under the ids, in the order named, each once, as the files
 * a Start or a steer carries; or why none is handed on: an id the forwarder
 * may not hand on, a picture past one image's bound, or pictures past one
 * message's bytes together.
 */
export function forwardedImages(
  forwarder: ImageForwarder,
  ids: readonly string[],
): Effect.Effect<
  Result.Result<readonly CodingAgentAttachment[], ForwardedImageRefusal>,
  StoreFailure,
  DatabaseServices
> {
  return Effect.gen(function* () {
    const named = [...new Set(ids)];
    if (named.length === 0) return Result.succeed([]);
    const readerId = yield* readerOf(forwarder);
    const files: CodingAgentAttachment[] = [];
    let total = 0;
    for (const id of named) {
      const picture = yield* pictureOf(forwarder, readerId, id);
      if (Option.isNone(picture)) {
        return Result.fail({ kind: FORWARDED_IMAGE_REFUSAL.UNREACHED, id });
      }
      const { contentType, bytes } = picture.value;
      if (isVideoType(contentType)) return Result.fail({ kind: FORWARDED_IMAGE_REFUSAL.VIDEO, id });
      if (bytes.byteLength > CODING_AGENT_BOUNDS.MAX_IMAGE_BYTES) {
        return Result.fail({
          kind: FORWARDED_IMAGE_REFUSAL.TOO_LARGE,
          id,
          bytes: bytes.byteLength,
        });
      }
      total += bytes.byteLength;
      files.push({
        name: `${id}.${IMAGE_EXTENSION[contentType]}`,
        mediaType: contentType,
        data: Buffer.from(bytes).toString("base64"),
      });
    }
    if (total > CODING_AGENT_BOUNDS.MAX_ATTACHMENTS_BYTES) {
      return Result.fail({ kind: FORWARDED_IMAGE_REFUSAL.TOO_MUCH, bytes: total });
    }
    return Result.succeed(files);
  });
}

/** Why a forward handed on nothing, as a sentence the model can act on, after the words its tool opens a refusal with. */
export function forwardedImageRefusalWords(refusal: ForwardedImageRefusal): string {
  switch (refusal.kind) {
    case FORWARDED_IMAGE_REFUSAL.UNREACHED:
      return (
        `attachment ${refusal.id} is no picture you can hand on. Name a picture of your own ` +
        `conversation, such as one ${AGENT_TOOL.SHOW_IMAGE} kept, or one of a chat message you can read.`
      );
    case FORWARDED_IMAGE_REFUSAL.VIDEO:
      return (
        `attachment ${refusal.id} is a video, and only a picture, a PNG, JPEG, or WebP, is ` +
        "handed to another agent."
      );
    case FORWARDED_IMAGE_REFUSAL.TOO_LARGE:
      return (
        `attachment ${refusal.id} is ${megabytes(refusal.bytes)}, past the ` +
        `${megabytes(CODING_AGENT_BOUNDS.MAX_IMAGE_BYTES)} an image handed to another agent may ` +
        "be. It is not made smaller for you: hand on a smaller picture."
      );
    case FORWARDED_IMAGE_REFUSAL.TOO_MUCH:
      return (
        `the images come to ${megabytes(refusal.bytes)} together, past the ` +
        `${megabytes(CODING_AGENT_BOUNDS.MAX_ATTACHMENTS_BYTES)} one message may carry: hand on fewer.`
      );
  }
}
