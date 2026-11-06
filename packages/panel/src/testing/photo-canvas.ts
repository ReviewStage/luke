import { vi } from "vitest";

interface Drawn {
  readonly source: readonly number[];
  readonly canvas: readonly number[];
}

export function webpBytes(length = 16): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  bytes.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  return bytes;
}

export function stubCanvas(width: number, height: number, bytes: Uint8Array<ArrayBuffer>): Drawn[] {
  const drawn: Drawn[] = [];
  vi.stubGlobal("createImageBitmap", () => Promise.resolve({ width, height, close: () => {} }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    return {
      drawImage: (_bitmap: CanvasImageSource, ...at: number[]) =>
        drawn.push({ source: at.slice(0, 4), canvas: [this.width, this.height] }),
    } as unknown as CanvasRenderingContext2D;
  });
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback, type) =>
    callback(new Blob([bytes], type === undefined ? {} : { type })),
  );
  return drawn;
}
