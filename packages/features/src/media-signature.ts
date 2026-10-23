import {
  CONVERSATION_MEDIA_TYPE,
  type ConversationMediaType,
} from "./conversation-picture-wire.js";
import { imageDimensions, sniffImageType } from "./image-signature.js";
import { startsLikeWebm, webmDimensions } from "./video-signature.js";

/**
 * media-signature.ts -- what a shown or posted file's first bytes say it is: one of the three pictures, or a WebM an agent recorded, and the size it states.
 *
 * An agent may show the developer a recording of what it did wherever it
 * may show a picture: in its transcript (`show_image`), in the developer's
 * inbox, and in its task's chat. Each reads the file from the agent's
 * sandbox and sniffs it here, so the one rule for what a file is holds in
 * all three. A WebM's opening bytes say only that it is Matroska; its
 * doctype and size are read off the whole file (`mediaDimensions`), and one
 * that states neither is no video a reader can hold the place of.
 */

/** The type a file's first bytes say it is: a picture's, or a WebM's, whose doctype `mediaDimensions` then holds it to. */
export function sniffMediaType(head: Uint8Array): ConversationMediaType | undefined {
  return sniffImageType(head) ?? (startsLikeWebm(head) ? CONVERSATION_MEDIA_TYPE.WEBM : undefined);
}

/** The size a file of the given type states: a WebM's video track's, or a picture's header's; nothing where it states none. */
export function mediaDimensions(bytes: Uint8Array, type: ConversationMediaType) {
  return type === CONVERSATION_MEDIA_TYPE.WEBM
    ? webmDimensions(bytes)
    : imageDimensions(bytes, type);
}
