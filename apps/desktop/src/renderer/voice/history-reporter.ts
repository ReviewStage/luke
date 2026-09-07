import { type ConversationEntry, conversationEntryIdentity } from "@sidecar/realtime";

/**
 * Which of this window's lines the main process's store has acknowledged, so
 * a publish sends only what is new and a line the store did not take is sent
 * again on the next publish. A line is reported only once its append was
 * acknowledged — not when it was sent — so a worker that was down for one
 * write costs nothing but a retry. The record is kept by each line's own id
 * (its value, for a line without one) with the run it was known to belong
 * to, so a line that later learns its run is sent once more. A Clear moves
 * the epoch: an acknowledgement for lines sent before it marks nothing in the
 * lifetime that follows.
 */
export interface TakenLines {
  entries: readonly ConversationEntry[];
  epoch: number;
}

export class HistoryReporter {
  readonly #reported = new Map<string, string | undefined>();
  readonly #inFlight = new Set<string>();
  #epoch = 0;

  epoch(): number {
    return this.#epoch;
  }

  /** The lines the store has not acknowledged and that are not already on their way; marks them in flight. */
  take(entries: readonly ConversationEntry[]): TakenLines {
    const taken: ConversationEntry[] = [];
    for (const entry of entries) {
      if (entry.recordedAt === undefined) continue;
      const key = conversationEntryIdentity(entry);
      if (this.#inFlight.has(key)) continue;
      const known = this.#reported.has(key);
      const learnedRun = this.#reported.get(key) === undefined && entry.requestId !== undefined;
      if (known && !learnedRun) continue;
      this.#inFlight.add(key);
      taken.push(entry);
    }
    return { entries: taken, epoch: this.#epoch };
  }

  /**
   * The store's answer for lines taken earlier. Acknowledged lines of the
   * current epoch are reported; refused lines, and any answer from before a
   * Clear, leave nothing behind and stay eligible for the next publish.
   */
  settle(taken: TakenLines, acknowledged: boolean): void {
    for (const entry of taken.entries) this.#inFlight.delete(conversationEntryIdentity(entry));
    if (!acknowledged || taken.epoch !== this.#epoch) return;
    for (const entry of taken.entries)
      this.#reported.set(conversationEntryIdentity(entry), entry.requestId);
  }

  /** Lines the main process itself relayed are already the store's; nothing about them is owed. */
  adopt(entries: readonly ConversationEntry[]): void {
    for (const entry of entries) {
      if (entry.recordedAt === undefined) continue;
      this.#reported.set(conversationEntryIdentity(entry), entry.requestId);
    }
  }

  /** The Clear: nothing sent before it may be marked after it. */
  reset(): void {
    this.#epoch += 1;
    this.#reported.clear();
    this.#inFlight.clear();
  }
}
