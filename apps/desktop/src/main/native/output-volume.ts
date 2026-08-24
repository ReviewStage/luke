import type { OutputAudioState } from "#shared/contracts";
import { NativeHelper, type NativeHelperProcess } from "./native-helper";

/**
 * The two things the helper says. Parsed rather than assumed, like the talk
 * key's lines: a state the reader guessed at would put a "turn your volume up"
 * hint on screen over sound the user can hear perfectly well.
 */
export const OUTPUT_VOLUME_EVENT = {
  OUTPUT: "output",
  UNAVAILABLE: "unavailable",
} as const;

export interface OutputVolumeEdges {
  /** The default output device's switches, on start and on every change. */
  onState(state: OutputAudioState): void;
  /**
   * The output cannot be watched — no device, a device with no controls, or
   * the helper has stopped. May follow states and be followed by them: the
   * default device changes, and what it changes to decides which. Never
   * reported for a stop the app asked for.
   */
  onUnavailable(): void;
}

/** Only the parts of a child process this needs, so a test can supply them. */
export type OutputVolumeProcess = NativeHelperProcess;

export interface OutputVolumeWatcherOptions extends OutputVolumeEdges {
  /** Injectable so the reader can be exercised without a Mac or a binary. */
  spawnHelper?: () => OutputVolumeProcess | undefined;
}

/**
 * Watches whether the Mac's output would let Luke be heard: the default
 * output device's mute switch and volume, read by a helper that reads nothing
 * else and can write nothing at all. What it learns drives only what the
 * renderer draws — captions forced on, and a hint asking for volume, while
 * Luke speaks unheard.
 */
export class OutputVolumeWatcher {
  readonly #options: OutputVolumeWatcherOptions;
  #helper: NativeHelper | undefined;
  #done = false;

  constructor(options: OutputVolumeWatcherOptions) {
    this.#options = options;
  }

  /**
   * Starts the helper, reporting whether it could be launched at all. A `true`
   * is not yet a readable output — that arrives on the helper's first line.
   */
  start(): boolean {
    const helper = new NativeHelper({
      binary: "mac-output-volume",
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
    if (line.startsWith(`${OUTPUT_VOLUME_EVENT.OUTPUT} `)) {
      const state = parseOutputLine(line);
      if (state) this.#options.onState(state);
      return;
    }
    // Unlike the talk key's, this unavailability is not final: the default
    // device can change to one the helper can read, so the watcher stays up
    // and only the current answer is withdrawn.
    if (line.startsWith(OUTPUT_VOLUME_EVENT.UNAVAILABLE)) this.#options.onUnavailable();
  }

  #unavailable(): void {
    if (this.#done) return;
    this.#done = true;
    this.#helper = undefined;
    this.#options.onUnavailable();
  }
}

/**
 * Reads one `output muted=<0|1> volume=<0..1>` line. A line that does not
 * parse is dropped rather than guessed at — the cost of missing one report is
 * a hint arriving a change later, and the cost of misreading one is a hint
 * that lies.
 */
export function parseOutputLine(line: string): OutputAudioState | undefined {
  const match = /^output muted=([01]) volume=(\d+(?:\.\d+)?)$/.exec(line);
  if (!match?.[1] || !match[2]) return undefined;
  const volume = Number.parseFloat(match[2]);
  if (!Number.isFinite(volume) || volume < 0 || volume > 1) return undefined;
  return { muted: match[1] === "1", volume };
}
