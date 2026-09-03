import type { Session, SessionStatus } from "@sidecar/session";
import { BRAIN_WAKE_KIND, type BrainWakeEvent } from "./brain-events.js";

/**
 * How stale a session may be and still wake the brain on first sight or on a
 * status it is first seen in. A launch after a night away shows every session
 * at once, each with a status that changed hours ago; waking on those would
 * replay the night as though it were happening now.
 */
export const STATUS_EDGE_MAXIMUM_AGE_MS = 5 * 60_000;

/**
 * Turns observation passes into wake events for the providers no hook covers,
 * and for the flips a hook does not report. Every status change is an edge,
 * including one back into working: the brain decides what matters, so nothing
 * is filtered here but the two things it could never want — a session that
 * is Luke's own voice, and a change too old to be news.
 */
export class SessionStatusEdgeTracker {
  /** Keyed by the original identifiers, never a composite string. */
  #statuses = new Map<string, Map<string, SessionStatus>>();

  edges(sessions: readonly Session[], now: number): readonly BrainWakeEvent[] {
    const produced: BrainWakeEvent[] = [];
    const next = new Map<string, Map<string, SessionStatus>>();

    for (const session of sessions) {
      const previous = this.#statuses.get(session.providerId)?.get(session.providerSessionId);
      let provider = next.get(session.providerId);
      if (!provider) {
        provider = new Map();
        next.set(session.providerId, provider);
      }
      provider.set(session.providerSessionId, session.status);

      if (session.realtimeVoice === true) continue;
      if (previous === session.status) continue;
      if (now - session.lastActivityAt > STATUS_EDGE_MAXIMUM_AGE_MS) continue;
      produced.push({
        kind: BRAIN_WAKE_KIND.STATUS_EDGE,
        identity: {
          providerId: session.providerId,
          providerSessionId: session.providerSessionId,
        },
        ...(previous ? { previousStatus: previous } : undefined),
        session,
        atMs: now,
      });
    }

    this.#statuses = next;
    return produced;
  }
}
