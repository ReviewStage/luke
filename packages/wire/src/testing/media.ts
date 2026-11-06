export function pngBytes(width: number, height: number, mark = 0): Uint8Array {
  const header = new Uint8Array(33);
  header.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(header.buffer).setUint32(16, width);
  new DataView(header.buffer).setUint32(20, height);
  header[32] = mark;
  return header;
}

function ebml(id: readonly number[], body: readonly number[]): number[] {
  return [...id, 0x80 | body.length, ...body];
}

export function webmBytes(width: number, height: number, docType = "webm"): Uint8Array {
  const video = ebml(
    [0xe0],
    [...ebml([0xb0], [width >> 8, width & 0xff]), ...ebml([0xba], [height >> 8, height & 0xff])],
  );
  const tracks = ebml([0x16, 0x54, 0xae, 0x6b], ebml([0xae], video));
  return new Uint8Array([
    ...ebml([0x1a, 0x45, 0xdf, 0xa3], ebml([0x42, 0x82], [...new TextEncoder().encode(docType)])),
    ...ebml([0x18, 0x53, 0x80, 0x67], tracks),
  ]);
}

export function paddedTo(bytes: Uint8Array, length: number): Uint8Array {
  const padded = new Uint8Array(length);
  padded.set(bytes);
  return padded;
}
