/**
 * A value under two identifiers, held as a map of maps. The two keys stay two
 * keys: a provider id and the provider's own session id, or a run id and a
 * call id, are never joined into one string, so an identifier carrying the
 * separator cannot be read back as a different pair.
 */
export class NestedMap<Value> {
  readonly #outer = new Map<string, Map<string, Value>>();

  get(outer: string, inner: string): Value | undefined {
    return this.#outer.get(outer)?.get(inner);
  }

  set(outer: string, inner: string, value: Value): void {
    let held = this.#outer.get(outer);
    if (!held) {
      held = new Map();
      this.#outer.set(outer, held);
    }
    held.set(inner, value);
  }

  /** Drops one value, and the outer key with it once nothing is left under it. */
  delete(outer: string, inner: string): void {
    const held = this.#outer.get(outer);
    if (!held) return;
    held.delete(inner);
    if (held.size === 0) this.#outer.delete(outer);
  }

  /** Drops everything under one outer key. */
  deleteOuter(outer: string): void {
    this.#outer.delete(outer);
  }

  /**
   * Outer keys in insertion order, each with its inner map to read. Deleting
   * through {@link delete} while walking a group is safe: a Map's iteration
   * order is defined under removal of the entry being visited.
   */
  groups(): IterableIterator<[string, ReadonlyMap<string, Value>]> {
    return this.#outer.entries();
  }
}
