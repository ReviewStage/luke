import { INBOX_IMAGE_TYPE, type InboxImageType } from "./inbox-wire.js";

/**
 * image-signature.ts -- what a picture's first bytes say it is: a PNG, a JPEG, or a WebP, or none of the three.
 *
 * A file's name and a `data:` URL's label say nothing about what the bytes
 * hold, and a picture is served under its type, so every picture the
 * service keeps is sniffed by its signature: an inbox image read from an
 * agent's sandbox (`coder-host/inbox-image.ts`) and a workspace's photo
 * (`workspace-wire.ts`) alike.
 */

/** The bytes a signature is read from: WebP's reaches the twelfth. */
export const SIGNATURE_BYTES = 12;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;
const RIFF = [0x52, 0x49, 0x46, 0x46] as const;
const WEBP = [0x57, 0x45, 0x42, 0x50] as const;

function startsWith(bytes: Uint8Array, signature: readonly number[], at = 0): boolean {
  return signature.every((byte, index) => bytes[at + index] === byte);
}

/** The type the bytes' signature says they are, or nothing for bytes that are none of the three. */
export function sniffImageType(bytes: Uint8Array): InboxImageType | undefined {
  if (startsWith(bytes, PNG_SIGNATURE)) return INBOX_IMAGE_TYPE.PNG;
  if (startsWith(bytes, JPEG_SIGNATURE)) return INBOX_IMAGE_TYPE.JPEG;
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) return INBOX_IMAGE_TYPE.WEBP;
  return undefined;
}
