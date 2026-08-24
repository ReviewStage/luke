import type { Session, SessionIdentity } from "./session.js";

/**
 * How long a created workspace stays worth opening. The identity arrives the
 * moment its creation is accepted, but the address only exists once an
 * observation pass reports the new session with a link — usually the very next
 * pass, though a cloud provider's refresh floor and an eventually-consistent
 * listing can each add one more. Past this window the open would no longer
 * read as the answer to the ask that created it, so the entry lapses and the
 * workspace stays where every other session starts: on its row, unopened.
 */
export const CREATED_WORKSPACE_OPEN_WINDOW_MS = 2 * 60_000;

/**
 * The created workspaces still waiting to be opened on the developer's screen.
 *
 * An entry exists only as the direct product of an accepted creation the
 * developer asked for, keyed by the session id the provider's own creation
 * response named — never by anything composed. Claiming is how the entry
 * resolves: the first pass that reports that identity with an address hands
 * the session back exactly once, so the caller opens what observation
 * reported, the way a row press would, and never twice. A session that
 * arrives with no address keeps waiting — providers can list a session
 * before its deep link exists — and one that never gains an address inside
 * `CREATED_WORKSPACE_OPEN_WINDOW_MS` is quietly forgotten, because a session
 * that reports no address is offered nowhere to open.
 *
 * Deterministic by construction, like the notice tracker beside it: nothing a
 * model decided can add an entry, only the validated creation act itself.
 */
export class CreatedWorkspaceOpenTracker {
  /** Deadlines keyed by the original identifiers, never a composite string. */
  readonly #pending = new Map<string, Map<string, number>>();

  /** Starts waiting for one created session, from the moment its creation landed. */
  expect(identity: SessionIdentity, now: number): void {
    let provider = this.#pending.get(identity.providerId);
    if (!provider) {
      provider = new Map();
      this.#pending.set(identity.providerId, provider);
    }
    provider.set(identity.providerSessionId, now + CREATED_WORKSPACE_OPEN_WINDOW_MS);
  }

  /**
   * Consumes one observation commit and returns the created sessions now ready
   * to open: reported under the expected identity, with an address. Each is
   * claimed at most once, and entries past their deadline are dropped whether
   * or not their session ever appeared.
   */
  claim(sessions: readonly Session[], now: number): readonly Session[] {
    if (this.#pending.size === 0) return [];
    const claimed: Session[] = [];
    for (const session of sessions) {
      const provider = this.#pending.get(session.providerId);
      const deadline = provider?.get(session.providerSessionId);
      if (provider === undefined || deadline === undefined) continue;
      if (now <= deadline && session.detail.link !== undefined) {
        provider.delete(session.providerSessionId);
        claimed.push(session);
      }
    }
    for (const [providerId, provider] of this.#pending) {
      for (const [providerSessionId, deadline] of provider) {
        if (now > deadline) provider.delete(providerSessionId);
      }
      if (provider.size === 0) this.#pending.delete(providerId);
    }
    return claimed;
  }
}
