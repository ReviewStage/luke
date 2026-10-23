import { type StdioOptions, spawn } from "node:child_process";
import path from "node:path";
import { app } from "electron";

interface NativeHelperProcess {
  stdin?: {
    write?(chunk: string): void;
    end?(): void;
    on?(event: "error", listener: () => void): void;
  };
  stdout?: {
    setEncoding(encoding: string): void;
    on(event: "data", listener: (chunk: string) => void): void;
  };
  on(event: "error" | "exit", listener: () => void): void;
  removeAllListeners(): void;
  kill?(): void;
}

interface NativeHelperOptions {
  binary: string;
  input?: "ignore" | "pipe";
  output: "inherit" | "lines";
}

let resolvedNativeDirectory: string | undefined;

/** Resolves packaged versus development placement once for every helper. */
function nativeDirectory(): string {
  resolvedNativeDirectory ??= app.isPackaged
    ? process.resourcesPath
    : path.join(app.getAppPath(), ".build", "native");
  return resolvedNativeDirectory;
}

/** The one path resolver for executable helpers. */
function nativeHelperPath(binary: string): string {
  return path.join(nativeDirectory(), binary);
}

/**
 * Owns one native helper process: direct spawn, newline framing, input, and
 * exit/error convergence. Callers learn only complete lines and one ending.
 */
export class NativeHelper {
  readonly #options: NativeHelperOptions;
  readonly #lineListeners = new Set<(line: string) => void>();
  readonly #exitListeners = new Set<() => void>();
  #child: NativeHelperProcess | undefined;
  #buffer = "";
  #ended = false;

  constructor(options: NativeHelperOptions) {
    this.#options = options;
  }

  onLine(listener: (line: string) => void): void {
    this.#lineListeners.add(listener);
  }

  onExit(listener: () => void): void {
    this.#exitListeners.add(listener);
  }

  start(): boolean {
    if (this.#child || this.#ended) return false;
    try {
      const child = this.#spawn();
      if (!child) return false;
      this.#child = child;
      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk) => this.#read(chunk));
      child.stdin?.on?.("error", () => this.#finish());
      child.on("error", () => this.#finish());
      child.on("exit", () => this.#finish());
      return true;
    } catch {
      this.#finish();
      return false;
    }
  }

  writeLine(line: string): boolean {
    if (!this.#child || this.#ended) return false;
    try {
      this.#child.stdin?.write?.(`${line}\n`);
      return this.#child.stdin?.write !== undefined;
    } catch {
      this.#finish();
      return false;
    }
  }

  /** Closes stdin without killing; EOF is the media helper's restore command. */
  endInput(): void {
    const child = this.#detach();
    try {
      child?.stdin?.end?.();
    } catch {
      // A closed pipe has already received the only signal owed here.
    }
  }

  /** Stops the process without waiting for its exit. */
  stop(): void {
    this.#detach()?.kill?.();
  }

  #spawn(): NativeHelperProcess | undefined {
    // The helpers are Mac binaries, so there is nothing to spawn anywhere
    // else.
    if (process.platform !== "darwin") return undefined;
    const stdio: StdioOptions = [
      this.#options.input ?? "ignore",
      this.#options.output === "lines" ? "pipe" : "inherit",
      "ignore",
    ];
    // SAFETY: spawn returns ChildProcess; this module alone narrows the stdio it configured.
    return spawn(nativeHelperPath(this.#options.binary), [], { stdio }) as NativeHelperProcess;
  }

  #read(chunk: string): void {
    if (this.#ended) return;
    this.#buffer += chunk;
    const lines = this.#buffer.split("\n");
    this.#buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      for (const listener of this.#lineListeners) listener(trimmed);
    }
  }

  #finish(): void {
    if (this.#ended) return;
    // A process exit cannot complete a partially written event. In particular,
    // treating `down` without its newline as a press can leave hold-to-talk
    // without the matching release the dying helper owed.
    this.#buffer = "";
    this.#ended = true;
    this.#child = undefined;
    for (const listener of this.#exitListeners) listener();
  }

  #detach(): NativeHelperProcess | undefined {
    if (this.#ended) return undefined;
    this.#ended = true;
    const child = this.#child;
    this.#child = undefined;
    child?.removeAllListeners();
    return child;
  }
}
