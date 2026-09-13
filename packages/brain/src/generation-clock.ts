import { type Clock, Duration, Effect, FiberId, type Scope } from "effect";
import type { Detach } from "./effect/carry.js";
import { type BrainPersistedState, brainGenerationExpired } from "./envelope.js";
import type { BrainStateStore } from "./state-store.js";

export interface BrainGenerationClockOptions {
  store: BrainStateStore;
  /**
   * The clock this conversation's expiry is read and slept on, so the instant
   * the wait is armed for and the instant the store is judged against are
   * stamped by one clock and never two.
   */
  clock: Clock.Clock;
  /**
   * The door a replacement arms its wait through. A store's `onReplaced` is a
   * synchronous callback with nowhere to answer, so only a run gives it a
   * fiber to sleep on at all; nothing of the wait stands in the step that
   * armed it, since its first step is the sleep.
   */
  detach: Detach;
  /**
   * The scope the wait is forked into — its owner's, one for every
   * conversation — so a clock nobody stopped ends with the wiring that built
   * it rather than firing into a host that is gone.
   */
  scope: Scope.Scope;
}

/**
 * The generation's clock, for a store whose automatic reset is enabled; under
 * the default policy it arms nothing. Otherwise one wait per store is armed at the standing
 * generation's expiry instant and re-armed whenever the store begins another,
 * so a generation dies on time whether or not an agent stands to check its
 * door — a key removed, an account signed out, or an app left open past the
 * fortnight all leave the file to this. Starting it loads the store, which is
 * also where a file found expired, unreadable, or past its bounds at launch
 * is replaced on disk. Firing asks the store, the one judge of the moment;
 * an agent's own door check asking first costs nothing. The wait is a fiber
 * sleeping on the clock above rather than an unreferenced host timer: what
 * ends a wait nobody disarmed is the owner's scope closing, and the next
 * launch's load covers a generation found dead.
 */
export class BrainGenerationClock {
  readonly #store: BrainStateStore;
  readonly #clock: Clock.Clock;
  readonly #detach: Detach;
  readonly #scope: Scope.Scope;
  #disarm: (() => void) | undefined;
  #unsubscribe: (() => void) | undefined;
  #stopped = false;

  constructor(options: BrainGenerationClockOptions) {
    this.#store = options.store;
    this.#clock = options.clock;
    this.#detach = options.detach;
    this.#scope = options.scope;
  }

  /** Loads the store, arms the wait for the generation that stands, and follows every replacement. */
  start(): Effect.Effect<void> {
    return Effect.gen(this, function* () {
      this.#unsubscribe ??= this.#store.onReplaced((state) => this.#arm(state));
      const state = yield* Effect.promise(() => this.#store.load());
      if (!this.#stopped) this.#arm(this.#store.current() ?? state);
    });
  }

  stop(): void {
    this.#stopped = true;
    this.#disarmWait();
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
  }

  #now(): number {
    return this.#clock.unsafeCurrentTimeMillis();
  }

  #arm(state: BrainPersistedState): void {
    this.#disarmWait();
    if (this.#stopped || !this.#store.automaticReset) return;
    if (brainGenerationExpired(state, this.#now())) {
      this.#store.expireIfDue(this.#now());
      return;
    }
    const fiber = this.#detach(
      Effect.andThen(
        this.#clock.sleep(Duration.millis(state.expiresAt - this.#now())),
        Effect.sync(() => {
          this.#disarm = undefined;
          this.#store.expireIfDue(this.#now());
        }),
      ),
      { scope: this.#scope },
    );
    this.#disarm = () => {
      fiber.unsafeInterruptAsFork(FiberId.none);
    };
  }

  #disarmWait(): void {
    const disarm = this.#disarm;
    if (disarm === undefined) return;
    this.#disarm = undefined;
    disarm();
  }
}
