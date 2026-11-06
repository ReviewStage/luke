export const WEBM_TYPE = "video/webm";

const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3] as const;

const EBML_ID = {
  DOC_TYPE: 0x4282,
  SEGMENT: 0x18538067,
  TRACKS: 0x1654ae6b,
  TRACK_ENTRY: 0xae,
  VIDEO: 0xe0,
  PIXEL_WIDTH: 0xb0,
  PIXEL_HEIGHT: 0xba,
  CLUSTER: 0x1f43b675,
} as const;

const WEBM_DOC_TYPE = "webm";

const WALKED: ReadonlySet<number> = new Set([
  EBML_ID.SEGMENT,
  EBML_ID.TRACKS,
  EBML_ID.TRACK_ENTRY,
  EBML_ID.VIDEO,
]);

interface Vint {
  readonly value: number;
  readonly length: number;
  readonly unknown: boolean;
}

function readVint(bytes: Uint8Array, at: number, keepMarker: boolean): Vint | undefined {
  const first = bytes[at];
  if (first === undefined || first === 0) return undefined;
  let length = 1;
  while (length <= 8 && (first & (0x80 >> (length - 1))) === 0) length += 1;
  if (length > 8 || at + length > bytes.length) return undefined;
  let value = keepMarker ? first : first & (0xff >> length);
  let allOnes = value === 0xff >> length;
  for (let index = 1; index < length; index += 1) {
    const byte = bytes[at + index] ?? 0;
    value = value * 256 + byte;
    allOnes &&= byte === 0xff;
  }
  return { value, length, unknown: !keepMarker && allOnes };
}

interface ElementHeader {
  readonly id: number;
  readonly body: number;
  readonly end: number;
}

function readHeader(bytes: Uint8Array, at: number, limit: number): ElementHeader | undefined {
  const id = readVint(bytes, at, true);
  if (id === undefined) return undefined;
  const size = readVint(bytes, at + id.length, false);
  if (size === undefined) return undefined;
  const body = at + id.length + size.length;
  const end = size.unknown ? limit : Math.min(limit, body + size.value);
  return { id: id.value, body, end };
}

function readUint(bytes: Uint8Array, from: number, to: number): number {
  let value = 0;
  for (let at = from; at < to; at += 1) value = value * 256 + (bytes[at] ?? 0);
  return value;
}

export function startsLikeWebm(bytes: Uint8Array): boolean {
  return EBML_MAGIC.every((byte, index) => bytes[index] === byte);
}

function docTypeOf(bytes: Uint8Array): string | undefined {
  if (!startsLikeWebm(bytes)) return undefined;
  const header = readHeader(bytes, 0, bytes.length);
  if (header === undefined) return undefined;
  for (let at = header.body; at < header.end; ) {
    const child = readHeader(bytes, at, header.end);
    if (child === undefined) return undefined;
    if (child.id === EBML_ID.DOC_TYPE) {
      let end = child.end;
      while (end > child.body && bytes[end - 1] === 0) end -= 1;
      return String.fromCharCode(...bytes.subarray(child.body, end));
    }
    at = child.end;
  }
  return undefined;
}

export interface VideoDimensions {
  readonly width: number;
  readonly height: number;
}

export function webmDimensions(bytes: Uint8Array): VideoDimensions | undefined {
  if (docTypeOf(bytes) !== WEBM_DOC_TYPE) return undefined;
  const header = readHeader(bytes, 0, bytes.length);
  if (header === undefined) return undefined;
  let width = 0;
  let height = 0;
  const ends: number[] = [bytes.length];
  let at = header.end;
  while (at < bytes.length) {
    while (ends.length > 1 && at >= (ends.at(-1) ?? bytes.length)) ends.pop();
    const element = readHeader(bytes, at, ends.at(-1) ?? bytes.length);
    if (element === undefined || element.id === EBML_ID.CLUSTER) break;
    if (element.id === EBML_ID.PIXEL_WIDTH) width = readUint(bytes, element.body, element.end);
    if (element.id === EBML_ID.PIXEL_HEIGHT) height = readUint(bytes, element.body, element.end);
    if (width > 0 && height > 0) return { width, height };
    if (WALKED.has(element.id)) {
      ends.push(element.end);
      at = element.body;
    } else {
      at = element.end;
    }
  }
  return undefined;
}
