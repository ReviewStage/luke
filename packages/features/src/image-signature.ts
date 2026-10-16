import { INBOX_IMAGE_TYPE, type InboxImageType } from "./inbox-wire.js";

/**
 * image-signature.ts -- what a picture's first bytes say it is: a PNG, a JPEG, or a WebP, or none of the three, and the size its header states.
 *
 * A file's name and a `data:` URL's label say nothing about what the bytes
 * hold, and a picture is served under its type, so every picture the
 * service keeps is sniffed by its signature: an inbox image read from an
 * agent's sandbox (`coder-host/inbox-image.ts`), a workspace's photo
 * (`workspace-wire.ts`), and a picture a tool answered an agent
 * (`brain-host/relay-pictures.ts`) alike. A kept picture's size is read
 * from its header as well, so a reader can hold its place before its bytes
 * arrive.
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

/** A picture's size in pixels, as its header states it. */
export interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}

const IHDR = [0x49, 0x48, 0x44, 0x52] as const;
const VP8_LOSSY = [0x56, 0x50, 0x38, 0x20] as const;
const VP8_LOSSLESS = [0x56, 0x50, 0x38, 0x4c] as const;
const VP8_EXTENDED = [0x56, 0x50, 0x38, 0x58] as const;
const VP8_START_CODE = [0x9d, 0x01, 0x2a] as const;

function bigEndian16(bytes: Uint8Array, at: number): number {
  return ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
}

function littleEndian16(bytes: Uint8Array, at: number): number {
  return (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);
}

function littleEndian24(bytes: Uint8Array, at: number): number {
  return littleEndian16(bytes, at) | ((bytes[at + 2] ?? 0) << 16);
}

/** A PNG's size: the first chunk is always IHDR, its width and height big-endian after its type. */
function pngDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 24 || !startsWith(bytes, IHDR, 12)) return undefined;
  const width = (bytes[16] ?? 0) * 2 ** 24 + ((bytes[17] ?? 0) << 16) + bigEndian16(bytes, 18);
  const height = (bytes[20] ?? 0) * 2 ** 24 + ((bytes[21] ?? 0) << 16) + bigEndian16(bytes, 22);
  return { width, height };
}

/** Whether a JPEG marker starts a frame, whose header states the size: SOF0 to SOF15, less DHT, JPG, and DAC, which share the range. */
function isFrameMarker(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/**
 * A JPEG's size, read from its first frame header. Note that the segments
 * before it are stepped over by their stated lengths rather than scanned
 * for a marker byte, because a thumbnail inside an EXIF segment holds
 * frame markers of its own.
 */
function jpegDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return undefined;
    const marker = bytes[at + 1] ?? 0;
    // A fill byte, or a marker that stands alone with no length after it.
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      at += 2;
      continue;
    }
    if (isFrameMarker(marker)) {
      return { width: bigEndian16(bytes, at + 7), height: bigEndian16(bytes, at + 5) };
    }
    at += 2 + bigEndian16(bytes, at + 2);
  }
  return undefined;
}

/** A WebP's size from its first chunk: a lossy frame's, a lossless bitstream's, or the extended canvas's. */
function webpDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 30) return undefined;
  if (startsWith(bytes, VP8_LOSSY, 12) && startsWith(bytes, VP8_START_CODE, 23)) {
    return {
      width: littleEndian16(bytes, 26) & 0x3fff,
      height: littleEndian16(bytes, 28) & 0x3fff,
    };
  }
  if (startsWith(bytes, VP8_LOSSLESS, 12) && bytes[20] === 0x2f) {
    const bits = littleEndian16(bytes, 21) + littleEndian16(bytes, 23) * 2 ** 16;
    return { width: (bits % 2 ** 14) + 1, height: (Math.floor(bits / 2 ** 14) % 2 ** 14) + 1 };
  }
  if (startsWith(bytes, VP8_EXTENDED, 12)) {
    return { width: littleEndian24(bytes, 24) + 1, height: littleEndian24(bytes, 27) + 1 };
  }
  return undefined;
}

const DIMENSIONS_OF = {
  [INBOX_IMAGE_TYPE.PNG]: pngDimensions,
  [INBOX_IMAGE_TYPE.JPEG]: jpegDimensions,
  [INBOX_IMAGE_TYPE.WEBP]: webpDimensions,
} as const satisfies Record<InboxImageType, (bytes: Uint8Array) => ImageDimensions | undefined>;

/** The size a picture of the given type states in its header; nothing where the header is cut short or states no size. */
export function imageDimensions(
  bytes: Uint8Array,
  type: InboxImageType,
): ImageDimensions | undefined {
  const dimensions = DIMENSIONS_OF[type](bytes);
  if (dimensions === undefined || dimensions.width === 0 || dimensions.height === 0)
    return undefined;
  return dimensions;
}
