import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

interface ElectronApp {
  readonly isPackaged: boolean;
  getAppPath(): string;
}

const requireElectron = createRequire(__filename);

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
  // SAFETY: Electron's main-process module exports the app path APIs this helper needs.
  const { app } = requireElectron("electron") as { app: ElectronApp };
  const helperPath = app.isPackaged
    ? path.join(process.resourcesPath, "mac-media-duck")
    : path.join(app.getAppPath(), ".build", "native", "mac-media-duck");
  const child = spawn(helperPath, [], {
    // Stdin is the whole protocol — its closing is what tells the helper to
    // restore and go. The helper speaks back only to say a player refused it,
    // and that diagnostic rides through to the app's own stdout: visible in a
    // terminal run, nowhere at all in a packaged one.
    stdio: ["pipe", "inherit", "ignore"],
  });
  // A helper that died surfaces twice: as the exit event the controller
  // handles, and as a broken pipe on this stream — which, with no listener,
  // would take the whole app down for a volume that merely stayed put.
  child.stdin?.on("error", () => undefined);
  // SAFETY: spawn returns ChildProcess; the helper's stdin protocol matches MediaDuckProcess.
  return child as MediaDuckProcess;
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
    try {
      child?.stdin?.end();
    } catch {
      // A pipe already broken is already closed, and EOF was the whole message.
    }
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
      this.#write(child, MEDIA_DUCK_COMMAND.DUCK);
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
    const child = this.#child;
    // A restore that cannot be written is owed by no one: the helper it was
    // meant for died, and its memory of the volumes died with it.
    if (child) this.#write(child, MEDIA_DUCK_COMMAND.RESTORE);
  }

  /**
   * Writes one command, treating a throw as the helper's death: the pipe is
   * gone, so the state resets exactly as the exit listener would reset it.
   */
  #write(child: MediaDuckProcess, command: MediaDuckCommand): void {
    try {
      child.stdin?.write(`${command}\n`);
    } catch {
      this.#drop(child);
    }
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
    const spawned = child;
    this.#child = spawned;
    spawned.on("error", () => this.#drop(spawned));
    spawned.on("exit", () => this.#drop(spawned));
    return spawned;
  }

  /**
   * A helper that dies mid-duck takes its memory of the volumes with it, so
   * there is nothing to say and no one to say it to: the state resets and
   * the next exchange starts a fresh helper from the players' own levels.
   */
  #drop(child: MediaDuckProcess): void {
    if (this.#child !== child) return;
    this.#child = undefined;
    this.#ducked = false;
    this.#clearReleaseTimer();
  }

  #clearReleaseTimer(): void {
    if (this.#releaseTimer === undefined) return;
    clearTimeout(this.#releaseTimer);
    this.#releaseTimer = undefined;
  }
}
