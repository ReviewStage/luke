import type { AttentionSpeech } from "./realtime";
import { type NormalizedSession, normalizeSessionIdentity, type SessionIdentity } from "./session";

/**
 * How many sessions' notices are kept while the developer is unavailable.
 *
 * A Focus can last all afternoon, and reading twenty sentences at the end of it
 * would be worse than having said nothing. So the hold keeps the most recently
 * decided handful and lets the rest go: every one of them still reads as
 * needing attention in the panel, which is where a developer coming back from
 * an hour away actually looks.
 */
export const maximumHeldAttention = 5;

/**
 * Holds the notices Luke would have spoken while the developer was unavailable,
 * and hands back the ones still worth saying once they are not.
 *
 * One notice per session, latest wins: a session that moved three times during
 * a Focus has one thing worth hearing about it, which is where it ended up. And
 * nothing is released on the strength of having been held — every notice is
 * checked against the session as it stands now, so a failure that has since
 * been recovered from, or a session that has since gone, is dropped rather than
 * announced. Holding a sentence is only safe because releasing one is not.
 *
 * Records are keyed by provider identity through nested maps rather than by a
 * composed string, exactly as the speech ledger keys its own.
 */
export class HeldAttentionQueue {
  readonly #maximumHeld: number;
  #held = new Map<string, Map<string, AttentionSpeech>>();

  constructor(maximumHeld: number = maximumHeldAttention) {
    this.#maximumHeld = Math.max(1, Math.floor(maximumHeld));
  }

  /** How many sessions have a notice waiting. */
  get size(): number {
    let size = 0;
    for (const sessions of this.#held.values()) size += sessions.size;
    return size;
  }

  /** Takes notices out of the air and puts them by, newest per session. */
  hold(speech: readonly AttentionSpeech[]): void {
    for (const notice of speech) {
      const identity = normalizeSessionIdentity(notice);
      const sessions = this.#held.get(identity.providerId) ?? new Map<string, AttentionSpeech>();
      sessions.set(identity.providerSessionId, notice);
      this.#held.set(identity.providerId, sessions);
      this.#evictOldest();
    }
  }

  /**
   * Hands back what is still true, oldest decision first, and empties the hold.
   *
   * A notice survives only while the session it belongs to is still reported
   * and its attention still says the same thing. The reviewer overwrites a
   * session's decision every time it reaches a new one — including with silence
   * — so a held notice that no longer matches is one the session itself has
   * already moved past.
   */
  release(sessions: readonly NormalizedSession[]): readonly AttentionSpeech[] {
    const held = this.#held;
    this.#held = new Map<string, Map<string, AttentionSpeech>>();

    const released: AttentionSpeech[] = [];
    for (const session of sessions) {
      const notice = held.get(session.providerId)?.get(session.providerSessionId);
      if (!notice) continue;
      if (session.attention.disposition !== notice.disposition) continue;
      if (session.attention.summary !== notice.summary) continue;
      released.push(notice);
    }
    return released.sort((first, second) => first.decidedAt - second.decidedAt);
  }

  /** Drops everything held, announcing nothing. */
  clear(): void {
    this.#held = new Map<string, Map<string, AttentionSpeech>>();
  }

  #evictOldest(): void {
    while (this.size > this.#maximumHeld) {
      let oldest: { identity: SessionIdentity; decidedAt: number } | undefined;
      for (const [providerId, sessions] of this.#held) {
        for (const [providerSessionId, notice] of sessions) {
          if (oldest && oldest.decidedAt <= notice.decidedAt) continue;
          oldest = { identity: { providerId, providerSessionId }, decidedAt: notice.decidedAt };
        }
      }
      if (!oldest) return;
      const sessions = this.#held.get(oldest.identity.providerId);
      sessions?.delete(oldest.identity.providerSessionId);
      if (sessions?.size === 0) this.#held.delete(oldest.identity.providerId);
    }
  }
}
