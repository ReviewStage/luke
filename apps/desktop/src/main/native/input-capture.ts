import { NativeHelper, type NativeHelperProcess } from "./native-helper";

/**
 * The two things the helper says. Parsed rather than assumed, like the output
 * watcher's lines: a capture the reader guessed at would put Luke to sleep
 * through news the developer wanted to hear.
 */
export const INPUT_CAPTURE_EVENT = {
  CAPTURE: "capture",
  UNAVAILABLE: "unavailable",
} as const;

export interface InputCaptureEdges {
  /** Whether any app is capturing from an input device, on start and on every change. */
  onCapturing(running: boolean): void;
  /**
   * The input cannot be watched — no input device, or the helper has stopped.
   * Not final: a device can arrive and be read. Means "not capturing", since a
   * hold never comes from a guess. Never reported for a stop the app asked for.
   */
  onUnavailable(): void;
}

export type InputCaptureProcess = NativeHelperProcess;

export interface InputCaptureWatcherOptions extends InputCaptureEdges {
  /** Injectable so the reader can be exercised without a Mac or a binary. */
  spawnHelper?: () => InputCaptureProcess | undefined;
}

/**
 * Watches whether another app is using this Mac's microphone, read by a
 * helper that reads one boolean from CoreAudio — no audio, no device or
 * process name — and can write nothing at all. What it learns feeds only the
 * call quiet, which holds spoken announcements while a call is on.
 */
export class InputCaptureWatcher {
  readonly #options: InputCaptureWatcherOptions;
  #helper: NativeHelper | undefined;
  #done = false;

  constructor(options: InputCaptureWatcherOptions) {
    this.#options = options;
  }

  /**
   * Starts the helper, reporting whether it could be launched at all. A `true`
   * is not yet a readable answer — that arrives on the helper's first line.
   */
  start(): boolean {
    const helper = new NativeHelper({
      binary: "mac-input-capture",
      output: "lines",
      ...(this.#options.spawnHelper ? { spawnProcess: this.#options.spawnHelper } : undefined),
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
   * Stops the helper. Detached before killing: this exit is the app's own
   * doing, and nothing succeeds a watcher during shutdown, so no one waits.
   */
  stop(): void {
    const helper = this.#helper;
    this.#helper = undefined;
    this.#done = true;
    void helper?.stop();
  }

  #handle(line: string): void {
    if (line.startsWith(`${INPUT_CAPTURE_EVENT.CAPTURE} `)) {
      const running = parseInputCaptureLine(line);
      if (running !== undefined) this.#options.onCapturing(running);
      return;
    }
    if (line.startsWith(INPUT_CAPTURE_EVENT.UNAVAILABLE)) this.#options.onUnavailable();
  }

  #unavailable(): void {
    if (this.#done) return;
    this.#done = true;
    this.#helper = undefined;
    this.#options.onUnavailable();
  }
}

/**
 * Reads one `capture running=<0|1>` line. A line that does not parse is
 * dropped rather than guessed at: missing one report costs a hold arriving a
 * change later, and misreading one costs a hold that lies.
 */
export function parseInputCaptureLine(line: string): boolean | undefined {
  const match = /^capture running=([01])$/.exec(line);
  if (!match?.[1]) return undefined;
  return match[1] === "1";
}
