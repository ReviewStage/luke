import {
  appendConversationThreadEntry,
  type ConversationEntry,
  conversationEntryKey,
  retainedConversationEntries,
} from "@sidecar/realtime";
import type { HistoryAppendOutcome } from "@sidecar/runtime-contracts";

/**
 * The conversation as the main process holds it between the runtime store and
 * the windows: the thread every panel is shown, the last Clear's cutoff, and
 * an epoch that fences every append still out against a Clear that landed
 * while it waited. The store's append is asynchronous, so a report dispatched
 * before a Clear can answer after it; the answer describes a thread the Clear
 * has since erased, and installing it would stand the erased words back up on
 * every display. The epoch is bumped by the fence, captured before each
 * dispatch, and checked again after the answer: a late answer from an earlier
 * epoch installs nothing and broadcasts nothing, and the lines it carried are
 * the Clear's to erase in the store, where the same cutoff is applied.
 *
 * Without a store — a fixture or capture run — the thread lives here alone,
 * under the same append rule.
 */
export interface ConversationThreadStore {
  appendHistory(
    entries: readonly ConversationEntry[],
    now: number,
  ): Promise<HistoryAppendOutcome<ConversationEntry>>;
}

export interface ConversationThreadOptions {
  store?: ConversationThreadStore;
  now?: () => number;
  /** Hears the thread as every window should now draw it, less the window that reported the change. */
  onChanged: (entries: readonly ConversationEntry[], except?: unknown) => void;
  report?: (message: string) => void;
}

export class ConversationThread {
  readonly #store: ConversationThreadStore | undefined;
  readonly #now: () => number;
  readonly #onChanged: ConversationThreadOptions["onChanged"];
  readonly #report: (message: string) => void;
  #entries: readonly ConversationEntry[] = [];
  #clearedAt: number | undefined;
  #epoch = 0;

  constructor(options: ConversationThreadOptions) {
    this.#store = options.store;
    this.#now = options.now ?? Date.now;
    this.#onChanged = options.onChanged;
    this.#report = options.report ?? (() => undefined);
  }

  entries(): readonly ConversationEntry[] {
    return this.#entries;
  }

  clearedAt(): number | undefined {
    return this.#clearedAt;
  }

  /** The thread as the store holds it at launch, and the cutoff its marker carries. */
  restore(entries: readonly ConversationEntry[], clearedAt: number | undefined): void {
    this.#entries = entries;
    this.#clearedAt = clearedAt;
  }

  /**
   * Appends lines and tells every window but `except` the thread as it now
   * stands. Answers whether the thread holds everything it was asked to: a
   * line from at or before the last Clear was settled by the Clear itself and
   * is not taken, a line the store refused answers false, and a line whose
   * answer arrived after a later Clear is that Clear's to erase.
   */
  async append(entries: readonly ConversationEntry[], except?: unknown): Promise<boolean> {
    const admitted = entries.filter((entry) => this.#afterClear(entry));
    if (admitted.length === 0) return true;
    const epoch = this.#epoch;
    const now = this.#now();
    let merged: readonly ConversationEntry[];
    if (this.#store) {
      let outcome: HistoryAppendOutcome<ConversationEntry>;
      try {
        outcome = await this.#store.appendHistory(admitted, now);
      } catch (error) {
        this.#report(
          `Could not persist the conversation: ${error instanceof Error ? error.message : String(error)}`,
        );
        return false;
      }
      if (epoch !== this.#epoch) return true;
      if (!outcome.changed) return true;
      merged = outcome.entries;
    } else {
      const held = new Set(this.#entries.map(memoryKey));
      merged = admitted.reduce((thread, entry) => {
        if (held.has(memoryKey(entry))) return thread;
        held.add(memoryKey(entry));
        return appendConversationThreadEntry(thread, entry, now, entry.recordedAt ?? now);
      }, this.#entries);
      if (merged === this.#entries) return true;
    }
    this.#entries = merged;
    this.#onChanged(merged, except);
    return true;
  }

  /**
   * The Clear's fence, synchronous: the cutoff is raised, the thread emptied,
   * every window told, and the epoch moved so no append still out can refill
   * the thread with what it held before. Everything the store does about the
   * Clear happens after this returns.
   */
  fence(clearedAt: number): void {
    this.#epoch += 1;
    this.#clearedAt = clearedAt;
    this.#entries = [];
    this.#onChanged([]);
  }

  /** Lets go of retained lines past their age, for the in-memory thread of a run without a store. */
  retain(): void {
    const retained = retainedConversationEntries(this.#entries, this.#now());
    if (retained.length === this.#entries.length) return;
    this.#entries = retained;
    this.#onChanged(retained);
  }

  #afterClear(entry: ConversationEntry): boolean {
    return (
      this.#clearedAt === undefined ||
      (entry.recordedAt !== undefined && entry.recordedAt > this.#clearedAt)
    );
  }
}

/** The in-memory thread's idempotency key: the line's own id, or its value for a line without one. */
function memoryKey(entry: ConversationEntry): string {
  return entry.eventId ?? conversationEntryKey(entry);
}
