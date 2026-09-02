import type { SessionNotice } from "./session-notices.js";

/**
 * The most notices a hold keeps. It matches the announcer's own backlog
 * bound: a longer list would only be trimmed again on arrival, and a meeting
 * long enough to gather more than this has made the panel the real record.
 */
export const MAXIMUM_HELD_NOTICES = 8;

/**
 * The most notices a release hands back to be spoken at once. A quiet that
 * gathered more has made the panel the real record, and reading eight
 * sentences the moment a call ends is the burst the quiet existed to prevent.
 */
export const MAXIMUM_RELEASED_NOTICES = 3;

/** What a hold needs of an item: which session it is about. */
interface HeldForSession {
  providerId: string;
  providerSessionId: string;
}

/**
 * Holds notices decided during a quiet interval until the interval ends. The
 * hold never decides anything itself — the caller says when to hold and when
 * to release — it only keeps the backlog honest while it waits:
 *
 * - One notice per session. A session that moved again while held has its
 *   earlier notice replaced, because reading a superseded state after the
 *   meeting would announce something no longer true.
 * - Bounded. Past the cap the oldest notice is shed first; every shed notice
 *   is still standing in the panel, which has shown the state the whole time.
 *
 * Whether a released notice is still worth saying is the caller's question to
 * answer against its own current roster — the hold cannot see one. It is
 * generic over what is held so each caller can preserve its own announcement
 * shape.
 */
export class SessionNoticeHold<Notice extends HeldForSession = SessionNotice> {
  #held: Notice[] = [];

  get count(): number {
    return this.#held.length;
  }

  /** Keeps notices for later, replacing any held for the same session. */
  hold(notices: readonly Notice[]): void {
    for (const notice of notices) {
      this.#held = this.#held.filter(
        (held) =>
          held.providerId !== notice.providerId ||
          held.providerSessionId !== notice.providerSessionId,
      );
      this.#held.push(notice);
    }
    if (this.#held.length > MAXIMUM_HELD_NOTICES) {
      this.#held = this.#held.slice(this.#held.length - MAXIMUM_HELD_NOTICES);
    }
  }

  /** Hands back what is held, oldest first, and holds nothing after. */
  release(): readonly Notice[] {
    const released = this.#held;
    this.#held = [];
    return released;
  }
}
