import type { SessionIdentity } from "@sidecar/session";
import { NestedMap } from "./nested-map.js";
import type { BrainTranscriptCursors } from "./state-store.js";

/**
 * Where the brain last read each observed transcript to, keyed by provider and
 * then by the provider's own session id. The cursors are the host's, not the
 * model's: they say what has been read, never what was said, and they move
 * with a turn — rolled back when the turn fails so the same delta is read
 * again rather than skipped — but they are no part of any checkpoint format.
 */
export class TranscriptCursors {
  #cursors: NestedMap<string>;

  constructor(cursors: BrainTranscriptCursors = {}) {
    this.#cursors = cursorMap(cursors);
  }

  cursor(identity: SessionIdentity): string | undefined {
    return this.#cursors.get(identity.providerId, identity.providerSessionId);
  }

  setCursor(identity: SessionIdentity, cursor: string): void {
    this.#cursors.set(identity.providerId, identity.providerSessionId, cursor);
  }

  /** Forgets the cursors of sessions the roster no longer holds, so the map cannot grow forever. */
  retain(identities: readonly SessionIdentity[]): void {
    const kept = new Map<string, Set<string>>();
    for (const identity of identities) {
      let provider = kept.get(identity.providerId);
      if (!provider) {
        provider = new Set();
        kept.set(identity.providerId, provider);
      }
      provider.add(identity.providerSessionId);
    }
    const dropped: [string, string][] = [];
    for (const [providerId, sessions] of this.#cursors.groups()) {
      const keptSessions = kept.get(providerId);
      for (const providerSessionId of sessions.keys()) {
        if (!keptSessions?.has(providerSessionId)) dropped.push([providerId, providerSessionId]);
      }
    }
    for (const [providerId, providerSessionId] of dropped) {
      this.#cursors.delete(providerId, providerSessionId);
    }
  }

  rollback(mark: BrainTranscriptCursors): void {
    this.#cursors = cursorMap(mark);
  }

  persisted(): BrainTranscriptCursors {
    const record: Record<string, Record<string, string>> = {};
    for (const [providerId, sessions] of this.#cursors.groups()) {
      if (sessions.size === 0) continue;
      record[providerId] = Object.fromEntries(sessions);
    }
    return record;
  }
}

function cursorMap(cursors: BrainTranscriptCursors): NestedMap<string> {
  const map = new NestedMap<string>();
  for (const [providerId, sessions] of Object.entries(cursors)) {
    for (const [providerSessionId, cursor] of Object.entries(sessions)) {
      map.set(providerId, providerSessionId, cursor);
    }
  }
  return map;
}
