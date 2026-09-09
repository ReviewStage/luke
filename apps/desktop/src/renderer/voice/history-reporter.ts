import { type ConversationEntry, conversationEntryIdentity } from "@sidecar/session";

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

  /** Whether the store has yet to acknowledge this line: not yet sent, or sent and still unanswered. */
  pending(entry: ConversationEntry): boolean {
    if (entry.recordedAt === undefined) return false;
    const key = conversationEntryIdentity(entry);
    if (this.#inFlight.has(key)) return true;
    if (!this.#reported.has(key)) return true;
    return this.#reported.get(key) === undefined && entry.requestId !== undefined;
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

/**
 * The thread after a relay from the main process: the relayed lines, with this
 * window's own lines the store has not yet acknowledged kept in their places.
 * A relay is the store's thread as it stood when another writer's line landed,
 * so it cannot yet hold a line of this window's still on its way — and the
 * acknowledgement of that line is never echoed back here — so dropping it
 * would lose the developer's spoken words and the mark that ties them to
 * their run. The local objects are kept as they are, because the spoken-turn
 * marks find their lines by identity. Only the Clear discards pending lines,
 * on its own command.
 */
export function withPendingLines(
  relayed: readonly ConversationEntry[],
  current: readonly ConversationEntry[],
  pending: (entry: ConversationEntry) => boolean,
): readonly ConversationEntry[] {
  const held = new Set(relayed.map(conversationEntryIdentity));
  const kept = current.filter(
    (entry) => !held.has(conversationEntryIdentity(entry)) && pending(entry),
  );
  if (kept.length === 0) return relayed;
  const merged = [...relayed];
  for (const entry of kept) {
    let at = merged.length;
    while (at > 0) {
      const before = merged[at - 1]?.recordedAt;
      if (before === undefined || before <= (entry.recordedAt ?? before)) break;
      at -= 1;
    }
    merged.splice(at, 0, entry);
  }
  return merged;
}
