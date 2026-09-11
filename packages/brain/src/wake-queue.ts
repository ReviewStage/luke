import type { ScheduledTimer } from "@sidecar/runtime/vocabulary";
import { Effect } from "effect";
import { makeWakeEventQueue, type WakeEventQueue } from "./effect/wake-queue.js";
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
 * Where the wakes themselves stand is `../effect/wake-queue.ts`'s `Queue`;
 * this class is the synchronous facade every caller here still holds, and
 * `Effect.runSync` is the bridge, safe because every operation that module
 * exposes is one that never suspends. It is a named strangler shim —
 * `docs/adr/0001-effect.md` carries it — deleted in P5-14b once the turn
 * runner and its callers hold a fiber of their own instead of this class.
 */
export class WakeQueue {
  readonly #options: WakeQueueOptions;
  readonly #queue: WakeEventQueue;
  #timer: ScheduledTimer | undefined;

  constructor(options: WakeQueueOptions) {
    this.#options = options;
    this.#queue = Effect.runSync(makeWakeEventQueue(options.capacity));
  }

  /** How many wakes are waiting for their turn to open. */
  size(): number {
    return Effect.runSync(this.#queue.size);
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
    Effect.runSync(this.#queue.push(events));
    this.#arm(this.#options.coalesceMs);
  }

  /** Drains every pending wake for a turn the host is opening anyway, and disarms the window. */
  take(): readonly BrainWakeEvent[] {
    this.#disarm();
    return Effect.runSync(this.#queue.take);
  }

  /**
   * Puts wakes back at the front — they are still news — and opens them again
   * after `delayMs`: at once for a host that was not ready to open them, or
   * once a quiet has passed, at the coalescing window's length at least.
   */
  requeue(events: readonly BrainWakeEvent[], delayMs: number): void {
    Effect.runSync(this.#queue.requeueFront(events));
    this.#arm(delayMs);
  }

  /** The wait a quiet earns: until it ends, or the coalescing window at least. */
  quietDelay(until: number): number {
    return Math.max(until - this.#options.now(), this.#options.coalesceMs);
  }

  /** Drops every pending wake and disarms the window: the memory they described is gone. */
  clear(): void {
    this.#disarm();
    Effect.runSync(this.#queue.clear);
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
