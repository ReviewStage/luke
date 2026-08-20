import { spawn } from "node:child_process";
import path from "node:path";
import { app } from "electron";
import type { OutputAudioState } from "#shared/contracts";

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
export interface OutputVolumeProcess {
  stdout?: { setEncoding(encoding: string): void; on(event: "data", listener: LineListener): void };
  on(event: "error" | "exit", listener: () => void): void;
  removeAllListeners(): void;
  kill(): void;
}

type LineListener = (chunk: string) => void;

export interface OutputVolumeWatcherOptions extends OutputVolumeEdges {
  /** Injectable so the reader can be exercised without a Mac or a binary. */
  spawnHelper?: () => OutputVolumeProcess | undefined;
}

function spawnOutputVolumeHelper(): OutputVolumeProcess | undefined {
  // The helper asks CoreAudio, which only macOS has; elsewhere the output is
  // simply never watched and the hint never drawn.
  if (process.platform !== "darwin") return undefined;
  const helperPath = app.isPackaged
    ? path.join(process.resourcesPath, "mac-output-volume")
    : path.join(app.getAppPath(), ".build", "native", "mac-output-volume");
  const child = spawn(helperPath, [], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  // SAFETY: spawn returns ChildProcess; the helper's stdout protocol matches OutputVolumeProcess.
  return child as OutputVolumeProcess;
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
  #child: OutputVolumeProcess | undefined;
  #done = false;
  #buffer = "";

  constructor(options: OutputVolumeWatcherOptions) {
    this.#options = options;
  }

  /**
   * Starts the helper, reporting whether it could be launched at all. A `true`
   * is not yet a readable output — that arrives on the helper's first line.
   */
  start(): boolean {
    let child: OutputVolumeProcess | undefined;
    try {
      child = this.#options.spawnHelper ? this.#options.spawnHelper() : spawnOutputVolumeHelper();
    } catch {
      child = undefined;
    }
    if (!child) {
      this.#unavailable();
      return false;
    }
    this.#child = child;
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => this.#read(chunk));
    // A helper that dies takes its answer with it. Saying so is what lets the
    // app stop claiming the output is silent on the strength of a stale line.
    child.on("error", () => this.#unavailable());
    child.on("exit", () => this.#unavailable());
    return true;
  }

  /**
   * Stops the helper. Detached before killing: this exit is the app's own
   * doing, and nothing succeeds a watcher during shutdown, so no one waits.
   */
  stop(): void {
    const child = this.#child;
    this.#child = undefined;
    this.#done = true;
    if (!child) return;
    child.removeAllListeners();
    child.kill();
  }

  #read(chunk: string): void {
    // A stopped reader drops everything, including lines the dying helper got
    // out: acting on one would redraw a hint the app has already let go of.
    if (this.#done) return;
    this.#buffer += chunk;
    const lines = this.#buffer.split("\n");
    // Whatever follows the last newline is the start of a line still arriving.
    this.#buffer = lines.pop() ?? "";
    for (const line of lines) this.#handle(line.trim());
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
    this.#child = undefined;
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
