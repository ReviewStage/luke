import type { HistoryAppendOutcome } from "@sidecar/runtime/vocabulary";
import {
  appendConversationThreadEntry,
  type ConversationEntry,
  conversationEntryIdentity,
  recordedAfterClear,
} from "@sidecar/session";

/**
 * The conversation as the main process holds it between the brain's store and
 * the windows: the thread every panel is shown, the last Clear's cutoff, and
 * an epoch that fences every append still out against a Clear that landed
 * while it waited. The store's append is asynchronous, so a report dispatched
 * before a Clear can answer after it; the answer describes a thread the Clear
 * has since erased, and installing it would stand the erased words back up on
 * every display. The epoch is bumped by the fence, captured before each
 * dispatch, and checked again after the answer: a late answer from an earlier
 * epoch installs nothing and broadcasts nothing, and the lines it carried are
 * the Clear's to erase in the store, where the same cutoff is applied.
 */
export interface ConversationThreadStore {
  appendHistory(
    entries: readonly ConversationEntry[],
    now: number,
  ): Promise<HistoryAppendOutcome<ConversationEntry>>;
}

/**
 * The thread of a run with nothing on disk — a fixture or capture run — kept
 * under the same append rule: idempotent on each line's identity, placed
 * where it happened, and retained to the same bounds.
 */
export class MemoryHistoryStore implements ConversationThreadStore {
  #entries: readonly ConversationEntry[] = [];
  readonly #held = new Set<string>();

  appendHistory(
    entries: readonly ConversationEntry[],
    now: number,
  ): Promise<HistoryAppendOutcome<ConversationEntry>> {
    let thread = this.#entries;
    for (const entry of entries) {
      const identity = conversationEntryIdentity(entry);
      if (this.#held.has(identity)) continue;
      this.#held.add(identity);
      thread = appendConversationThreadEntry(thread, entry, now, entry.recordedAt ?? now);
    }
    const changed = thread !== this.#entries;
    this.#entries = thread;
    return Promise.resolve({ changed, entries: thread });
  }

  /** The deletion's erasure, bounded like the store's: lines recorded at or before the instant go, later ones stay. */
  eraseAtOrBefore(instant: number): void {
    this.#entries = this.#entries.filter((entry) => (entry.recordedAt ?? 0) > instant);
  }
}

export interface ConversationThreadOptions {
  store: ConversationThreadStore;
  now?: () => number;
  /**
   * Hears the thread as every window should now draw it, less the window that
   * reported the change, named by the opaque token its client minted.
   */
  onChanged: (entries: readonly ConversationEntry[], except?: string) => void;
  report?: (message: string) => void;
}

export class ConversationThread {
  readonly #store: ConversationThreadStore;
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
  async append(entries: readonly ConversationEntry[], except?: string): Promise<boolean> {
    const admitted = entries.filter((entry) => this.#afterClear(entry));
    if (admitted.length === 0) return true;
    const epoch = this.#epoch;
    let outcome: HistoryAppendOutcome<ConversationEntry>;
    try {
      outcome = await this.#store.appendHistory(admitted, this.#now());
    } catch (error) {
      this.#report(
        `Could not persist the conversation: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
    if (epoch !== this.#epoch) return true;
    if (!outcome.changed) return true;
    // The store's answer is filtered through the cutoff as it stands now,
    // not trusted whole: until the Clear's marker and erasure land in the
    // store — and for good if the disk refused them — its rows still hold
    // the lines the fence already emptied here, and the fence must hold
    // whatever the disk did.
    const merged = outcome.entries.filter((entry) => this.#afterClear(entry));
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

  #afterClear(entry: ConversationEntry): boolean {
    return recordedAfterClear(entry, this.#clearedAt);
  }
}
