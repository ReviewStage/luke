/**
 * The one owner of what a turn owes about words entering its context: the
 * opening words it was planned with, and the words steered into its run
 * while it ran. Delivered means on disk. A checkpoint that lands settles the
 * opening words and every steered word the runtime had ingested by then;
 * words the runtime never ingested settle not delivered when the run ends;
 * words ingested but carried by no checkpoint settle not delivered when the
 * turn ends. Nothing else answers a delivery, so an asker who waits here is
 * answered from the store's state and never from how the turn ended.
 */
export class SteeredDeliveries {
  #openingPersisted = false;
  #waiting: { ingested: boolean; settle: (delivered: boolean) => void }[] = [];

  /** Whether a checkpoint carrying the turn's opening words has landed. */
  get openingPersisted(): boolean {
    return this.#openingPersisted;
  }

  /** Words steered into the run; settles once a checkpoint carries them, or not at all when the run ends first. */
  steered(): Promise<boolean> {
    return new Promise((settle) => {
      this.#waiting.push({ ingested: false, settle });
    });
  }

  /** The runtime read every steered word at a model boundary; they are in the context from here on. */
  ingested(): void {
    for (const waiting of this.#waiting) waiting.ingested = true;
  }

  /** A checkpoint landed: the opening words are on disk, and so is every steered word ingested by then. */
  persisted(): void {
    this.#openingPersisted = true;
    const carried = this.#waiting.filter((waiting) => waiting.ingested);
    this.#waiting = this.#waiting.filter((waiting) => !waiting.ingested);
    for (const waiting of carried) waiting.settle(true);
  }

  /** The run ended: words it never ingested were never in the context; ingested ones wait for the turn's final checkpoint. */
  runEnded(): void {
    const kept = this.#waiting.filter((waiting) => waiting.ingested);
    for (const waiting of this.#waiting.filter((waiting) => !waiting.ingested)) {
      waiting.settle(false);
    }
    this.#waiting = kept;
  }

  /** The turn ended: whatever no checkpoint carried is owed still. */
  turnEnded(): void {
    const owed = this.#waiting.splice(0);
    for (const waiting of owed) waiting.settle(false);
  }
}
