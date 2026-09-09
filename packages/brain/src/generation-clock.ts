import { type Clock, systemClock } from "@sidecar/runtime/vocabulary";
import type { IDisposable } from "@sidecar/wire";
import { type BrainPersistedState, brainGenerationExpired } from "./envelope.js";
import type { BrainStateStore } from "./state-store.js";

export interface BrainGenerationClockOptions {
  store: BrainStateStore;
  clock?: Clock;
}

/**
 * The generation's clock, for a store whose automatic reset is enabled; under
 * the default policy it arms nothing. Otherwise one timer per store is armed at the standing
 * generation's expiry instant and re-armed whenever the store begins another,
 * so a generation dies on time whether or not an agent stands to check its
 * door — a key removed, an account signed out, or an app left open past the
 * fortnight all leave the file to this. Starting it loads the store, which is
 * also where a file found expired, unreadable, or past its bounds at launch
 * is replaced on disk. Firing asks the store, the one judge of the moment;
 * an agent's own door check asking first costs nothing, and the next launch's
 * load covers a generation found dead.
 */
export class BrainGenerationClock {
  readonly #store: BrainStateStore;
  readonly #clock: Clock;
  #timer: IDisposable | undefined;
  #unsubscribe: (() => void) | undefined;
  #stopped = false;

  constructor(options: BrainGenerationClockOptions) {
    this.#store = options.store;
    this.#clock = options.clock ?? systemClock;
  }

  /** Loads the store, arms the timer for the generation that stands, and follows every replacement. */
  async start(): Promise<void> {
    this.#unsubscribe ??= this.#store.onReplaced((state) => this.#arm(state));
    const state = await this.#store.load();
    if (!this.#stopped) this.#arm(this.#store.current() ?? state);
  }

  stop(): void {
    this.#stopped = true;
    this.#disarm();
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
  }

  #arm(state: BrainPersistedState): void {
    this.#disarm();
    if (this.#stopped || !this.#store.automaticReset) return;
    if (brainGenerationExpired(state, this.#clock.now())) {
      this.#store.expireIfDue(this.#clock.now());
      return;
    }
    this.#timer = this.#clock.schedule(state.expiresAt - this.#clock.now(), () => {
      this.#timer = undefined;
      this.#store.expireIfDue(this.#clock.now());
    });
  }

  #disarm(): void {
    if (this.#timer === undefined) return;
    this.#timer.dispose();
    this.#timer = undefined;
  }
}
