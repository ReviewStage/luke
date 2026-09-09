/**
 * Collapses concurrent asks under one key into one run, so the work happens
 * once and every caller awaits the same outcome. The flight is forgotten the
 * moment its promise settles, a rejection included: a key left occupied by a
 * failed run would answer every later ask with that same failure, and the
 * work would be undoable for as long as the map stands.
 *
 * A key is one identifier. Where two identifiers name a flight together, the
 * caller nests a `SingleFlight` inside a map of the other one rather than
 * joining them into a string, so neither identifier can be spelled into the
 * other's.
 */
export class SingleFlight<Key, Value> {
  readonly #flights = new Map<Key, Promise<Value>>();

  /**
   * The run standing for the key, started here when none does. `start` is
   * called only for a flight this call opened, so a joiner never runs the
   * work a second time.
   */
  run(key: Key, start: () => Promise<Value>): Promise<Value> {
    const held = this.#flights.get(key);
    if (held) return held;
    const flight = start().finally(() => {
      this.#flights.delete(key);
    });
    this.#flights.set(key, flight);
    return flight;
  }
}
