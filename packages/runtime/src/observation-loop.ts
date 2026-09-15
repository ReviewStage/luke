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
 * exactly as the detached promise it replaces was. A caller whose decision
 * needs that follow-up's result too yields `settled` after `refresh`: it
 * answers once no pass is running and none is queued behind it.
 *
 * The loop no longer arms itself. `cadence` is what an arming stands up, and
 * whoever owns the edge that arms it — the account gate opening and closing,
 * which is not the loop's own lifetime — holds it in a `CadenceGate` of its
 * own, so a sign-out disarms the loop while the host still stands and the
 * host's close disarms whatever a sign-out missed.
 */
import { Deferred, Duration, Effect, Schedule, type Scope } from "effect";
import { type CadenceGate, cadenceGate } from "./effect/cadence.js";
import { scheduleRepeat } from "./effect/timers.js";

export interface ObservationLoopOptions {
  gate: () => boolean;
  intervalMs: number;
  run: (generation: number) => Effect.Effect<void>;
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
   * Open from the moment a pass begins until a pass ends with nothing queued
   * behind it, so a follow-up a coalesced poke earned keeps it open across
   * the gap between the pass that queued it and the daemon that runs it.
   * Nothing while the loop is idle.
   */
  #idle: Deferred.Deferred<void> | undefined;

  /**
   * One pass of the cadence's own, and what a pass nobody awaits owes the
   * loop: a defect written down rather than a cadence gone quiet for the rest
   * of the run.
   */
  readonly #pass: Effect.Effect<void> = Effect.suspend(() =>
    this.#armed
      ? Effect.catchDefect(this.refresh, (defect) =>
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
      Effect.andThen(
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

  get generation(): number {
    return this.#generation;
  }

  isCurrent(generation: number): boolean {
    return generation === this.#generation && this.#options.gate();
  }

  readonly refresh: Effect.Effect<void> = Effect.suspend(() => {
    if (!this.#options.gate()) {
      // A follow-up that found the gate closed runs nothing, and nothing else
      // will end the settling it was queued under; a poke that finds the gate
      // closed while a pass still runs leaves the settling to that pass.
      if (!this.#running) this.#settle();
      return Effect.void;
    }
    if (this.#running) {
      this.#queued = true;
      return Effect.void;
    }
    const generation = this.#generation;
    this.#running = true;
    this.#idle ??= Deferred.makeUnsafe<void>();
    return Effect.ensuring(
      this.#options.run(generation),
      Effect.suspend(() => {
        this.#running = false;
        if (!this.#queued) {
          this.#settle();
          return Effect.void;
        }
        this.#queued = false;
        return Effect.asVoid(Effect.forkDetach(this.refresh));
      }),
    );
  });

  /**
   * Answers once no pass is running and no follow-up is queued behind one; at
   * once while the loop is idle. `refresh` alone answers as soon as the pass
   * it found running is done, which may be before the follow-up its own poke
   * earned has run, so a decision that must read what that follow-up wrote
   * yields `refresh` and then this.
   */
  readonly settled: Effect.Effect<void> = Effect.suspend(() =>
    this.#idle ? Deferred.await(this.#idle) : Effect.void,
  );

  #settle(): void {
    const idle = this.#idle;
    if (idle === undefined) return;
    this.#idle = undefined;
    Deferred.doneUnsafe(idle, Effect.void);
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
