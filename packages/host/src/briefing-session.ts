/**
 * When this Mac opens a muted voice session so the service's exchange can
 * say a briefing here rather than push it to the phone. The trigger is a
 * status edge from observed rows and nothing a model decided: a briefing
 * stands on offer to the account (its `speech.offered` event is the latest
 * word on its message and its instant has not passed), this Mac is present
 * (input within the limit and the screen unlocked, the same presence its
 * heartbeat reports), speech is not held (a meeting, the pause, the spoken
 * introduction still owed, or the first calendar pass not yet in), and no
 * session already stands, since the look on a standing session claims what
 * is on offer itself. Once opened, the session is the exchange's: its look
 * claims the offer and speaks it, an offer another device claimed first is
 * left to that device, and the idle close ends the session like any other.
 * The phone's grace is untouched: a Mac that does not claim within it still
 * yields to the push.
 */

export const BRIEFING_SESSION = {
  /**
   * How long after one opening the next may be asked for. A burst of offers
   * arrives as a burst of publishes, and the session the first one opens
   * takes a moment to stand before `sessionStands` says so; the look on that
   * session then claims every open offer, so one opening per minute is one
   * session per burst and never several.
   */
  DEBOUNCE_MS: 60_000,
} as const;

export const BRIEFING_SESSION_DECISION = {
  /** Open a muted session now. */
  OPEN: "open",
  /** Nothing to open, or nothing to open yet. */
  NONE: "none",
} as const;

export type BriefingSessionDecision =
  (typeof BRIEFING_SESSION_DECISION)[keyof typeof BRIEFING_SESSION_DECISION];

export interface BriefingSessionFacts {
  /** Briefings on offer to the account at `now`, as the conversation's events say. */
  readonly openOffers: number;
  /** This Mac is present: input within the limit and the screen unlocked. */
  readonly present: boolean;
  /** Speech is held: a meeting, the pause, the introduction owed, or the hold not yet known. */
  readonly held: boolean;
  /** A session already stands, whose look claims what is on offer. */
  readonly sessionStands: boolean;
  /** When this Mac last asked for a session on this rule, or nothing this run. */
  readonly lastOpenedAt: number | undefined;
  readonly now: number;
}

/** The rule, as a function of what was read. */
export function briefingSessionDecision(facts: BriefingSessionFacts): BriefingSessionDecision {
  if (facts.openOffers <= 0) return BRIEFING_SESSION_DECISION.NONE;
  if (!facts.present || facts.held) return BRIEFING_SESSION_DECISION.NONE;
  if (facts.sessionStands) return BRIEFING_SESSION_DECISION.NONE;
  if (
    facts.lastOpenedAt !== undefined &&
    facts.now - facts.lastOpenedAt < BRIEFING_SESSION.DEBOUNCE_MS
  ) {
    return BRIEFING_SESSION_DECISION.NONE;
  }
  return BRIEFING_SESSION_DECISION.OPEN;
}
