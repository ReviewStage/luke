import type { SessionNoticePopup } from "../shared/contracts";
import { PANEL_PRESENTATION, type PanelPresentation } from "./panel-state";

/**
 * The notice popup's own clocks, apart from the motion tokens on purpose:
 * these are how long news stands, not how anything moves, so a capture run
 * that zeroes the tokens leaves them alone.
 */

/** How long one popup stands before putting itself away. */
export const NOTICE_POPUP_MS = 6_000;

/**
 * How long a queued popup stays worth drawing — the same span a spoken notice
 * stays worth saying, for the same reason: news about a session is news for
 * minutes, not for whenever the caption or the panel happens to clear. The
 * panel has shown the state the whole time.
 */
export const NOTICE_POPUP_MAX_AGE_MS = 2 * 60_000;

/** A backlog is stale news read in order; only this many popups ever wait. */
export const MAXIMUM_QUEUED_POPUPS = 4;

/**
 * Whether the surface may draw a popup right now. Only the resting shapes: an
 * open panel is already showing the session's row, and the slot and the
 * composer are shapes someone asked for — news must not land in the middle of
 * a key being typed. The caption shares the popup's band under the housing,
 * so words on screen hold the popup back too; the queue is what lets the news
 * wait for the room.
 */
export function noticePopupAllowed(input: {
  presentation: PanelPresentation;
  captionDrawn: boolean;
}): boolean {
  if (input.captionDrawn) return false;
  return (
    input.presentation === PANEL_PRESENTATION.CAPSULE ||
    input.presentation === PANEL_PRESENTATION.PEEK
  );
}

/**
 * Adds announcements to the popups waiting for the surface's room, one per
 * session: newer news about a session replaces what it had queued —
 * Notification Center stacks stale news beside current news, and this queue
 * exists not to — and a backlog sheds its oldest, because the oldest waiting
 * news is the least newsworthy.
 */
export function enqueueNoticePopups(
  queue: readonly SessionNoticePopup[],
  popups: readonly SessionNoticePopup[],
): readonly SessionNoticePopup[] {
  let next = [...queue];
  for (const popup of popups) {
    next = next.filter(
      (waiting) =>
        waiting.providerId !== popup.providerId ||
        waiting.providerSessionId !== popup.providerSessionId,
    );
    next.push(popup);
  }
  return next.length > MAXIMUM_QUEUED_POPUPS
    ? next.slice(next.length - MAXIMUM_QUEUED_POPUPS)
    : next;
}

/** A popup resolved against the roster: the fields the surface draws. */
export interface DrawnNotice {
  popup: SessionNoticePopup;
  title: string;
}

/**
 * Takes the next popup worth drawing, and the queue as it stands after.
 * Everything inspected is consumed: news delayed past its own relevance is
 * dropped rather than drawn as though it just happened, and a popup whose
 * session the roster no longer titles is skipped — there is no row its press
 * could stand for.
 */
export function takeNoticePopup(
  queue: readonly SessionNoticePopup[],
  now: number,
  titleFor: (popup: SessionNoticePopup) => string | undefined,
): { queue: readonly SessionNoticePopup[]; drawn?: DrawnNotice } {
  const fresh = queue.filter((popup) => now - popup.decidedAt <= NOTICE_POPUP_MAX_AGE_MS);
  for (let index = 0; index < fresh.length; index += 1) {
    const popup = fresh[index];
    if (!popup) continue;
    const title = titleFor(popup);
    if (title === undefined) continue;
    return { queue: fresh.slice(index + 1), drawn: { popup, title } };
  }
  return { queue: [] };
}
