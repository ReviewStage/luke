/**
 * dither.ts -- the 8×8 ordered-dither map the brand's dots are lit by: the landing's canvases and the dotted banners alike.
 */

/** An 8×8 Bayer map's thresholds, row by row, each between 0 and 1. */
const BAYER_8: readonly number[] = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28,
  52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7,
  39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
].map((rank) => (rank + 0.5) / 64);

/** The threshold of the Bayer cell at column `i` and row `j`. */
export function bayerAt(i: number, j: number): number {
  return BAYER_8[(j % 8) * 8 + (i % 8)] ?? 0.5;
}
