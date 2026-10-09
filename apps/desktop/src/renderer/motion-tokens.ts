/**
 * motion-tokens.ts -- the motion tokens as a computed style answers them, read as numbers.
 */

/** "7px" from a computed token, taken as pixels. */
export function parsePixels(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}
