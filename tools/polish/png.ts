/**
 * png.ts -- flattens a PNG onto an opaque ground, so a picture of a window that draws in clear comes out with no transparency.
 *
 * The desktop's panel window draws its frame as a tint over the Mac's sidebar
 * material (`packages/panel/src/styles/shell.css`), which no page capture
 * holds, so the frame comes out part clear, and laid on white a dark frame
 * reads mid-grey. Written without an alpha channel, every pixel is mixed with
 * the ground by its alpha instead (pngjs's `bgColor`). It lives apart from
 * `polish-shots.ts`, which runs the whole capture the moment it is imported.
 */

import { PNG } from "pngjs";

/** An opaque colour, each channel 0 to 255. */
export interface Rgb {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

// PNG's colour type for RGB with no alpha.
const RGB_COLOR_TYPE = 2;

/** `png` laid over `ground`, written opaque. */
export function flattenPng(png: Buffer, ground: Rgb): Buffer {
  return PNG.sync.write(PNG.sync.read(png), { colorType: RGB_COLOR_TYPE, bgColor: { ...ground } });
}
