import type { Session, SessionIdentity } from "./session.js";

/**
 * The last address each observed session reported, for the run's lifetime.
 *
 * The registry replaces a provider's sessions wholesale on every pass, so a
 * chat filed away — archived in its provider, or settled off the roster —
 * takes its address with it, while the History tab keeps the line that named
 * it. This memory is what lets that line's chip still open the chat: an
 * entry exists only for an identity an observation pass itself reported with
 * an address, holds exactly the address normalization already admitted, and
 * is read back by identity, so nothing composed — by a model or by the
 * renderer — can reach the operating system through it. It lives in
 * main-process memory and dies with the run, the same lifetime as the
 * history whose presses it answers.
 *
 * A session that later reports no address keeps its last one here, and the
 * open consults this memory only where the roster has nothing better: a
 * session still reporting an address opens at its current one, and the
 * remembered address answers for a chat departed, filtered from the drawn
 * roster, or standing with its address withdrawn — every case where the
 * words on the History line still name somewhere this run actually saw.
 */
export class ReportedSessionLinks {
  /** Last links keyed by the original identifiers, never a composite string. */
  readonly #links = new Map<string, Map<string, string>>();

  /** Consumes one observation commit, keeping the latest address per session. */
  remember(sessions: readonly Session[]): void {
    for (const session of sessions) {
      const link = session.detail.link;
      if (link === undefined) continue;
      let provider = this.#links.get(session.providerId);
      if (!provider) {
        provider = new Map();
        this.#links.set(session.providerId, provider);
      }
      provider.set(session.providerSessionId, link);
    }
  }

  /** The last address this identity reported, or nothing for one never reported. */
  lastReported(identity: SessionIdentity): string | undefined {
    return this.#links.get(identity.providerId)?.get(identity.providerSessionId);
  }
}
