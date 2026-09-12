/**
 * The cadence an observation keeps. What was a `setInterval` is a `Schedule`
 * driven by a fiber forked into the scope its arming runs in, so that scope
 * closing is what ends the loop and no handle is kept only to be handed back.
 * The generation, the gate, and the coalescing are the loop's own and stay as
 * they were: a caller reads `isCurrent` synchronously from inside its own
 * pass.
 *
 * The loop no longer arms itself. `cadence` is what an arming stands up, and
 * whoever owns the edge that arms it — the account gate opening and closing,
 * which is not the loop's own lifetime — holds it in a `CadenceGate` of its
 * own, so a sign-out disarms the loop while the host still stands and the
 * host's close disarms whatever a sign-out missed.
 */
import { Duration, Effect, Schedule, type Scope } from "effect";
import { type CadenceGate, cadenceGate } from "./effect/cadence.js";
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
}

export class ObservationLoop {
  readonly #options: ObservationLoopOptions;
  readonly #report: (message: string) => void;
  #generation = 0;
  #running = false;
  #queued = false;
  #armed = false;

  readonly #pass = Effect.suspend(() =>
    this.#armed ? Effect.promise(() => this.#reportedPass()) : Effect.void,
  );

  /**
   * What an arming stands up, in the scope the arming runs in: the cadence's
   * own fiber, and the generation bumped when that scope closes. The bump is
   * registered after the fork so it runs before the interruption, which is
   * the order the disarm always had — a pass the interruption has not reached
   * yet finds the loop disarmed and runs nothing.
   */
  readonly cadence: Effect.Effect<void, never, Scope.Scope> = Effect.suspend(() => {
    if (this.#armed || !this.#options.gate()) return Effect.void;
    this.#armed = true;
    return scheduleRepeat(
      Schedule.spaced(Duration.millis(this.#options.intervalMs)),
      this.#pass,
    ).pipe(
      Effect.zipRight(
        Effect.addFinalizer(() =>
          Effect.sync(() => {
            this.#generation += 1;
            this.#queued = false;
            this.#armed = false;
          }),
        ),
      ),
      Effect.asVoid,
    );
  });

  constructor(options: ObservationLoopOptions) {
    this.#options = options;
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

/**
 * The loops armed and disarmed together, as one gate over all their cadences.
 *
 * Deliberately latched, where the supervisor it replaces was not. An arming
 * used to be re-tried because a loop behind a gate of its own may still have
 * been closed when the first one ran; the one edge that arms these — the
 * account gate — is now open whenever it arms, so the loops behind it are
 * open too, and an arm over a cadence already standing has nothing to add.
 */
export const observationSupervisor = (
  loops: readonly ObservationLoop[],
): Effect.Effect<CadenceGate, never, Scope.Scope> =>
  cadenceGate(Effect.forEach(loops, (loop) => loop.cadence, { discard: true }));
