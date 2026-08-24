import { NativeHelper, type NativeHelperProcess } from "./native-helper";

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
export type TalkKeyProcess = NativeHelperProcess;

export interface TalkKeyWatcherOptions extends TalkKeyEdges {
  /** Injectable so the reader can be exercised without a Mac or a binary. */
  spawnHelper?: (candidates: readonly string[]) => TalkKeyProcess;
}

/**
 * Longer than a SIGTERM takes to land, far shorter than a user notices. The
 * wait for a stopped helper's exit is capped so a process that ignores the
 * signal cannot wedge every later change of the talk key.
 */
const EXIT_WAIT_MS = 1000;

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
  #helper: NativeHelper | undefined;
  #done = false;

  constructor(options: TalkKeyWatcherOptions) {
    this.#options = options;
  }

  /**
   * Starts the helper, reporting whether it could be launched at all. A `true`
   * here is not yet a registered key — that arrives on the helper's first line,
   * through `onRegistered`.
   */
  start(candidates: readonly string[]): boolean {
    const helper = new NativeHelper({
      binary: "mac-talk-key",
      arguments: candidates,
      output: "lines",
      ...(this.#options.spawnHelper
        ? { spawnProcess: () => this.#options.spawnHelper?.(candidates) }
        : undefined),
    });
    helper.onLine((line) => this.#handle(line));
    helper.onExit(() => this.#unavailable());
    if (!helper.start()) {
      this.#unavailable();
      return false;
    }
    this.#helper = helper;
    return true;
  }

  /**
   * Stops the helper, reporting when its process is actually gone. Detached
   * before killing: this exit is the app's own doing, and reporting it as the
   * key becoming unavailable would stand up a fallback during shutdown. The
   * answer matters to a successor — the system releases the chord with the
   * process, not with the kill that asked for it, so a new helper that claims
   * a chord this one still holds would be refused.
   */
  stop(): Promise<void> {
    const helper = this.#helper;
    this.#helper = undefined;
    this.#done = true;
    return helper?.stop(EXIT_WAIT_MS) ?? Promise.resolve();
  }

  #handle(line: string): void {
    if (this.#done) return;
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
    this.#helper = undefined;
    this.#options.onUnavailable();
  }
}
