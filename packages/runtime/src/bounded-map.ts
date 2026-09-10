/**
 * A map that never grows past its capacity: once it is full, the next entry
 * evicts the oldest one. What a bounded map is for is a cache or a ledger of
 * recent answers, where forgetting the oldest costs a repeated read and
 * keeping everything costs a process that grows for as long as it runs.
 *
 * A key written again becomes the newest rather than keeping its first
 * position, so a map written on every reach ages by last write. Reading
 * refreshes nothing: a read that moved an entry would make the eviction order
 * depend on who looked, which is not what any caller here means by oldest.
 */
export class BoundedMap<Key, Value> {
  readonly #entries = new Map<Key, Value>();
  readonly #capacity: number;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError("a bounded map's capacity must be a positive integer");
    }
    this.#capacity = capacity;
  }

  get size(): number {
    return this.#entries.size;
  }

  get(key: Key): Value | undefined {
    return this.#entries.get(key);
  }

  set(key: Key, value: Value): this {
    this.#entries.delete(key);
    this.#entries.set(key, value);
    while (this.#entries.size > this.#capacity) {
      const oldest = this.#entries.keys().next();
      if (oldest.done) break;
      this.#entries.delete(oldest.value);
    }
    return this;
  }

  delete(key: Key): boolean {
    return this.#entries.delete(key);
  }

  clear(): void {
    this.#entries.clear();
  }

  /** Oldest first, the order eviction follows. */
  keys(): IterableIterator<Key> {
    return this.#entries.keys();
  }
}
