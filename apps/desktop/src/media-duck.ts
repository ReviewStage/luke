import { spawn } from "node:child_process";
import path from "node:path";
import { app } from "electron";

/**
 * The two words the helper takes. It holds the player-facing knowledge — which
 * apps, what levels, whose volume changes are the user's to keep — so this side
 * only ever says which of the two states the exchange is in.
 */
export const MEDIA_DUCK_COMMAND = {
  DUCK: "duck",
  RESTORE: "restore",
} as const;

/**
 * How long quiet is held after an exchange ends before the players come back
 * up. A conversation is turns with gaps in them, and a volume that climbed in
 * every gap only to dive at the next word would pump; the hangover is longer
 * than the pause between a reply and the follow-up press.
 */
export const MEDIA_DUCK_RELEASE_DELAY_MS = 1_000;

/** Only the parts of a child process this needs, so a test can supply them. */
export interface MediaDuckProcess {
  stdin?: { write(chunk: string): void; end(): void };
  on(event: "error" | "exit", listener: () => void): void;
  removeAllListeners(): void;
}

export interface MediaDuckControllerOptions {
  /** Injectable so the ordering can be exercised without a Mac or a binary. */
  spawnHelper?: () => MediaDuckProcess | undefined;
  releaseDelayMs?: number;
}

function spawnMediaDuckHelper(): MediaDuckProcess | undefined {
  // The helper speaks to Music and Spotify through Apple Events, which only
  // macOS has; elsewhere the setting can be held but never acts.
  if (process.platform !== "darwin") return undefined;
  const helperPath = app.isPackaged
    ? path.join(process.resourcesPath, "mac-media-duck")
    : path.join(app.getAppPath(), ".build", "native", "mac-media-duck");
  return spawn(helperPath, [], {
    // Stdin is the whole protocol — its closing is what tells the helper to
    // restore and go. What the helper says back is diagnostic, so it rides
    // through to the app's own stdout: one line per act in a terminal run,
    // nowhere at all in a packaged one.
    stdio: ["pipe", "inherit", "ignore"],
  }) as unknown as MediaDuckProcess;
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
  readonly #spawnHelper: () => MediaDuckProcess | undefined;
  readonly #releaseDelayMs: number;
  #child: MediaDuckProcess | undefined;
  #enabled = false;
  #exchangeActive = false;
  #ducked = false;
  #releaseTimer: NodeJS.Timeout | undefined;

  constructor(options: MediaDuckControllerOptions = {}) {
    this.#spawnHelper = options.spawnHelper ?? spawnMediaDuckHelper;
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
    const child = this.#child;
    this.#child = undefined;
    this.#ducked = false;
    child?.removeAllListeners();
    child?.stdin?.end();
  }

  #apply(): void {
    if (this.#enabled && this.#exchangeActive) {
      // A turn beginning inside the hangover keeps the duck held: the players
      // never started back up, so there is nothing to send.
      this.#clearReleaseTimer();
      if (this.#ducked) return;
      const child = this.#ensureChild();
      if (!child) return;
      this.#ducked = true;
      child.stdin?.write(`${MEDIA_DUCK_COMMAND.DUCK}\n`);
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
    this.#child?.stdin?.write(`${MEDIA_DUCK_COMMAND.RESTORE}\n`);
  }

  #ensureChild(): MediaDuckProcess | undefined {
    if (this.#child) return this.#child;
    let child: MediaDuckProcess | undefined;
    try {
      child = this.#spawnHelper();
    } catch {
      child = undefined;
    }
    if (!child) return undefined;
    this.#child = child;
    // A helper that dies mid-duck takes its memory of the volumes with it, so
    // there is nothing to say and no one to say it to: the state resets and
    // the next exchange starts a fresh helper from the players' own levels.
    const drop = () => {
      if (this.#child !== child) return;
      this.#child = undefined;
      this.#ducked = false;
      this.#clearReleaseTimer();
    };
    child.on("error", drop);
    child.on("exit", drop);
    return child;
  }

  #clearReleaseTimer(): void {
    if (this.#releaseTimer === undefined) return;
    clearTimeout(this.#releaseTimer);
    this.#releaseTimer = undefined;
  }
}
