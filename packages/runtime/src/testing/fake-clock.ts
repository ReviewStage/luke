import { type IDisposable, toDisposable } from "@sidecar/wire";
import type { Clock, ScheduledTimer } from "../vocabulary.js";
import { drainMicrotasks } from "./drain.js";

interface ArmedTimer {
  callback: () => void;
  /** The instant the timer is due, on this clock's own reading. */
  at: number;
  delayMs: number;
}

/**
 * A clock a test drives by hand: nothing is due until the test advances or
 * fires, so a deadline can be crossed without waiting out a real one.
 */
export class FakeClock implements Clock {
  /** The instant every reading answers with, moved by the test or by a fire. */
  instant: number;
  /** Every timer still armed, in the order it was scheduled. */
  readonly timers = new Map<ScheduledTimer, ArmedTimer>();
  /** Every delay ever asked for, in order, including timers since cancelled. */
  readonly delays: number[] = [];

  constructor(instant = 1_800_000_000_000) {
    this.instant = instant;
  }

  now = (): number => this.instant;

  schedule = (delayMs: number, run: () => void): IDisposable => {
    const handle = this.scheduleTimer(run, delayMs);
    return toDisposable(() => this.cancelTimer(handle));
  };

  /**
   * The same schedule for a component still taking a callback and a token
   * beside a canceller rather than a {@link Clock}. One table stands behind
   * both, so `advance`, `fireAll`, and `armed` cover whatever armed them.
   */
  scheduleTimer = (callback: () => void, delayMs: number): ScheduledTimer => {
    const handle: ScheduledTimer = {};
    this.delays.push(delayMs);
    this.timers.set(handle, { callback, at: this.instant + delayMs, delayMs });
    return handle;
  };

  cancelTimer = (timer: ScheduledTimer): void => {
    this.timers.delete(timer);
  };

  /** Runs every timer due at or before `untilMs`, in due order, draining between each. */
  async advance(untilMs: number): Promise<void> {
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= untilMs)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.instant = Math.max(this.instant, due[1].at);
      due[1].callback();
      await drainMicrotasks(20);
    }
    this.instant = Math.max(this.instant, untilMs);
  }

  /**
   * Runs every timer armed now, whatever its deadline, and only those: a
   * callback that arms another leaves it for the next fire.
   */
  fireAll(): void {
    for (const [handle, timer] of [...this.timers]) {
      this.timers.delete(handle);
      timer.callback();
    }
  }

  armed(): number {
    return this.timers.size;
  }
}
