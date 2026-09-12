/**
 * The cadence an observation keeps. What was a `setInterval` is a `Schedule`
 * driven by a fiber forked into a `Scope` the loop owns, so the scope closing
 * is what ends the loop and no handle is kept only to be handed back. The
 * generation, the gate, and the coalescing are the loop's own and stay as they
 * were: a caller reads `isCurrent` synchronously from inside its own pass.
 *
 * The scope each `start` makes is a child of the home the loop was handed, so
 * a loop the host arms is forked on the host's own runtime and ends when the
 * host's scope closes, whatever became of the `stop` that should have ended
 * it. `start` and `stop` themselves stay: what arms these loops is the
 * account gate opening and closing, not the composer's own lifetime, so a
 * sign-out disarms them while the host still stands.
 */
import { Duration, Effect, Schedule, type Scope } from "effect";
import {
  type CadenceHome,
  closeCadenceScope,
  forkIntoCadence,
  openCadenceScope,
} from "./effect/cadence.js";
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
  /** Where the cadence's fibers live: the host's runtime and the scope each `start` forks its own from. */
  home?: CadenceHome;
}

export class ObservationLoop {
  readonly #options: ObservationLoopOptions;
  readonly #home: CadenceHome | undefined;
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
    this.#home = options.home;
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
    const scope = openCadenceScope(this.#home);
    this.#scope = scope;
    forkIntoCadence(
      this.#home,
      scope,
      scheduleRepeat(Schedule.spaced(Duration.millis(this.#options.intervalMs)), this.#pass),
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
    if (scope) closeCadenceScope(this.#home, scope);
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
