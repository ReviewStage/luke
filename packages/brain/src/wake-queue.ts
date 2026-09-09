import type { ScheduledTimer } from "@sidecar/runtime/vocabulary";
import { sameObservation } from "./observation-inbox.js";
import type { BrainWakeEvent } from "./wake-events.js";

/**
 * The wakes waiting for a turn. Nothing opens at once: wakes inside the
 * coalescing window open one turn together — a hook and the pass's edge for
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

export class WakeQueue {
  readonly #options: WakeQueueOptions;
  #pending: BrainWakeEvent[] = [];
  #timer: ScheduledTimer | undefined;

  constructor(options: WakeQueueOptions) {
    this.#options = options;
  }

  /** How many wakes are waiting for their turn to open. */
  size(): number {
    return this.#pending.length;
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
    for (const event of events) {
      if (!this.#pending.some((held) => sameObservation(held, event))) this.#pending.push(event);
    }
    while (this.#pending.length > this.#options.capacity) this.#pending.shift();
    this.#arm(this.#options.coalesceMs);
  }

  /** Drains every pending wake for a turn the host is opening anyway, and disarms the window. */
  take(): readonly BrainWakeEvent[] {
    this.#disarm();
    const events = this.#pending;
    this.#pending = [];
    return events;
  }

  /**
   * Puts wakes back at the front — they are still news — and opens them again
   * after `delayMs`: at once for a host that was not ready to open them, or
   * once a quiet has passed, at the coalescing window's length at least.
   */
  requeue(events: readonly BrainWakeEvent[], delayMs: number): void {
    this.#pending.unshift(...events);
    this.#arm(delayMs);
  }

  /** The wait a quiet earns: until it ends, or the coalescing window at least. */
  quietDelay(until: number): number {
    return Math.max(until - this.#options.now(), this.#options.coalesceMs);
  }

  /** Drops every pending wake and disarms the window: the memory they described is gone. */
  clear(): void {
    this.#disarm();
    this.#pending = [];
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
