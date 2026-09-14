/**
 * The cadence an observation keeps. What was a `setInterval` is a `Schedule`
 * driven by a fiber forked into the scope its arming runs in, so that scope
 * closing is what ends the loop and no handle is kept only to be handed back.
 * The generation, the gate, and the coalescing are the loop's own and stay as
 * they were: a caller reads `isCurrent` synchronously from inside its own
 * pass.
 *
 * A pass is an `Effect` and so is `refresh`, so the cadence's fiber and a
 * caller's own poke are the same work on the same runtime and nothing here
 * bridges to a promise. The one thing a pass still does outside its own fiber
 * is the follow-up a coalesced poke earns: `refresh` answers as soon as the
 * pass it waited on is done, and the queued pass behind it is a daemon,
 * exactly as the detached promise it replaces was.
 *
 * The loop no longer arms itself. `cadence` is what an arming stands up, and
 * whoever owns the edge that arms it — the account gate opening and closing,
 * which is not the loop's own lifetime — holds it in a `CadenceGate` of its
 * own, so a sign-out disarms the loop while the host still stands and the
 * host's close disarms whatever a sign-out missed.
 */
import { Deferred, Duration, Effect, FiberId, Schedule, type Scope } from "effect";
import { type CadenceGate, cadenceGate } from "./effect/cadence.js";
import { scheduleRepeat } from "./effect/timers.js";

export interface ObservationLoopOptions {
  gate: () => boolean;
  intervalMs: number;
  run: (generation: number) => Effect.Effect<void>;
  afterRun?: () => Effect.Effect<void>;
  /**
   * Where a pass the cadence started reports its own failure. The interval
   * before it kept running whatever a pass threw, so the schedule may not end
   * on one either, and a defect nobody wrote down would be the loop going
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
  /**
   * Open while a pass runs or a follow-up is queued behind it, and settled by
   * the pass that ends with nothing queued: what `settled` waits on, so a
   * caller that needs the roster as a pass just read it can wait past a pass
   * `refresh` found already running.
   */
  #idle: Deferred.Deferred<void> | undefined;

  /**
   * One pass of the cadence's own, and what a pass nobody awaits owes the
   * loop: a defect written down rather than a cadence gone quiet for the rest
   * of the run.
   */
  readonly #pass: Effect.Effect<void> = Effect.suspend(() =>
    this.#armed
      ? Effect.catchAllDefect(this.refresh, (defect) =>
          Effect.sync(() => {
            this.#report(
              `Observation pass failed: ${defect instanceof Error ? defect.message : String(defect)}`,
            );
          }),
        )
      : Effect.void,
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
            // A disarm ends the waiting too: a pass still in flight settles
            // nothing a waiter could use, and no follow-up will run.
            this.#settleIdle();
          }),
        ),
      ),
      Effect.asVoid,
    );
  });

  /** Settles whoever waits on `settled`, once, and opens the wait afresh for the next pass. */
  #settleIdle(): void {
    const idle = this.#idle;
    this.#idle = undefined;
    if (idle !== undefined) Deferred.unsafeDone(idle, Effect.void);
  }

  constructor(options: ObservationLoopOptions) {
    this.#options = options;
    this.#report = options.report ?? ((message) => void process.stderr.write(`${message}\n`));
  }

  get generation(): number {
    return this.#generation;
  }

  isCurrent(generation: number): boolean {
    return generation === this.#generation && this.#options.gate();
  }

  /**
   * Answers once no pass is running and none is queued behind it: at once
   * where the loop is idle, otherwise after the pass in flight and the
   * follow-up a coalesced `refresh` earned. `refresh` alone answers at once
   * when a pass is already running, so a caller that must read what a pass
   * wrote yields `refresh` and then this.
   */
  readonly settled: Effect.Effect<void> = Effect.suspend(() =>
    this.#idle === undefined ? Effect.void : Deferred.await(this.#idle),
  );

  readonly refresh: Effect.Effect<void> = Effect.suspend(() => {
    if (!this.#options.gate()) {
      // Nothing will run: a waiter on `settled` has nothing to wait for.
      this.#settleIdle();
      return Effect.void;
    }
    if (this.#running) {
      this.#queued = true;
      return Effect.void;
    }
    this.#idle ??= Deferred.unsafeMake<void>(FiberId.none);
    const generation = this.#generation;
    this.#running = true;
    return Effect.ensuring(
      this.#options.run(generation),
      Effect.suspend(() => {
        this.#running = false;
        // The hook re-checks what the clock alone changes, so it belongs to a
        // pass the loop still owns. A pass that outlived its stop has no clock
        // behind it — running the hook there would draw the roster again over
        // the empty one the stop just published.
        const after = this.isCurrent(generation) ? this.#options.afterRun?.() : undefined;
        if (!this.#queued) {
          this.#settleIdle();
          return after ?? Effect.void;
        }
        this.#queued = false;
        // The follow-up is forked however the hook ends, so the waiter on
        // `settled` is handed to the pass that will settle it, or to the
        // refresh that finds nothing to run and settles it itself.
        return Effect.ensuring(
          after ?? Effect.void,
          Effect.asVoid(Effect.forkDaemon(this.refresh)),
        );
      }),
    );
  });
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
