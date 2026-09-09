import type { OutputAudioState } from "#shared/messages/audio";
import { LINE_UNAVAILABLE, lineWatcher } from "./line-watcher";
import type { NativeHelperProcess } from "./native-helper";

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

export interface OutputVolumeWatcherOptions extends OutputVolumeEdges {
  /** Injectable so the reader can be exercised without a Mac or a binary. */
  spawnHelper?: () => NativeHelperProcess | undefined;
}

export interface OutputVolumeWatch {
  /**
   * Starts the helper, reporting whether it could be launched at all. A `true`
   * is not yet a readable output — that arrives on the helper's first line.
   */
  start(): boolean;
  /** Stops the helper. Nothing succeeds it during shutdown, so no one waits. */
  stop(): void;
}

/**
 * Watches whether the Mac's output would let Luke be heard: the default
 * output device's mute switch and volume, read by a helper that reads nothing
 * else and can write nothing at all. What it learns drives only what the
 * renderer draws — captions forced on, and a hint asking for volume, while
 * Luke speaks unheard.
 */
export function outputVolumeWatcher(options: OutputVolumeWatcherOptions): OutputVolumeWatch {
  const { spawnHelper } = options;
  const watch = lineWatcher<OutputAudioState>({
    binary: "mac-output-volume",
    parse: (line) =>
      line.startsWith(OUTPUT_VOLUME_EVENT.UNAVAILABLE) ? LINE_UNAVAILABLE : parseOutputLine(line),
    onState: options.onState,
    onUnavailable: options.onUnavailable,
    // Unlike the talk key's, this unavailability is not final: the default
    // device can change to one the helper can read, so the watcher stays up
    // and only the current answer is withdrawn.
    unavailableLineEnds: false,
    ...(spawnHelper ? { spawnProcess: spawnHelper } : undefined),
  });

  return {
    start: () => watch.start(),
    stop: () => {
      void watch.stop();
    },
  };
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
