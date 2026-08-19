import type { Effect } from "effect";
import { effectRuntime } from "./effect-runtime";

export interface ObservationLoopOptions {
  gate: () => boolean;
  intervalMs: number;
  run: (generation: number) => Effect.Effect<void>;
  afterRun?: () => void;
}

export class ObservationLoop {
  readonly #options: ObservationLoopOptions;
  #generation = 0;
  #running = false;
  #queued = false;
  #timer: NodeJS.Timeout | undefined;

  constructor(options: ObservationLoopOptions) {
    this.#options = options;
  }

  get generation(): number {
    return this.#generation;
  }

  isCurrent(generation: number): boolean {
    return generation === this.#generation && this.#options.gate();
  }

  start(): void {
    if (this.#timer || !this.#options.gate()) return;
    void this.refresh();
    this.#timer = setInterval(() => void this.refresh(), this.#options.intervalMs);
    this.#timer.unref();
  }

  stop(): void {
    this.#generation += 1;
    this.#queued = false;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  async refresh(): Promise<void> {
    if (!this.#options.gate()) return;
    if (this.#running) {
      this.#queued = true;
      return;
    }
    const generation = this.#generation;
    this.#running = true;
    try {
      await effectRuntime.runPromise(this.#options.run(generation));
    } finally {
      this.#running = false;
      // The hook re-checks what the clock alone changes, so it belongs to a
      // pass the loop still owns. A pass that outlived its stop has no clock
      // behind it — running the hook there would draw the roster again over
      // the empty one the stop just published.
      if (this.isCurrent(generation)) this.#options.afterRun?.();
      if (this.#queued) {
        this.#queued = false;
        void this.refresh();
      }
    }
  }
}

export class ObservationSupervisor {
  readonly #loops: readonly ObservationLoop[];

  constructor(loops: readonly ObservationLoop[]) {
    this.#loops = loops;
  }

  /**
   * Deliberately unlatched. Every loop starts behind a gate of its own that
   * may still be closed — a launch before the account arrives arms nothing —
   * so the call that matters is usually the second one, and a supervisor that
   * remembered it was already enabled would leave the loops stopped for the
   * rest of the run. The loops carry the idempotence instead: an armed loop
   * ignores `start`, and a stopped one ignores `stop`.
   */
  setEnabled(enabled: boolean): void {
    for (const loop of this.#loops) {
      if (enabled) loop.start();
      else loop.stop();
    }
  }
}
