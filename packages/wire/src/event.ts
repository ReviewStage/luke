import { type IDisposable, toDisposable } from "./lifecycle.js";

/**
 * Subscribing is calling the event itself, and what comes back is the
 * unsubscribe. A listener therefore reaches nothing of the emitter, so an
 * owner can only end its own subscription and never the round, the emitter, or
 * anyone else's.
 */
export type Event<T> = (listener: (value: T) => void) => IDisposable;

/**
 * One subscription, identified by this object rather than by the function it
 * holds, so the same function subscribed twice is two subscriptions and one
 * owner's unsubscribe cannot end the other's.
 */
interface Subscription<T> {
  readonly listener: (value: T) => void;
}

const INERT: IDisposable = { dispose: () => {} };

/**
 * The one side that may fire. A composition keeps the emitter and publishes
 * only its `event`, which is what makes a subscriber unable to speak in the
 * emitter's name.
 */
export class Emitter<T> implements IDisposable {
  readonly #subscriptions = new Set<Subscription<T>>();
  #disposed = false;

  readonly event: Event<T> = (listener) => {
    if (this.#disposed) return INERT;
    const subscription: Subscription<T> = { listener };
    this.#subscriptions.add(subscription);
    return toDisposable(() => {
      this.#subscriptions.delete(subscription);
    });
  };

  /**
   * Delivers to the subscriptions standing when the round opened, and to no
   * other: a listener subscribing from inside a round hears the next value
   * rather than this one, and one unsubscribed by an earlier listener in the
   * same round is not called at all, which is what makes disposing an owner
   * from inside a handler safe. A thrower stops none of the rest, for the same
   * reason a failed disposal does not, and the failures are reported together
   * once the round is complete; wire has no error reporter to hand them to,
   * and swallowing them here would lose them entirely.
   */
  fire(value: T): void {
    if (this.#disposed) return;
    const failures: unknown[] = [];
    let delivered = 0;
    for (const subscription of [...this.#subscriptions]) {
      if (!this.#subscriptions.has(subscription)) continue;
      delivered += 1;
      try {
        subscription.listener(value);
      } catch (failure) {
        failures.push(failure);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, `${failures.length} of ${delivered} listeners failed`);
    }
  }

  /**
   * Drops every subscription and fires nothing further. The listeners are the
   * emitter's own bookkeeping rather than things it created, so nothing of
   * theirs is disposed here: an owner ends its own subscription, and a store
   * ends what a composition built.
   */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#subscriptions.clear();
  }
}
