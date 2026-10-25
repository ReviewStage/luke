/**
 * scroll-asked.ts -- a script's word that it is about to scroll a box, so a log that follows its newest line reads the scroll as asked for rather than as the layout's.
 *
 * A log keeps to its newest line until the reader scrolls it away, and the
 * browser scrolls a box of its own accord too: a box that grows or a line
 * that shrinks pulls its scroll back, and rows hidden and shown again in one
 * frame leave it wherever the hidden rows clamped it. None of those is the
 * reader's, so a log that follows takes a scroll up as theirs only where
 * their wheel, touch, press or key came just before it, or a script said
 * here that it was about to scroll the box for them, as find, a reveal, or
 * a channel's unread line does.
 */

/** How long after a script's word a scroll of its box is still read as asked for, in milliseconds: long enough for a scroll a few frames late, as a virtualized row's is. */
const ASKED_SCROLL_MS = 500;

/** When a script last said it was about to scroll each box, on the page's clock. */
const askedAt = new WeakMap<Element, number>();

/** Says that a script is about to scroll `box`, so the scroll is read as asked for. */
export function askScroll(box: Element): void {
  askedAt.set(box, performance.now());
}

/** Whether a script said it was about to scroll `box` just now. */
export function scrollAsked(box: Element): boolean {
  const at = askedAt.get(box);
  return at !== undefined && performance.now() - at < ASKED_SCROLL_MS;
}
