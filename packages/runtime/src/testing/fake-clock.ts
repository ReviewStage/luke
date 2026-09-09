import type { ScheduledTimer } from "../vocabulary.js";
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
export class FakeClock {
  now: number;
  /** Every timer still armed, in the order it was scheduled. */
  readonly timers = new Map<ScheduledTimer, ArmedTimer>();
  /** Every delay ever asked for, in order, including timers since cancelled. */
  readonly delays: number[] = [];

  constructor(now = 1_800_000_000_000) {
    this.now = now;
  }

  schedule = (callback: () => void, delayMs: number): ScheduledTimer => {
    const handle: ScheduledTimer = {};
    this.delays.push(delayMs);
    this.timers.set(handle, { callback, at: this.now + delayMs, delayMs });
    return handle;
  };

  cancel = (timer: ScheduledTimer): void => {
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
      this.now = Math.max(this.now, due[1].at);
      due[1].callback();
      await drainMicrotasks(20);
    }
    this.now = Math.max(this.now, untilMs);
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
