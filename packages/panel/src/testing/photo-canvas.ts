/**
 * photo-canvas.ts -- the platform's image decoder and canvas a picked photo is drawn through, standing in where a test's DOM has none.
 */

import { vi } from "vitest";

/** What the platform's canvas was asked to draw: the picture's part, and the canvas it was drawn on. */
interface Drawn {
  readonly source: readonly number[];
  readonly canvas: readonly number[];
}

/** A WebP's bytes as the encoder answers them: its RIFF and WEBP signature, then filler, `length` bytes in all. */
export function webpBytes(length = 16): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  bytes.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  return bytes;
}

/**
 * The platform's image decoder and canvas, which jsdom has not got, standing
 * in at the browser's edge: every picture decodes at `width` by `height`, and
 * every canvas writes `bytes` of WebP, so the real encoder runs between them.
 */
export function stubCanvas(width: number, height: number, bytes: Uint8Array<ArrayBuffer>): Drawn[] {
  const drawn: Drawn[] = [];
  vi.stubGlobal("createImageBitmap", () => Promise.resolve({ width, height, close: () => {} }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    // SAFETY: the encoder calls drawImage alone on the context it is handed.
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
