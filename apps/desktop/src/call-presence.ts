import type { MicrophoneReading } from "./microphone-use";
import { CALL_STATUS, type CallApp, type CallStatus } from "./shared/contracts";

/**
 * How long after a spoken exchange the microphone still counts as Luke's own.
 *
 * The helper already drops Luke's own processes by bundle identifier, so this
 * is the second line rather than the first: it covers the stretch where his
 * device has been released and the reading has not caught up, and the case
 * where the prefixes were wrong and his processes were named after all.
 */
export const CALL_PRESENCE_HANGOVER_MS = 1_500;

export interface CallPresenceOptions {
  onChanged(status: CallStatus): void;
  /**
   * An app that has just started using the microphone and is not on the ignore
   * list. It is what the prompt is drawn for, and it fires once per arrival
   * rather than for as long as the app holds the device: a countdown that
   * restarted every second would never run out.
   */
  onAppArrived?(app: CallApp): void;
  hangoverMs?: number;
}

/**
 * Decides whether the developer is on a call worth going quiet for.
 *
 * Three things narrow the microphone's answer to that one. Luke's own turns are
 * subtracted, because he opens the same device the call does. The ignore list
 * is subtracted, because a developer whose dictation app trips this all day
 * needs to be able to say "not that one". And a device that is running while
 * nobody on it can be named stays `UNAVAILABLE` rather than becoming a call —
 * an unnamed process cannot be checked against either of the other two, so
 * counting it would be holding notices on a reading nothing could refute.
 */
export class CallPresence {
  readonly #options: CallPresenceOptions;
  readonly #hangoverMs: number;
  #reading: MicrophoneReading | undefined;
  #ignored: ReadonlySet<string> = new Set();
  #exchangeActive = false;
  #hangover: NodeJS.Timeout | undefined;
  #status: CallStatus = CALL_STATUS.UNAVAILABLE;
  /** Which apps the last settled reading held, so an arrival can be told from a stay. */
  #present: ReadonlySet<string> = new Set();

  constructor(options: CallPresenceOptions) {
    this.#options = options;
    this.#hangoverMs = options.hangoverMs ?? CALL_PRESENCE_HANGOVER_MS;
  }

  get status(): CallStatus {
    return this.#status;
  }

  setReading(reading: MicrophoneReading | undefined): void {
    this.#reading = reading;
    this.#settle();
  }

  /** The ignore list as the settings store holds it, keyed by bundle identifier. */
  setIgnored(ignored: readonly CallApp[]): void {
    this.#ignored = new Set(ignored.map((app) => app.id));
    this.#settle();
  }

  /**
   * Whether a spoken exchange with Luke is live. The same statement the media
   * duck takes, and it arrives on the same channel.
   */
  setExchangeActive(active: boolean): void {
    if (active === this.#exchangeActive) return;
    this.#exchangeActive = active;
    this.#clearHangover();
    if (!active) {
      this.#hangover = setTimeout(() => {
        this.#hangover = undefined;
        this.#settle();
      }, this.#hangoverMs);
      this.#hangover.unref?.();
    }
    this.#settle();
  }

  /** Drops the hangover on the app's way out; nothing is announced. */
  stop(): void {
    this.#clearHangover();
  }

  #settle(): void {
    const named = this.#named();
    // Arrivals are read from the device rather than from what currently counts,
    // so that Luke's own turn does not empty the set and make every app on the
    // call look new the moment he stops talking.
    this.#announceArrivals(named);

    const status = this.#resolve(named);
    if (status === this.#status) return;
    this.#status = status;
    this.#options.onChanged(status);
  }

  /** The apps that would make this a call: named, and not ignored. */
  #named(): readonly CallApp[] {
    if (!this.#reading) return [];
    return this.#reading.apps.filter((app) => !this.#ignored.has(app.id));
  }

  /**
   * Says which apps are new since the last settled reading.
   *
   * Only ones that count: an app on the ignore list has already been answered
   * for, and prompting about it again would be asking the developer to make
   * the same decision every call.
   */
  #announceArrivals(named: readonly CallApp[]): void {
    const present = new Set(named.map((app) => app.id));
    for (const app of named) {
      if (this.#present.has(app.id)) continue;
      this.#options.onAppArrived?.(app);
    }
    this.#present = present;
  }

  #resolve(named: readonly CallApp[]): CallStatus {
    if (!this.#reading) return CALL_STATUS.UNAVAILABLE;
    // Luke's own turn is subtracted here rather than from the set above: while
    // he holds the device it is his, but who else is on it has not changed.
    if (this.#exchangeActive || this.#hangover !== undefined) return CALL_STATUS.OFF;
    if (named.length > 0) return CALL_STATUS.ON;
    // Running with nobody nameable on it: an unnamed process cannot be checked
    // against the ignore list or against Luke's own, so this is a reading
    // nothing can act on rather than a call or the absence of one.
    if (this.#reading.running && this.#reading.apps.length === 0) {
      return CALL_STATUS.UNAVAILABLE;
    }
    return CALL_STATUS.OFF;
  }

  #clearHangover(): void {
    if (this.#hangover === undefined) return;
    clearTimeout(this.#hangover);
    this.#hangover = undefined;
  }
}
