import { spawn } from "node:child_process";
import path from "node:path";
import { app } from "electron";
import {
  LID_STATE,
  type LidState,
  MICROPHONE_TRANSPORT,
  type MicrophoneRoute,
  type MicrophoneTransport,
} from "./shared/contracts";

/** The one word the helper takes; its one line is read by the parser below. */
export const MICROPHONE_ROUTE_PROBE = "probe";

export interface MicrophoneRouteEdges {
  /** The route as read, on start, on every input change, and per probe. */
  onRoute(route: MicrophoneRoute): void;
  /** The route cannot be read — no helper, or the helper died. */
  onUnavailable(): void;
}

/** Only the parts of a child process this needs, so a test can supply them. */
export interface MicrophoneRouteProcess {
  stdin?: { write(chunk: string): void };
  stdout?: { setEncoding(encoding: string): void; on(event: "data", listener: LineListener): void };
  on(event: "error" | "exit", listener: () => void): void;
  removeAllListeners(): void;
  kill(): void;
}

type LineListener = (chunk: string) => void;

export interface MicrophoneRouteWatcherOptions extends MicrophoneRouteEdges {
  /** Injectable so the reader can be exercised without a Mac or a binary. */
  spawnHelper?: () => MicrophoneRouteProcess | undefined;
}

function spawnMicrophoneRouteHelper(): MicrophoneRouteProcess | undefined {
  // The helper asks CoreAudio and the power domain, which only macOS has;
  // elsewhere the route is simply never read and the browser's default holds.
  if (process.platform !== "darwin") return undefined;
  const helperPath = app.isPackaged
    ? path.join(process.resourcesPath, "mac-microphone-route")
    : path.join(app.getAppPath(), ".build", "native", "mac-microphone-route");
  const child = spawn(helperPath, [], {
    stdio: ["pipe", "pipe", "ignore"],
  });
  // SAFETY: spawn returns ChildProcess; the helper's stdio protocol matches MicrophoneRouteProcess.
  return child as MicrophoneRouteProcess;
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
  #child: MicrophoneRouteProcess | undefined;
  #done = false;
  #buffer = "";

  constructor(options: MicrophoneRouteWatcherOptions) {
    this.#options = options;
  }

  /**
   * Starts the helper, reporting whether it could be launched at all. A `true`
   * is not yet a readable route — that arrives on the helper's first line.
   */
  start(): boolean {
    let child: MicrophoneRouteProcess | undefined;
    try {
      child = this.#options.spawnHelper
        ? this.#options.spawnHelper()
        : spawnMicrophoneRouteHelper();
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
    // app fall back to the browser's default rather than trust a stale route.
    child.on("error", () => this.#unavailable());
    child.on("exit", () => this.#unavailable());
    return true;
  }

  /**
   * Asks for a fresh read. The lid can close without any device changing, so
   * the app probes when a press is about to choose a device; the answer rides
   * the same line every change does.
   */
  probe(): void {
    if (this.#done) return;
    this.#child?.stdin?.write(`${MICROPHONE_ROUTE_PROBE}\n`);
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
    if (this.#done) return;
    this.#buffer += chunk;
    const lines = this.#buffer.split("\n");
    // Whatever follows the last newline is the start of a line still arriving.
    this.#buffer = lines.pop() ?? "";
    for (const line of lines) {
      const route = parseMicrophoneRouteLine(line.trim());
      if (route) this.#options.onRoute(route);
    }
  }

  #unavailable(): void {
    if (this.#done) return;
    this.#done = true;
    this.#child = undefined;
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
