/**
 * The decision behind reading Luke into silence, kept pure so it can be
 * tested: how fast captioned words may leave the screen while the Mac's
 * output is silent.
 *
 * Over an audible output the captions defer to the voice: the newest words
 * hold the screen, because the ear has already had the older ones. Into a
 * muted output the words are not a caption of the speech — they are the
 * speech, and the reader is the only audience. So the oldest unread line is
 * the one that matters, and it may leave only when a reader could have
 * finished it.
 */

/**
 * The caption's line height, mirrored by `.voice-caption-text` in the
 * stylesheet — the two must agree. The scroll moves in whole lines, so the
 * reading pace is stated per line and travels as pixels.
 */
export const CAPTION_LINE_HEIGHT = 14;

/**
 * How long a line gets before it may scroll away. A full caption line at the
 * peek's width is a dozen words or so; at a deliberate read that is about
 * three seconds. Luke speaks slower than that, so the reading finishes inside
 * the reply — but a pace any faster would scroll words nobody has read yet,
 * which is the one thing a silent caption must never do.
 */
export const CAPTION_LINE_READ_MS = 3_000;

/**
 * How far a silent caption may have scrolled by now: one line per reading
 * interval, never past the overflow the block actually has. Reading is
 * sequential — the first line is done one interval after the words appeared,
 * the second an interval later — so the line at the top leaves exactly when
 * its turn has passed, and the newest words wait their turn below the clip
 * instead of shoving the unread ones off the screen.
 */
export function pacedCaptionScroll(overflowPx: number, elapsedMs: number): number {
  const readLines = Math.floor(Math.max(0, elapsedMs) / CAPTION_LINE_READ_MS);
  return Math.min(Math.max(0, overflowPx), readLines * CAPTION_LINE_HEIGHT);
}
