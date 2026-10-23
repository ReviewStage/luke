/**
 * media.ts -- synthetic picture and video files for tests: the bytes a reader sniffs and measures, and nothing more.
 *
 * A picture is a PNG's signature and header chunk, which states its size; a
 * video is a Matroska file's EBML header, naming its doctype, and one video
 * track that states its size, with no frames, since every reader of one
 * reads no further than the track.
 */

/** A PNG's signature and header chunk, stating the size given, its last byte marked so two of one size differ. */
export function pngBytes(width: number, height: number, mark = 0): Uint8Array {
  const header = new Uint8Array(33);
  header.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(header.buffer).setUint32(16, width);
  new DataView(header.buffer).setUint32(20, height);
  header[32] = mark;
  return header;
}

/** One EBML element: its ID's bytes, its size in one byte, and its body. */
function ebml(id: readonly number[], body: readonly number[]): number[] {
  return [...id, 0x80 | body.length, ...body];
}

/**
 * A Matroska file of the doctype given, a WebM's by default, whose one
 * video track states the size, with no frames; and, where a title is given,
 * the segment's info stating it before the track, as an encoder writes it.
 */
export function webmBytes(
  width: number,
  height: number,
  { docType = "webm", title }: { readonly docType?: string; readonly title?: string } = {},
): Uint8Array {
  const video = ebml(
    [0xe0],
    [...ebml([0xb0], [width >> 8, width & 0xff]), ...ebml([0xba], [height >> 8, height & 0xff])],
  );
  const info =
    title === undefined
      ? []
      : ebml([0x15, 0x49, 0xa9, 0x66], ebml([0x7b, 0xa9], [...new TextEncoder().encode(title)]));
  const tracks = ebml([0x16, 0x54, 0xae, 0x6b], ebml([0xae], video));
  return new Uint8Array([
    ...ebml([0x1a, 0x45, 0xdf, 0xa3], ebml([0x42, 0x82], [...new TextEncoder().encode(docType)])),
    ...ebml([0x18, 0x53, 0x80, 0x67], [...info, ...tracks]),
  ]);
}

/** The bytes given, padded with zeros to the length given, so a test reaches a bound with a file a reader still sniffs. */
export function paddedTo(bytes: Uint8Array, length: number): Uint8Array {
  const padded = new Uint8Array(length);
  padded.set(bytes);
  return padded;
}
