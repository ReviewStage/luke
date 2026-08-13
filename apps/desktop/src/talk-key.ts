import { spawn } from "node:child_process";
import path from "node:path";
import { app } from "electron";

/**
 * What the helper says about itself on its first line, and what it streams
 * afterwards. Parsed rather than assumed: a helper that failed to register is
 * the difference between hold-to-talk and no talk key at all, and the app has a
 * fallback to reach for if it says so.
 */
export const TALK_KEY_EVENT = {
  REGISTERED: "registered",
  DOWN: "down",
  UP: "up",
  UNAVAILABLE: "unavailable",
} as const;

export interface TalkKeyEdges {
  onPress(): void;
  onRelease(): void;
  /** The accelerator that registered, once the helper reports one. */
  onRegistered(accelerator: string): void;
  /**
   * The talk key cannot be watched — either it never registered or the helper
   * has since stopped. Called at most once, and never for a stop the app asked
   * for.
   */
  onUnavailable(): void;
}

/** Only the parts of a child process this needs, so a test can supply them. */
export interface TalkKeyProcess {
  stdout?: { setEncoding(encoding: string): void; on(event: "data", listener: LineListener): void };
  on(event: "error" | "exit", listener: () => void): void;
  removeAllListeners(): void;
  kill(): void;
}

type LineListener = (chunk: string) => void;

export interface TalkKeyWatcherOptions extends TalkKeyEdges {
  /** Injectable so the reader can be exercised without a Mac or a binary. */
  spawnHelper?: (candidates: readonly string[]) => TalkKeyProcess;
}

function helperPath(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, "mac-talk-key");
  return path.join(app.getAppPath(), ".build", "native", "mac-talk-key");
}

/**
 * Watches the talk key being held down and let go of, from whatever app is
 * frontmost.
 *
 * Electron registers a global accelerator through the same system API this
 * helper uses, but reports only the press — so a key that means "while I am
 * holding this" cannot be built on it. The helper exists for the release, and
 * for nothing else: it is told one chord and can see no other key, which is
 * what keeps hold-to-talk from costing the user an Accessibility grant.
 */
export class TalkKeyWatcher {
  readonly #options: TalkKeyWatcherOptions;
  #child: TalkKeyProcess | undefined;
  #done = false;
  #buffer = "";

  constructor(options: TalkKeyWatcherOptions) {
    this.#options = options;
  }

  /**
   * Starts the helper, reporting whether it could be launched at all. A `true`
   * here is not yet a registered key — that arrives on the helper's first line,
   * through `onRegistered`.
   */
  start(candidates: readonly string[]): boolean {
    try {
      const child = this.#options.spawnHelper
        ? this.#options.spawnHelper(candidates)
        : (spawn(helperPath(), [...candidates], {
            stdio: ["ignore", "pipe", "ignore"],
          }) as unknown as TalkKeyProcess);
      this.#child = child;
      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk) => this.#read(chunk));
      // A helper that dies takes the talk key with it, whether or not it had
      // registered one first. Saying so is what lets the app fall back rather
      // than leave a key on screen that answers nothing.
      child.on("error", () => this.#unavailable());
      child.on("exit", () => this.#unavailable());
      return true;
    } catch {
      this.#unavailable();
      return false;
    }
  }

  stop(): void {
    // Detached before killing: this exit is the app's own doing, and reporting
    // it as the key becoming unavailable would stand up a fallback during
    // shutdown.
    const child = this.#child;
    this.#child = undefined;
    this.#done = true;
    child?.removeAllListeners();
    child?.kill();
  }

  #read(chunk: string): void {
    this.#buffer += chunk;
    const lines = this.#buffer.split("\n");
    // Whatever follows the last newline is the start of a line still arriving.
    // A press and its release can land in one chunk or be split across two, and
    // a half-read "up" is the difference between a turn ending and not.
    this.#buffer = lines.pop() ?? "";
    for (const line of lines) this.#handle(line.trim());
  }

  #handle(line: string): void {
    if (line === TALK_KEY_EVENT.DOWN) {
      this.#options.onPress();
      return;
    }
    if (line === TALK_KEY_EVENT.UP) {
      this.#options.onRelease();
      return;
    }
    if (line.startsWith(`${TALK_KEY_EVENT.REGISTERED} `)) {
      this.#options.onRegistered(line.slice(TALK_KEY_EVENT.REGISTERED.length + 1));
      return;
    }
    if (line.startsWith(TALK_KEY_EVENT.UNAVAILABLE)) this.#unavailable();
  }

  #unavailable(): void {
    if (this.#done) return;
    this.#done = true;
    this.#child = undefined;
    this.#options.onUnavailable();
  }
}
