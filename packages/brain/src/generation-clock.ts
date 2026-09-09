import type { ScheduledTimer } from "@sidecar/runtime/vocabulary";
import { type BrainPersistedState, brainGenerationExpired } from "./envelope.js";
import type { BrainStateStore } from "./state-store.js";

export interface BrainGenerationClockOptions {
  store: BrainStateStore;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => ScheduledTimer;
  cancel?: (timer: ScheduledTimer) => void;
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
 * an agent's own door check asking first costs nothing. On the host's own
 * timers the clock is unreferenced: housekeeping never holds a process open,
 * and the next launch's load covers a generation found dead.
 */
export class BrainGenerationClock {
  readonly #store: BrainStateStore;
  readonly #now: () => number;
  readonly #schedule: (callback: () => void, delayMs: number) => ScheduledTimer;
  readonly #cancel: (timer: ScheduledTimer) => void;
  #timer: ScheduledTimer | undefined;
  #unsubscribe: (() => void) | undefined;
  #stopped = false;

  constructor(options: BrainGenerationClockOptions) {
    this.#store = options.store;
    this.#now = options.now ?? Date.now;
    this.#schedule =
      options.schedule ?? ((callback, delayMs) => globalThis.setTimeout(callback, delayMs).unref());
    this.#cancel =
      options.cancel ??
      ((timer) => {
        // SAFETY: a timer this clock scheduled itself came from setTimeout above.
        globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>);
      });
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
    if (brainGenerationExpired(state, this.#now())) {
      this.#store.expireIfDue(this.#now());
      return;
    }
    this.#timer = this.#schedule(() => {
      this.#timer = undefined;
      this.#store.expireIfDue(this.#now());
    }, state.expiresAt - this.#now());
  }

  #disarm(): void {
    if (this.#timer === undefined) return;
    this.#cancel(this.#timer);
    this.#timer = undefined;
  }
}
