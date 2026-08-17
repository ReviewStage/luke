/**
 * The decisions behind reading Luke into silence, kept pure so they can be
 * tested: how fast captioned words may leave the screen while the Mac's
 * output is silent, and how long they must stay once the reply that spoke
 * them has ended.
 *
 * Over an audible output the captions defer to the voice: the newest words
 * hold the screen, because the ear has already had the older ones, and the
 * words leave when the speech does. Into a muted output the words are not a
 * caption of the speech — they are the speech, and the reader is the only
 * audience. So the oldest unread line is the one that matters, it may leave
 * only when a reader could have finished it, and a reply that ends before
 * the reading does owes the reader the difference.
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
 * three seconds. Luke speaks slower than that, so the reading usually
 * finishes inside the reply and the hold below is the exception — but a pace
 * any faster would scroll words nobody has read yet, which is the one thing
 * a silent caption must never do.
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

/**
 * How long the words must stay on screen, from the moment they first
 * appeared, for every line to have had its reading time. A partial line is a
 * line: it still has to be read.
 */
export function captionReadingMs(textHeightPx: number): number {
  return Math.ceil(textHeightPx / CAPTION_LINE_HEIGHT) * CAPTION_LINE_READ_MS;
}

/**
 * How much longer a caption whose reply just ended must be held. Nothing is
 * owed when the output was audible — the voice already said these words —
 * when the user cut the reply themselves — a stop asked or the turn taken to
 * speak means stop, not "keep showing me" — or when the reading clock has
 * already run out, which is the common case because speech is slower than
 * reading. An unmeasured caption owes nothing either: the hold exists to
 * cover lines the clock knows about, never to guess.
 */
export function captionHoldMs(input: {
  outputSilent: boolean;
  interrupted: boolean;
  textHeight: number | undefined;
  elapsedMs: number;
}): number {
  if (!input.outputSilent || input.interrupted || input.textHeight === undefined) return 0;
  return Math.max(0, captionReadingMs(input.textHeight) - input.elapsedMs);
}
