import type { DatabaseServices } from "@repo/database/core/query";
import { readConversationPicture } from "@repo/database/models/conversation-pictures";
import {
  AGENT_ATTACHMENT_TYPE,
  AGENT_BOUNDS,
  type AgentAttachment,
} from "@repo/features/agent-wire";
import { isVideoType } from "@repo/features/conversation-picture-wire";
import type { InboxImageType } from "@repo/features/inbox-wire";
import { Effect, Option, Result } from "effect";
import type { StoreFailure } from "../../http/store-failure.js";
import { AGENT_TOOL } from "../agent-runtime/tools.js";

const FORWARDED_IMAGE_REFUSAL = {
  UNREACHED: "unreached",
  VIDEO: "video",
  TOO_LARGE: "too-large",
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

export interface ImageForwarder {
  readonly userId: string;
  readonly conversationId: string | undefined;
}

const IMAGE_EXTENSION = {
  [AGENT_ATTACHMENT_TYPE.PNG]: "png",
  [AGENT_ATTACHMENT_TYPE.JPEG]: "jpg",
  [AGENT_ATTACHMENT_TYPE.WEBP]: "webp",
} as const satisfies Record<InboxImageType, string>;

function megabytes(bytes: number): string {
  return `${Math.ceil(bytes / 100_000) / 10} MB`;
}

function pictureOf(forwarder: ImageForwarder, id: string) {
  return forwarder.conversationId === undefined
    ? Effect.succeed(Option.none())
    : readConversationPicture(forwarder.conversationId, id);
}

export function forwardedImages(
  forwarder: ImageForwarder,
  ids: readonly string[],
): Effect.Effect<
  Result.Result<readonly AgentAttachment[], ForwardedImageRefusal>,
  StoreFailure,
  DatabaseServices
> {
  return Effect.gen(function* () {
    const named = [...new Set(ids)];
    if (named.length === 0) return Result.succeed([]);
    const files: AgentAttachment[] = [];
    let total = 0;
    for (const id of named) {
      const picture = yield* pictureOf(forwarder, id);
      if (Option.isNone(picture)) {
        return Result.fail({ kind: FORWARDED_IMAGE_REFUSAL.UNREACHED, id });
      }
      const { contentType, bytes } = picture.value;
      if (isVideoType(contentType)) return Result.fail({ kind: FORWARDED_IMAGE_REFUSAL.VIDEO, id });
      if (bytes.byteLength > AGENT_BOUNDS.MAX_IMAGE_BYTES) {
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
    if (total > AGENT_BOUNDS.MAX_ATTACHMENTS_BYTES) {
      return Result.fail({ kind: FORWARDED_IMAGE_REFUSAL.TOO_MUCH, bytes: total });
    }
    return Result.succeed(files);
  });
}

export function forwardedImageRefusalWords(refusal: ForwardedImageRefusal): string {
  switch (refusal.kind) {
    case FORWARDED_IMAGE_REFUSAL.UNREACHED:
      return (
        `attachment ${refusal.id} is no picture you can hand on. Name a picture of your own ` +
        `conversation, such as one ${AGENT_TOOL.SHOW_IMAGE} kept.`
      );
    case FORWARDED_IMAGE_REFUSAL.VIDEO:
      return (
        `attachment ${refusal.id} is a video, and only a picture, a PNG, JPEG, or WebP, is ` +
        "handed to another agent."
      );
    case FORWARDED_IMAGE_REFUSAL.TOO_LARGE:
      return (
        `attachment ${refusal.id} is ${megabytes(refusal.bytes)}, past the ` +
        `${megabytes(AGENT_BOUNDS.MAX_IMAGE_BYTES)} an image handed to another agent may ` +
        "be. It is not made smaller for you: hand on a smaller picture."
      );
    case FORWARDED_IMAGE_REFUSAL.TOO_MUCH:
      return (
        `the images come to ${megabytes(refusal.bytes)} together, past the ` +
        `${megabytes(AGENT_BOUNDS.MAX_ATTACHMENTS_BYTES)} one message may carry: hand on fewer.`
      );
  }
}
