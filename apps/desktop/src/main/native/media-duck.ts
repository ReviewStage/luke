import { NativeHelper, type NativeHelperProcess } from "./native-helper";

/**
 * The two words the helper takes. It holds the player-facing knowledge — which
 * apps, what levels, whose volume changes are the user's to keep — so this side
 * only ever says which of the two states the exchange is in.
 */
export const MEDIA_DUCK_COMMAND = {
  DUCK: "duck",
  RESTORE: "restore",
} as const;

type MediaDuckCommand = (typeof MEDIA_DUCK_COMMAND)[keyof typeof MEDIA_DUCK_COMMAND];

/**
 * How long quiet is held after an exchange ends before the players come back
 * up. A conversation is turns with gaps in them, and a volume that climbed in
 * every gap only to dive at the next word would pump; the hangover is longer
 * than the pause between a reply and the follow-up press.
 */
export const MEDIA_DUCK_RELEASE_DELAY_MS = 1_000;

/** Only the parts of a child process this needs, so a test can supply them. */
export type MediaDuckProcess = NativeHelperProcess;

export interface MediaDuckControllerOptions {
  /** Injectable so the ordering can be exercised without a Mac or a binary. */
  spawnHelper?: () => MediaDuckProcess | undefined;
  releaseDelayMs?: number;
}

/**
 * Holds the one decision — should the players be quiet right now — and tells
 * the helper only when the answer changes. The two inputs are the user's
 * setting and whether a spoken exchange is live; the asymmetry between them is
 * deliberate. An exchange ending waits out the hangover, because the next turn
 * is usually moments away. The setting going off restores at once, because
 * that is the user's own hand asking for their volume back.
 */
export class MediaDuckController {
  readonly #spawnHelper: (() => MediaDuckProcess | undefined) | undefined;
  readonly #releaseDelayMs: number;
  #helper: NativeHelper | undefined;
  #enabled = false;
  #exchangeActive = false;
  #ducked = false;
  #releaseTimer: NodeJS.Timeout | undefined;

  constructor(options: MediaDuckControllerOptions = {}) {
    this.#spawnHelper = options.spawnHelper;
    this.#releaseDelayMs = options.releaseDelayMs ?? MEDIA_DUCK_RELEASE_DELAY_MS;
  }

  setEnabled(enabled: boolean): void {
    this.#enabled = enabled;
    this.#apply();
  }

  setExchangeActive(active: boolean): void {
    this.#exchangeActive = active;
    this.#apply();
  }

  /**
   * Lets the helper go on the app's way out. Its stdin closing is what asks it
   * to restore whatever is still ducked, so nothing is written first and
   * nothing waits for an answer: the helper outlives this call by exactly the
   * fade it owes the user.
   */
  stop(): void {
    this.#clearReleaseTimer();
    const helper = this.#helper;
    this.#helper = undefined;
    this.#ducked = false;
    helper?.endInput();
  }

  #apply(): void {
    if (this.#enabled && this.#exchangeActive) {
      // A turn beginning inside the hangover keeps the duck held: the players
      // never started back up, so there is nothing to send.
      this.#clearReleaseTimer();
      if (this.#ducked) return;
      const helper = this.#ensureHelper();
      if (!helper) return;
      this.#ducked = true;
      this.#write(helper, MEDIA_DUCK_COMMAND.DUCK);
      return;
    }
    if (!this.#ducked) {
      this.#clearReleaseTimer();
      return;
    }
    if (!this.#enabled) {
      this.#clearReleaseTimer();
      this.#restore();
      return;
    }
    if (this.#releaseTimer) return;
    this.#releaseTimer = setTimeout(() => {
      this.#releaseTimer = undefined;
      this.#restore();
    }, this.#releaseDelayMs);
  }

  #restore(): void {
    this.#ducked = false;
    const helper = this.#helper;
    // A restore that cannot be written is owed by no one: the helper it was
    // meant for died, and its memory of the volumes died with it.
    if (helper) this.#write(helper, MEDIA_DUCK_COMMAND.RESTORE);
  }

  /**
   * Writes one command, treating a throw as the helper's death: the pipe is
   * gone, so the state resets exactly as the exit listener would reset it.
   */
  #write(helper: NativeHelper, command: MediaDuckCommand): void {
    if (!helper.writeLine(command)) this.#drop(helper);
  }

  #ensureHelper(): NativeHelper | undefined {
    if (this.#helper) return this.#helper;
    const helper = new NativeHelper({
      binary: "mac-media-duck",
      input: "pipe",
      output: "inherit",
      ...(this.#spawnHelper ? { spawnProcess: this.#spawnHelper } : undefined),
    });
    helper.onExit(() => this.#drop(helper));
    if (!helper.start()) return undefined;
    this.#helper = helper;
    return helper;
  }

  /**
   * A helper that dies mid-duck takes its memory of the volumes with it, so
   * there is nothing to say and no one to say it to: the state resets and
   * the next exchange starts a fresh helper from the players' own levels.
   */
  #drop(helper: NativeHelper): void {
    if (this.#helper !== helper) return;
    this.#helper = undefined;
    this.#ducked = false;
    this.#clearReleaseTimer();
  }

  #clearReleaseTimer(): void {
    if (this.#releaseTimer === undefined) return;
    clearTimeout(this.#releaseTimer);
    this.#releaseTimer = undefined;
  }
}
