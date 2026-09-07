import type { SessionIdentity } from "@sidecar/session";
import { isWireString } from "@sidecar/wire";
import { isCompactionItem, RESPONSES_ITEM_TYPE, type ResponsesInputItem } from "./responses-api.js";
import type { BrainTranscriptCursors } from "./state-store.js";

/**
 * What the brain remembers between turns and across launches: the input array
 * from the latest compaction item onward, and the transcript cursor each
 * session was last read to. No summary of its own is kept — the API's
 * compaction item is the memory of everything before it, opaque and safe to
 * store — so the shape is the array itself. The envelope that carries both
 * across launches is the state store; this is the working copy one agent holds.
 */

export interface BrainMemoryState {
  items: readonly ResponsesInputItem[];
  cursors: BrainTranscriptCursors;
}

/**
 * Answers every `function_call` in the array that has no `function_call_output`
 * anywhere in it with the output given, so a memory restored from a checkpoint
 * taken between an act's start and its result never replays the call and
 * never hands the model a dangling one.
 */
export function pairedDanglingCalls(
  items: readonly ResponsesInputItem[],
  outputFor: (callId: string) => string,
): readonly ResponsesInputItem[] {
  const answered = new Set<string>();
  for (const item of items) {
    if (item.type === RESPONSES_ITEM_TYPE.FUNCTION_CALL_OUTPUT && isWireString(item.call_id)) {
      answered.add(item.call_id);
    }
  }
  const dangling: ResponsesInputItem[] = [];
  for (const item of items) {
    if (item.type !== RESPONSES_ITEM_TYPE.FUNCTION_CALL || !isWireString(item.call_id)) continue;
    if (answered.has(item.call_id)) continue;
    answered.add(item.call_id);
    dangling.push({
      type: RESPONSES_ITEM_TYPE.FUNCTION_CALL_OUTPUT,
      call_id: item.call_id,
      output: outputFor(item.call_id),
    });
  }
  return dangling.length === 0 ? items : [...items, ...dangling];
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

  constructor(state?: BrainMemoryState) {
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

  persisted(): BrainMemoryState {
    return {
      items: [...this.#items],
      cursors: cursorRecord(this.#cursors),
    };
  }
}
