// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { encodeImage } from "./feedback-images.js";

/**
 * A picked image's re-encode as its pixels come out: a workspace photo drawn
 * with a transparent ground keeps it, so the tile shows the surface around it
 * in the light and the dark rather than a fill the encoder put there. The
 * platform's decoder and canvas, which jsdom has not got, stand in at the
 * browser's edge over a pixel buffer, as Chromium's do: a canvas starts
 * transparent unless asked for no alpha, drawing composites over what is
 * there, and WebP writes the alpha channel. Note that the stand-in canvas
 * answers drawImage alone, so an encoder that painted a ground first would
 * be refused and answer nothing.
 */

/** A pixel's red, green, blue, and alpha, each 0 to 255. */
type Pixel = readonly [number, number, number, number];

const CLEAR: Pixel = [0, 0, 0, 0];
const STRIPE: Pixel = [47, 157, 68, 255];

/** A decoded picture: its size and its pixels, row by row. */
interface Bitmap {
  readonly width: number;
  readonly height: number;
  readonly pixels: readonly Pixel[];
  close(): void;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** `top` over `under`, as a canvas composites a drawn pixel over what it covers. */
function over(top: Pixel, under: Pixel): Pixel {
  const alpha = top[3] / 255 + (under[3] / 255) * (1 - top[3] / 255);
  if (alpha === 0) return CLEAR;
  const channel = (index: 0 | 1 | 2) =>
    Math.round(
      (top[index] * (top[3] / 255) + under[index] * (under[3] / 255) * (1 - top[3] / 255)) / alpha,
    );
  return [channel(0), channel(1), channel(2), Math.round(alpha * 255)];
}

/**
 * Stands the platform's decoder and canvas in: every file decodes to
 * `picture`, a canvas holds pixels drawn nearest-neighbour, and its WebP is
 * those pixels' bytes as they stand, alpha and all.
 */
function stubPlatform(picture: Omit<Bitmap, "close">): void {
  vi.stubGlobal("createImageBitmap", () => Promise.resolve({ ...picture, close: () => {} }));
  const buffers = new WeakMap<HTMLCanvasElement, Pixel[]>();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
    _kind: string,
    options?: { alpha?: boolean },
  ) {
    const ground: Pixel = options?.alpha === false ? [0, 0, 0, 255] : CLEAR;
    const pixels = Array.from({ length: this.width * this.height }, () => ground);
    buffers.set(this, pixels);
    const width = this.width;
    // SAFETY: the stand-in answers drawImage alone, its nine-argument form the encoder uses.
    return {
      drawImage: (bitmap: Bitmap, ...at: number[]) => {
        const [sx = 0, sy = 0, sw = 0, sh = 0, dx = 0, dy = 0, dw = 0, dh = 0] = at;
        for (let y = 0; y < dh; y += 1) {
          for (let x = 0; x < dw; x += 1) {
            const from = Math.floor(sy + ((y + 0.5) * sh) / dh) * bitmap.width;
            const source = bitmap.pixels[from + Math.floor(sx + ((x + 0.5) * sw) / dw)] ?? CLEAR;
            const to = (dy + y) * width + dx + x;
            pixels[to] = over(source, pixels[to] ?? CLEAR);
          }
        }
      },
    } as unknown as CanvasRenderingContext2D;
  });
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    this: HTMLCanvasElement,
    callback,
    type,
  ) {
    const bytes = new Uint8Array((buffers.get(this) ?? []).flat());
    callback(new Blob([bytes], type === undefined ? {} : { type }));
  });
}

/** The pixels of an encoded image's bytes, as the stand-in canvas wrote them. */
function pixelsOf(base64: string): Pixel[] {
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  const pixels: Pixel[] = [];
  for (let at = 0; at < bytes.length; at += 4) {
    pixels.push([bytes[at] ?? 0, bytes[at + 1] ?? 0, bytes[at + 2] ?? 0, bytes[at + 3] ?? 0]);
  }
  return pixels;
}

test("a workspace photo drawn square keeps its transparent pixels transparent and its opaque ones as they were", async () => {
  stubPlatform({ width: 2, height: 2, pixels: [CLEAR, STRIPE, STRIPE, CLEAR] });
  const file = new File([new Uint8Array([1, 2, 3])], "logo.png", { type: "image/png" });

  const image = await encodeImage(file, Number.POSITIVE_INFINITY, 2);

  assert.equal(image?.mediaType, "image/webp");
  assert.deepEqual(pixelsOf(image?.base64 ?? ""), [CLEAR, STRIPE, STRIPE, CLEAR]);
});
