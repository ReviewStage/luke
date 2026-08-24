import {
  LID_STATE,
  type LidState,
  MICROPHONE_TRANSPORT,
  type MicrophoneRoute,
  type MicrophoneTransport,
} from "#shared/contracts";
import { NativeHelper, type NativeHelperProcess } from "./native-helper";

/** The one word the helper takes; its one line is read by the parser below. */
export const MICROPHONE_ROUTE_PROBE = "probe";

export interface MicrophoneRouteEdges {
  /** The route as read, on start, on every input change, and per probe. */
  onRoute(route: MicrophoneRoute): void;
  /** The route cannot be read — no helper, or the helper died. */
  onUnavailable(): void;
}

/** Only the parts of a child process this needs, so a test can supply them. */
export type MicrophoneRouteProcess = NativeHelperProcess;

export interface MicrophoneRouteWatcherOptions extends MicrophoneRouteEdges {
  /** Injectable so the reader can be exercised without a Mac or a binary. */
  spawnHelper?: () => MicrophoneRouteProcess | undefined;
}

/**
 * Watches where the developer's voice would be captured from: the default
 * input's transport, the built-in microphone's name, and the lid over it —
 * read by a helper that reads nothing else and can write nothing. What the
 * answer decides is bounded to one act: which device the renderer asks the
 * browser to open when a press takes a turn.
 */
export class MicrophoneRouteWatcher {
  readonly #options: MicrophoneRouteWatcherOptions;
  #helper: NativeHelper | undefined;
  #done = false;

  constructor(options: MicrophoneRouteWatcherOptions) {
    this.#options = options;
  }

  /**
   * Starts the helper, reporting whether it could be launched at all. A `true`
   * is not yet a readable route — that arrives on the helper's first line.
   */
  start(): boolean {
    const helper = new NativeHelper({
      binary: "mac-microphone-route",
      input: "pipe",
      output: "lines",
      ...(this.#options.spawnHelper ? { spawnProcess: this.#options.spawnHelper } : undefined),
    });
    helper.onLine((line) => {
      if (this.#done) return;
      const route = parseMicrophoneRouteLine(line);
      if (route) this.#options.onRoute(route);
    });
    helper.onExit(() => this.#unavailable());
    if (!helper.start()) {
      this.#unavailable();
      return false;
    }
    this.#helper = helper;
    return true;
  }

  /**
   * Asks for a fresh read. The lid can close without any device changing, so
   * the app probes when a press is about to choose a device; the answer rides
   * the same line every change does.
   */
  probe(): void {
    if (this.#done) return;
    this.#helper?.writeLine(MICROPHONE_ROUTE_PROBE);
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

  #unavailable(): void {
    if (this.#done) return;
    this.#done = true;
    this.#helper = undefined;
    this.#options.onUnavailable();
  }
}

const TRANSPORT_WORDS: readonly MicrophoneTransport[] = Object.values(MICROPHONE_TRANSPORT);
const LID_WORDS: readonly LidState[] = Object.values(LID_STATE);

/**
 * Reads one `input transport=<word> lid=<word> builtin=<name…>` line. The
 * name is the line's tail — it may contain spaces or anything else CoreAudio
 * lets a device be called — and a line that does not parse is dropped rather
 * than guessed at: the cost of missing one is the browser's default device,
 * which is exactly what no helper at all would mean.
 */
export function parseMicrophoneRouteLine(line: string): MicrophoneRoute | undefined {
  const match = /^input transport=(\S+) lid=(\S+)(?: builtin=(.+))?$/.exec(line);
  if (!match?.[1] || !match[2]) return undefined;
  const transport = TRANSPORT_WORDS.find((word) => word === match[1]);
  const lid = LID_WORDS.find((word) => word === match[2]);
  if (!transport || !lid) return undefined;
  const builtInName = match[3]?.trim();
  return { defaultTransport: transport, lid, ...(builtInName ? { builtInName } : undefined) };
}
