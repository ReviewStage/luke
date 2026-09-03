import type { SessionIdentity } from "@sidecar/session";
import { isRecord, isWireString, type UnparsedWireValue } from "@sidecar/wire";
import { isCompactionItem, type ResponsesInputItem } from "./brain-openai.js";

/**
 * What the brain remembers between turns and across launches: the input array
 * from the latest compaction item onward, and the transcript cursor each
 * session was last read to. No summary of its own is kept — the API's
 * compaction item is the memory of everything before it, opaque and safe to
 * store — so the shape is the array itself.
 */

export const BRAIN_STATE_VERSION = 1;

export type BrainTranscriptCursors = Readonly<Record<string, Readonly<Record<string, string>>>>;

export interface BrainPersistedState {
  version: typeof BRAIN_STATE_VERSION;
  items: readonly ResponsesInputItem[];
  /** Keyed by provider id, then by provider session id. */
  cursors: BrainTranscriptCursors;
}

/** Reads a persisted state, or nothing when the file is from another build or malformed. */
export function brainPersistedStateFromWire(
  value: UnparsedWireValue,
): BrainPersistedState | undefined {
  if (!isRecord(value) || value.version !== BRAIN_STATE_VERSION) return undefined;
  if (!Array.isArray(value.items) || !isRecord(value.cursors)) return undefined;
  const items: ResponsesInputItem[] = [];
  for (const item of value.items) {
    if (!isRecord(item)) return undefined;
    items.push(item);
  }
  const cursors: Record<string, Record<string, string>> = {};
  for (const [providerId, sessions] of Object.entries(value.cursors)) {
    if (!isRecord(sessions)) return undefined;
    const provider: Record<string, string> = {};
    for (const [providerSessionId, cursor] of Object.entries(sessions)) {
      if (!isWireString(cursor)) return undefined;
      provider[providerSessionId] = cursor;
    }
    cursors[providerId] = provider;
  }
  return { version: BRAIN_STATE_VERSION, items, cursors };
}

/** Everything a failed turn is rolled back to, taken before the turn appends anything. */
export interface BrainMemoryMark {
  items: readonly ResponsesInputItem[];
  cursors: BrainTranscriptCursors;
}

function cursorMap(cursors: BrainTranscriptCursors): Map<string, Map<string, string>> {
  return new Map(
    Object.entries(cursors).map(([providerId, sessions]) => [
      providerId,
      new Map(Object.entries(sessions)),
    ]),
  );
}

function cursorRecord(cursors: ReadonlyMap<string, ReadonlyMap<string, string>>) {
  const record: Record<string, Record<string, string>> = {};
  for (const [providerId, sessions] of cursors) {
    if (sessions.size === 0) continue;
    record[providerId] = Object.fromEntries(sessions);
  }
  return record;
}

/**
 * The input array and cursors, with the two operations a turn needs beyond
 * appending: a mark to roll back to when a turn fails partway, so a
 * `function_call` never stands without its output, and the drop that follows
 * a compaction item, since the item carries everything before it.
 */
export class BrainMemory {
  #items: ResponsesInputItem[];
  #cursors: Map<string, Map<string, string>>;

  constructor(state?: BrainPersistedState) {
    this.#items = state ? [...state.items] : [];
    this.#cursors = state ? cursorMap(state.cursors) : new Map();
  }

  items(): readonly ResponsesInputItem[] {
    return this.#items;
  }

  append(items: readonly ResponsesInputItem[]): void {
    this.#items.push(...items);
  }

  mark(): BrainMemoryMark {
    return { items: [...this.#items], cursors: cursorRecord(this.#cursors) };
  }

  rollback(mark: BrainMemoryMark): void {
    this.#items = [...mark.items];
    this.#cursors = cursorMap(mark.cursors);
  }

  /** Drops every item before the latest compaction item; answers how many went. */
  dropBeforeLatestCompaction(): number {
    const index = this.#items.findLastIndex(isCompactionItem);
    if (index <= 0) return 0;
    this.#items = this.#items.slice(index);
    return index;
  }

  cursor(identity: SessionIdentity): string | undefined {
    return this.#cursors.get(identity.providerId)?.get(identity.providerSessionId);
  }

  setCursor(identity: SessionIdentity, cursor: string): void {
    let provider = this.#cursors.get(identity.providerId);
    if (!provider) {
      provider = new Map();
      this.#cursors.set(identity.providerId, provider);
    }
    provider.set(identity.providerSessionId, cursor);
  }

  /** Forgets the cursors of sessions the roster no longer holds, so the map cannot grow forever. */
  retainCursors(identities: readonly SessionIdentity[]): void {
    const kept = new Map<string, Set<string>>();
    for (const identity of identities) {
      let provider = kept.get(identity.providerId);
      if (!provider) {
        provider = new Set();
        kept.set(identity.providerId, provider);
      }
      provider.add(identity.providerSessionId);
    }
    for (const [providerId, sessions] of this.#cursors) {
      const keptSessions = kept.get(providerId);
      for (const providerSessionId of sessions.keys()) {
        if (!keptSessions?.has(providerSessionId)) sessions.delete(providerSessionId);
      }
      if (sessions.size === 0) this.#cursors.delete(providerId);
    }
  }

  persisted(): BrainPersistedState {
    return {
      version: BRAIN_STATE_VERSION,
      items: [...this.#items],
      cursors: cursorRecord(this.#cursors),
    };
  }
}
