import { VOICE_CAPTION_MAX_HEIGHT } from "@sidecar/surface";
import { VOLUME_HINT_BAND_HEIGHT } from "./volume-hint";

/**
 * The geometry behind the caption block under the housing, kept pure so the
 * bound it keeps can be tested without a browser.
 *
 * The block stacks every segment the voice reported — one per output item,
 * oldest first, the newest still arriving — and is bounded by the room the
 * window reserved under the housing, never by a count of segments. The
 * window cannot resize for speech, so that room is physical, and once the
 * stack outgrows it the block stops growing and the stack rolls up instead:
 * the oldest lines travel up under the housing and out of the block's clip
 * while the words still being spoken stay at its foot, where the eye already
 * is. Rolling, rather than dropping whole segments, keeps a reply's shape
 * continuous — a segment leaves a line at a time, the way it arrived — and
 * rather than a scrollbar, because the strip is captioning speech nobody can
 * scroll back through anyway.
 */

/**
 * The caption block's visible height — the `--caption-size` the clip ends the
 * element at. The strip's hover test reads it too: the element's own box runs
 * to the reserved maximum, and only this much of it is words rather than
 * desktop. The volume hint stands in a band of its own below the block, so
 * while it is drawn the band comes off the block's maximum: the block and the
 * band partition the reserved room instead of sharing it, and the stack never
 * asks for more height than the window holds.
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
