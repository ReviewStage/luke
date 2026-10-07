/**
 * motion-tokens.ts -- the motion tokens as a computed style answers them, read as numbers.
 */

/**
 * Below this, a duration is a request for stillness rather than for very fast
 * motion: capture zeroes the tokens outright and reduced motion leaves 1ms so
 * transitions still fire their end events. Neither wants an animation started.
 */
export const STILL_MS = 2;

/** "460ms" or "0.46s" from a computed token, taken as milliseconds. */
export function parseMilliseconds(value: string): number {
  const trimmed = value.trim();
  const parsed = Number.parseFloat(trimmed);
  if (Number.isNaN(parsed)) return 0;
  return trimmed.endsWith("ms") ? parsed : parsed * 1000;
}

/** "7px" from a computed token, taken as pixels. */
export function parsePixels(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}
