// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { encodeImage } from "./feedback-images.js";

type Pixel = readonly [number, number, number, number];

const CLEAR: Pixel = [0, 0, 0, 0];
const STRIPE: Pixel = [47, 157, 68, 255];

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

function over(top: Pixel, under: Pixel): Pixel {
  const alpha = top[3] / 255 + (under[3] / 255) * (1 - top[3] / 255);
  if (alpha === 0) return CLEAR;
  const channel = (index: 0 | 1 | 2) =>
    Math.round(
      (top[index] * (top[3] / 255) + under[index] * (under[3] / 255) * (1 - top[3] / 255)) / alpha,
    );
  return [channel(0), channel(1), channel(2), Math.round(alpha * 255)];
}

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
