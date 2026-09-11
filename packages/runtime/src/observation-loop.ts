/**
 * The cadence an observation keeps. What was a `setInterval` is a `Schedule`
 * driven by a fiber forked into a `Scope` the loop owns, so the scope closing
 * is what ends the loop and no handle is kept only to be handed back. The
 * generation, the gate, and the coalescing are the loop's own and stay as they
 * were: a caller reads `isCurrent` synchronously from inside its own pass.
 *
 * `start` and `stop` are the adaptor over that scope while the composers that
 * arm these loops are still written in promises; P7-10 deletes them once every
 * one of those composers is a `Layer` and the scope is the host's own.
 */
import { Duration, Effect, Exit, Runtime, Schedule, Scope } from "effect";
import { scheduleRepeat } from "./effect/timers.js";

export interface ObservationLoopOptions {
  gate: () => boolean;
  intervalMs: number;
  run: (generation: number) => Promise<void>;
  afterRun?: () => void;
  /**
   * Where a pass the cadence started reports its own failure. The interval
   * before it kept running whatever a pass threw, so the schedule may not end
   * on one either, and a rejection nobody wrote down would be the loop going
   * quiet for the rest of the run.
   */
  report?: (message: string) => void;
  /** The runtime the cadence is forked on, for a caller (a test today) that holds its own. */
  runtime?: Runtime.Runtime<never>;
}

export class ObservationLoop {
  readonly #options: ObservationLoopOptions;
  readonly #runtime: Runtime.Runtime<never>;
  readonly #report: (message: string) => void;
  #generation = 0;
  #running = false;
  #queued = false;
  #scope: Scope.CloseableScope | undefined;

  readonly #pass = Effect.suspend(() =>
    this.#scope === undefined ? Effect.void : Effect.promise(() => this.#reportedPass()),
  );

  constructor(options: ObservationLoopOptions) {
    this.#options = options;
    this.#runtime = options.runtime ?? Runtime.defaultRuntime;
    this.#report = options.report ?? ((message) => void process.stderr.write(`${message}\n`));
  }

  async #reportedPass(): Promise<void> {
    try {
      await this.refresh();
    } catch (error) {
      this.#report(
        `Observation pass failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  get generation(): number {
    return this.#generation;
  }

  isCurrent(generation: number): boolean {
    return generation === this.#generation && this.#options.gate();
  }

  start(): void {
    if (this.#scope || !this.#options.gate()) return;
    const runSync = Runtime.runSync(this.#runtime);
    const scope = runSync(Scope.make());
    this.#scope = scope;
    runSync(
      Effect.provideService(
        scheduleRepeat(Schedule.spaced(Duration.millis(this.#options.intervalMs)), this.#pass),
        Scope.Scope,
        scope,
      ),
    );
  }

  /**
   * The scope is dropped before it is closed, so a pass the interruption has
   * not reached yet finds the loop disarmed and runs nothing. Closing is not
   * awaited, for the same reason cancelling a timer never was: what it has to
   * guarantee is that no further pass starts, never that the fiber has ended.
   */
  stop(): void {
    this.#generation += 1;
    this.#queued = false;
    const scope = this.#scope;
    this.#scope = undefined;
    if (scope) Runtime.runFork(this.#runtime)(Scope.close(scope, Exit.void));
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
      await this.#options.run(generation);
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
