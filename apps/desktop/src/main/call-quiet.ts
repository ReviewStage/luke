/**
 * How long another app must hold the microphone before it counts as a call.
 * The talk key opens Luke's own capture device before the exchange edge goes
 * active and releases it around the moment the edge goes inactive, with IPC
 * and CoreAudio ordering not guaranteed, so a brief foreign capture at either
 * end of every conversation is Luke himself. It also absorbs the probe some
 * apps make of the microphone on launch. Under the announcement batch window,
 * so a notice decided in a call's first instant is still pending when delivery
 * asks the gate.
 */
export const CALL_QUIET_ONSET_MS = 3_000;
/**
 * How long a capture may lapse before the call is over: a mute that reopens
 * the device, an app switching microphones, the hang-up moment itself.
 */
export const CALL_QUIET_RELEASE_MS = 15_000;

type Timer = ReturnType<typeof setTimeout>;
type Schedule = (callback: () => void, delayMs: number) => Timer;
type Cancel = (timer: Timer) => void;

export interface CallQuietGateOptions {
  /** Fires on each edge of {@link CallQuietGate.holding}. */
  onChange(holding: boolean): void;
  schedule?: Schedule;
  cancel?: Cancel;
}

/**
 * Decides whether a call is on from two deterministic facts: whether any app
 * is capturing from a microphone, and whether the capture is Luke's own
 * exchange. A foreign capture that lasts the onset becomes a hold; a hold
 * outlasts the capture by the release grace. Nothing a model wrote can reach
 * either input — the capture is a helper's reading of CoreAudio and the
 * exchange is the renderer's own status edge — so holding is the whole power.
 */
export class CallQuietGate {
  readonly #onChange: (holding: boolean) => void;
  readonly #schedule: Schedule;
  readonly #cancel: Cancel;
  #capturing = false;
  #exchangeActive = false;
  #holding = false;
  #onset: Timer | undefined;
  #release: Timer | undefined;

  constructor(options: CallQuietGateOptions) {
    this.#onChange = options.onChange;
    this.#schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.#cancel = options.cancel ?? ((timer) => clearTimeout(timer));
  }

  get holding(): boolean {
    return this.#holding;
  }

  /** `undefined` is an input the helper cannot read, which is not a capture. */
  setCapturing(running: boolean | undefined): void {
    this.#capturing = running === true;
    this.#apply();
  }

  setExchangeActive(active: boolean): void {
    this.#exchangeActive = active;
    this.#apply();
  }

  /** Drops every timer and the hold. Nothing fires after. */
  stop(): void {
    this.#clearOnset();
    this.#clearRelease();
    this.#capturing = false;
    this.#exchangeActive = false;
    this.#set(false);
  }

  #apply(): void {
    const foreign = this.#capturing && !this.#exchangeActive;
    if (foreign) {
      this.#clearRelease();
      if (this.#holding || this.#onset) return;
      this.#onset = this.#schedule(() => {
        this.#onset = undefined;
        this.#set(true);
      }, CALL_QUIET_ONSET_MS);
      return;
    }
    this.#clearOnset();
    if (!this.#holding || this.#release) return;
    this.#release = this.#schedule(() => {
      this.#release = undefined;
      this.#set(false);
    }, CALL_QUIET_RELEASE_MS);
  }

  #set(holding: boolean): void {
    if (holding === this.#holding) return;
    this.#holding = holding;
    this.#onChange(holding);
  }

  #clearOnset(): void {
    if (this.#onset) this.#cancel(this.#onset);
    this.#onset = undefined;
  }

  #clearRelease(): void {
    if (this.#release) this.#cancel(this.#release);
    this.#release = undefined;
  }
}
