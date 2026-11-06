import {
  CONVERSATION_MEDIA_TYPE,
  type ConversationMediaType,
} from "./conversation-picture-wire.js";
import { imageDimensions, sniffImageType } from "./image-signature.js";
import { startsLikeWebm, webmDimensions } from "./video-signature.js";

export function sniffMediaType(head: Uint8Array): ConversationMediaType | undefined {
  return sniffImageType(head) ?? (startsLikeWebm(head) ? CONVERSATION_MEDIA_TYPE.WEBM : undefined);
}

export function mediaDimensions(bytes: Uint8Array, type: ConversationMediaType) {
  return type === CONVERSATION_MEDIA_TYPE.WEBM
    ? webmDimensions(bytes)
    : imageDimensions(bytes, type);
}
