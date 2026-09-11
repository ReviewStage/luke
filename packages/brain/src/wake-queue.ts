import type { ScheduledTimer } from "@sidecar/runtime/vocabulary";
import { MutableRef } from "effect";
import { sameObservation } from "./observation-inbox.js";
import type { BrainWakeEvent } from "./wake-events.js";

/**
 * The wakes waiting for a turn. Nothing opens at once: wakes inside the
 * coalescing window open one turn together — a hook and the poll's edge for
 * the same stop — and wakes during a model's quiet wait for it to end rather
 * than being dropped. The queue owns the events and the timer; the host owns
 * what a flush does with them, and hands events back when the turn they
 * opened sent nothing, so they open again once the quiet ends.
 */
export interface WakeQueueOptions {
  coalesceMs: number;
  /** The most wakes held for one turn. */
  capacity: number;
  now: () => number;
  schedule: (callback: () => void, delayMs: number) => ScheduledTimer;
  cancel: (timer: ScheduledTimer) => void;
  /** The moment the model may be asked again, or nothing when it may be asked now. */
  quietUntil: () => number | undefined;
  /** Opens a turn over the events taken; the host decides in what and how. */
  flush: (events: readonly BrainWakeEvent[]) => void;
}

/**
 * Where the wakes stand is a `MutableRef` over the list itself: every
 * operation this class performs — count, append, drain, prepend, drop — is
 * decided and applied in one uninterrupted step of the calling turn, with
 * nothing to wait on, so the storage is stated synchronously rather than as
 * an effect that could only be run here. What the queue guarantees is
 * unchanged: the same observation delivered twice is one entry, past the
 * capacity the oldest goes, and a requeue prepends unbounded because those
 * events are still news.
 */
export class WakeQueue {
  readonly #options: WakeQueueOptions;
  readonly #events: MutableRef.MutableRef<readonly BrainWakeEvent[]> = MutableRef.make<
    readonly BrainWakeEvent[]
  >([]);
  #timer: ScheduledTimer | undefined;

  constructor(options: WakeQueueOptions) {
    this.#options = options;
  }

  /** How many wakes are waiting for their turn to open. */
  size(): number {
    return MutableRef.get(this.#events).length;
  }

  /**
   * Queues wakes and arms the coalescing window, once. The same hook for the
   * same session at the same instant, delivered twice before the turn opened,
   * is one wake: the delta read covers both, and two entries would only say
   * the same thing twice. Past the capacity the oldest go, since the delta
   * read covers what they said too.
   */
  push(events: readonly BrainWakeEvent[]): void {
    if (events.length === 0) return;
    const held = [...MutableRef.get(this.#events)];
    for (const event of events) {
      if (!held.some((entry) => sameObservation(entry, event))) held.push(event);
    }
    const capacity = this.#options.capacity;
    MutableRef.set(
      this.#events,
      held.length > capacity ? held.slice(held.length - capacity) : held,
    );
    this.#arm(this.#options.coalesceMs);
  }

  /** Drains every pending wake for a turn the host is opening anyway, and disarms the window. */
  take(): readonly BrainWakeEvent[] {
    this.#disarm();
    const held = MutableRef.get(this.#events);
    MutableRef.set(this.#events, []);
    return held;
  }

  /**
   * Puts wakes back at the front — they are still news — and opens them again
   * after `delayMs`: at once for a host that was not ready to open them, or
   * once a quiet has passed, at the coalescing window's length at least.
   */
  requeue(events: readonly BrainWakeEvent[], delayMs: number): void {
    if (events.length > 0) {
      MutableRef.set(this.#events, [...events, ...MutableRef.get(this.#events)]);
    }
    this.#arm(delayMs);
  }

  /** The wait a quiet earns: until it ends, or the coalescing window at least. */
  quietDelay(until: number): number {
    return Math.max(until - this.#options.now(), this.#options.coalesceMs);
  }

  /** Drops every pending wake and disarms the window: the memory they described is gone. */
  clear(): void {
    this.#disarm();
    MutableRef.set(this.#events, []);
  }

  #arm(delayMs: number): void {
    if (this.#timer !== undefined) return;
    this.#timer = this.#options.schedule(() => {
      this.#timer = undefined;
      this.#flush();
    }, delayMs);
  }

  #disarm(): void {
    if (this.#timer === undefined) return;
    this.#options.cancel(this.#timer);
    this.#timer = undefined;
  }

  #flush(): void {
    const quietUntil = this.#options.quietUntil();
    if (quietUntil !== undefined) {
      this.#arm(this.quietDelay(quietUntil));
      return;
    }
    const events = this.take();
    if (events.length > 0) this.#options.flush(events);
  }
}
