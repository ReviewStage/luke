import { type RefObject, useEffect } from "react";

/**
 * reveal-in-log.ts -- brings one mark in a conversation's log to the log's top once it is drawn: what a version's Open asks of the Transcript and Call tabs.
 *
 * The tab draws a mark (`REVEAL_MARK`) just before the call or turn asked
 * for, and once what it draws has landed this scrolls the log the mark
 * stands in, never the window around it, so the mark stands at the log's
 * top, then says it is done, so the ask is answered once and the log is the
 * reader's again. Note that scrolling the log away from its newest line is
 * what stops it following new lines (`../ai-elements/conversation.tsx`), as
 * a reader scrolling up does, so the log is told of the scroll at once. An ask whose call or turn is not drawn is
 * answered all the same, leaving the log where it stood.
 */

/** The attribute on the empty mark a tab draws before the call or turn it was asked to bring into view. */
export const REVEAL_MARK = "data-reveal";

/** Brings the mark under `root` to the top of its log once `ready`, then calls `onRevealed`; nothing while no reveal is asked. */
export function useRevealInLog(
  root: RefObject<HTMLElement | null>,
  ready: boolean,
  onRevealed: (() => void) | undefined,
): void {
  useEffect(() => {
    if (!ready || onRevealed === undefined) return;
    const mark = root.current?.querySelector<HTMLElement>(`[${REVEAL_MARK}]`);
    const log = mark?.closest<HTMLElement>('[role="log"]');
    if (mark !== undefined && mark !== null && log !== undefined && log !== null) {
      log.scrollTop += mark.getBoundingClientRect().top - log.getBoundingClientRect().top;
      // The log learns it left its newest line from its scroll event, which
      // the browser sends a frame later, after the render the answer below
      // asks for would have put it back at its bottom; so it is told now.
      log.dispatchEvent(new Event("scroll"));
    }
    onRevealed();
  }, [root, ready, onRevealed]);
}
