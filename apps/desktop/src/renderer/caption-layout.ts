import { VOICE_CAPTION_MAX_HEIGHT } from "@sidecar/surface";
import { VOLUME_HINT_BAND_HEIGHT } from "./volume-hint";

/**
 * The geometry behind the caption bar, kept pure so the bound it keeps can be
 * tested without a browser.
 *
 * The bar stacks every segment the voice reported — one per output item,
 * oldest first, the newest still arriving — and is bounded by `--caption-max`,
 * never by a count of segments. Once the stack outgrows it the bar stops
 * growing and the stack rolls up instead: the oldest lines leave through the
 * bar's top while the words still being spoken stay at its foot, where the eye
 * already is. Rolling, rather than dropping whole segments, keeps a reply's
 * shape continuous — a segment leaves a line at a time, the way it arrived —
 * and rather than a scrollbar, because the bar is captioning speech nobody can
 * scroll back through anyway.
 */

/**
 * The caption bar's visible height, which the hover test reads: only this
 * much of the bar is words. The volume hint stands in a row of its own below
 * the bar, so while it is drawn its band comes off the bar's maximum, and the
 * stack never asks for more height than the two of them may take.
 */
export function captionBlockSize(textHeight: number, volumeHint: boolean, padding: number): number {
  const hintBand = volumeHint ? VOLUME_HINT_BAND_HEIGHT : 0;
  return Math.min(VOICE_CAPTION_MAX_HEIGHT - hintBand, textHeight + padding);
}

/**
 * How far the stack rolls up to keep its newest lines inside the block: the
 * height the wrapped words need past what the block can show, and zero while
 * they fit. The block's own padding is above the words, so it is spent before
 * any line is.
 */
export function captionStackOverflow(
  textHeight: number,
  volumeHint: boolean,
  padding: number,
): number {
  return Math.max(0, textHeight + padding - captionBlockSize(textHeight, volumeHint, padding));
}

/** The stack's segments as the surface draws them. */
export interface CaptionSegments {
  /** Every settled segment, oldest first; each mounts only while it has words. */
  settled: readonly string[];
  /** The words still arriving, in the always-mounted slot a lone caption also uses. */
  live: string | undefined;
}

/**
 * Splits what the strip is showing into the blocks the stack draws. The
 * newest segment is the live one whatever the count, and everything before it
 * is settled, so one reply and a reply of several messages are the same
 * shape at different lengths.
 */
export function captionSegments(texts: readonly string[] | undefined): CaptionSegments {
  if (texts === undefined || texts.length === 0) return { settled: [], live: undefined };
  return { settled: texts.slice(0, -1), live: texts.at(-1) };
}
