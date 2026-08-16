import { spawn } from "node:child_process";
import path from "node:path";
import { app } from "electron";
import { type CallApp, MAXIMUM_CALL_APP_ICON_LENGTH } from "./shared/contracts";

/**
 * The bundle identifiers Luke himself answers to, which the helper drops before
 * naming anyone.
 *
 * Two of them because a packaged Luke and a development Electron are different
 * applications to macOS, and both open the device from helper processes whose
 * identifiers extend the parent's. They are prefixes for exactly that reason.
 *
 * The first must stay equal to `appBundleId` in `package-config.mjs`; the
 * packaging test holds the two together, because a Luke that has been renamed
 * and not told about it here would read his own conversation as a call.
 */
export const LUKE_BUNDLE_PREFIXES: readonly string[] = [
  "dev.reviewstage.luke",
  "com.github.Electron",
];

/**
 * What the microphone is doing, as the helper reads it.
 *
 * `running` is the device; `apps` is who could be named on it. They are
 * separate because they fail separately: a device that is running while nobody
 * can be named is the one reading that must not become "nobody is on a call",
 * and the gate downstream turns it into `UNAVAILABLE` rather than guessing.
 */
export interface MicrophoneReading {
  running: boolean;
  apps: readonly CallApp[];
}

/** Only the parts of a child process this needs, so a test can supply them. */
export interface MicrophoneUseProcess {
  stdout?: { setEncoding(encoding: string): void; on(event: "data", listener: LineListener): void };
  on(event: "error" | "exit", listener: ProcessListener): void;
  removeAllListeners(): void;
  kill(): void;
}

type LineListener = (chunk: string) => void;
type ProcessListener = (detail?: unknown) => void;

export interface MicrophoneUseWatcherOptions {
  /**
   * Every change, including the first reading. `undefined` is the microphone
   * being unreadable, which is never the same answer as nobody using it.
   */
  onChanged(reading: MicrophoneReading | undefined): void;
  /**
   * Why the answer is what it is, when the reason is this side's to give. A
   * helper that never started says nothing at all, and an absence is the one
   * diagnostic nobody can read.
   */
  onDiagnostic?(message: string): void;
  /** Injectable so the reader can be exercised without a Mac or a binary. */
  spawnHelper?: (prefixes: readonly string[]) => MicrophoneUseProcess;
}

function helperPath(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, "mac-microphone-use");
  return path.join(app.getAppPath(), ".build", "native", "mac-microphone-use");
}

function failureText(detail: unknown): string {
  if (detail instanceof Error) return detail.message;
  return typeof detail === "string" && detail ? detail : "no reason given";
}

/**
 * Reads one line of the helper's JSON, or nothing.
 *
 * Every field is checked rather than trusted. The helper is Luke's own process
 * and its output is not hostile, but a half-written line is a real thing to
 * receive and a reading built out of `undefined` would drive the panel.
 */
export function microphoneReadingFromLine(line: string): MicrophoneReading | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;

  const record = parsed as Record<string, unknown>;
  if (record.unavailable === true) return undefined;
  if (typeof record.running !== "boolean" || !Array.isArray(record.apps)) return undefined;

  const apps: CallApp[] = [];
  for (const entry of record.apps) {
    if (entry === null || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
    if (!id) continue;
    // An icon too large to be one is dropped rather than carried: the row falls
    // back to a glyph, which is a better answer than a settings file with
    // something else's megabyte in it.
    const icon =
      typeof candidate.icon === "string" &&
      candidate.icon.length > 0 &&
      candidate.icon.length <= MAXIMUM_CALL_APP_ICON_LENGTH
        ? candidate.icon
        : undefined;
    apps.push({ id, name: name || id, ...(icon ? { icon } : {}) });
  }
  return { running: record.running, apps };
}

/**
 * Watches which apps are listening through the microphone, so notices can wait
 * while one of them is.
 *
 * Everything that goes wrong lands on `undefined` — an unreadable microphone —
 * because a watcher that cannot see the device and a device nobody is using
 * must not be told apart by silence: only one of them is a reason to hold a
 * notice back, and it is neither.
 */
export class MicrophoneUseWatcher {
  readonly #options: MicrophoneUseWatcherOptions;
  #child: MicrophoneUseProcess | undefined;
  #reading: MicrophoneReading | undefined;
  #reported = false;
  #done = false;
  #buffer = "";

  constructor(options: MicrophoneUseWatcherOptions) {
    this.#options = options;
  }

  /** The last reading, or `undefined` until one arrives. */
  get reading(): MicrophoneReading | undefined {
    return this.#reading;
  }

  start(): void {
    if (this.#child) return;
    try {
      const child = this.#options.spawnHelper
        ? this.#options.spawnHelper(LUKE_BUNDLE_PREFIXES)
        : (spawn(helperPath(), [...LUKE_BUNDLE_PREFIXES], {
            // Stdout is the protocol, so it is read. Stderr is the helper
            // saying why it read what it did, and it rides through to the
            // app's own: one line per change in a terminal run, nowhere
            // anyone sees in a packaged one.
            stdio: ["ignore", "pipe", "inherit"],
          }) as unknown as MicrophoneUseProcess);
      this.#child = child;
      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk) => this.#read(chunk));
      child.on("error", (detail) => {
        this.#diagnose(`the helper could not be run — ${failureText(detail)}`);
        this.#unavailable();
      });
      child.on("exit", () => {
        this.#diagnose("the helper stopped answering");
        this.#unavailable();
      });
    } catch (error) {
      this.#diagnose(`the helper could not be started — ${failureText(error)}`);
      this.#unavailable();
    }
  }

  /**
   * Stops the helper on the app's way out. Detached before killing: this exit
   * is the app's own doing, and reporting it as the microphone becoming
   * unreadable would announce a change to a panel already going away.
   */
  stop(): void {
    const child = this.#child;
    this.#child = undefined;
    this.#done = true;
    child?.removeAllListeners();
    child?.kill();
  }

  #read(chunk: string): void {
    if (this.#done) return;
    this.#buffer += chunk;
    const lines = this.#buffer.split("\n");
    // Whatever follows the last newline is the start of a line still arriving.
    this.#buffer = lines.pop() ?? "";
    for (const line of lines) {
      const text = line.trim();
      if (!text) continue;
      this.#report(microphoneReadingFromLine(text));
    }
  }

  #diagnose(message: string): void {
    if (this.#done) return;
    this.#options.onDiagnostic?.(message);
  }

  #unavailable(): void {
    if (this.#done) return;
    this.#child = undefined;
    this.#report(undefined);
  }

  #report(reading: MicrophoneReading | undefined): void {
    if (this.#reported && sameReading(this.#reading, reading)) return;
    this.#reported = true;
    this.#reading = reading;
    this.#options.onChanged(reading);
  }
}

function sameReading(
  first: MicrophoneReading | undefined,
  second: MicrophoneReading | undefined,
): boolean {
  if (first === undefined || second === undefined) return first === second;
  if (first.running !== second.running) return false;
  if (first.apps.length !== second.apps.length) return false;
  return first.apps.every(
    (app, index) => app.id === second.apps[index]?.id && app.icon === second.apps[index]?.icon,
  );
}
