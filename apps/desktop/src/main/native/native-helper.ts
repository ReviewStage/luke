import { type StdioOptions, spawn } from "node:child_process";
import path from "node:path";
import { app } from "electron";

export interface NativeHelperProcess {
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

export interface NativeHelperOptions {
  binary: string;
  arguments?: readonly string[];
  input?: "ignore" | "pipe";
  output?: "ignore" | "inherit" | "lines";
  /** Internal seam for tests; production always uses the one spawn below. */
  spawnProcess?: () => NativeHelperProcess | undefined;
}

let resolvedNativeDirectory: string | undefined;

/** Resolves packaged versus development placement once for every helper. */
function nativeDirectory(): string {
  resolvedNativeDirectory ??= app.isPackaged
    ? process.resourcesPath
    : path.join(app.getAppPath(), ".build", "native");
  return resolvedNativeDirectory;
}

/** The one path resolver for executable helpers and the stationary addon. */
export function nativeHelperPath(binary: string): string {
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
    if (
      this.#child ||
      this.#ended ||
      (!this.#options.spawnProcess && process.platform !== "darwin")
    ) {
      return false;
    }
    try {
      const child = this.#options.spawnProcess?.() ?? this.#spawn();
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

  /** Stops the process and optionally resolves when its exit or the cap arrives. */
  stop(waitForExitMs = 0): Promise<void> {
    const child = this.#detach();
    if (!child) return Promise.resolve();
    if (waitForExitMs <= 0) {
      child.kill?.();
      return Promise.resolve();
    }
    const gone = new Promise<void>((resolve) => {
      child.on("exit", resolve);
      setTimeout(resolve, waitForExitMs).unref();
    });
    child.kill?.();
    return gone;
  }

  #spawn(): NativeHelperProcess {
    const stdio: StdioOptions = [
      this.#options.input ?? "ignore",
      this.#options.output === "lines"
        ? "pipe"
        : this.#options.output === "inherit"
          ? "inherit"
          : "ignore",
      "ignore",
    ];
    // SAFETY: spawn returns ChildProcess; this module alone narrows the stdio it configured.
    return spawn(nativeHelperPath(this.#options.binary), [...(this.#options.arguments ?? [])], {
      stdio,
    }) as NativeHelperProcess;
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
    const finalLine = this.#buffer.trim();
    if (finalLine) {
      for (const listener of this.#lineListeners) listener(finalLine);
    }
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

/** Runs a finite helper through the same spawn and line framing as watchers. */
export function nativeHelperLines(binary: string, timeoutMs: number): Promise<readonly string[]> {
  return new Promise((resolve) => {
    const lines: string[] = [];
    const helper = new NativeHelper({ binary, output: "lines" });
    let settled = false;
    const finish = (result: readonly string[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    helper.onLine((line) => lines.push(line));
    helper.onExit(() => finish(lines));
    const timer = setTimeout(() => {
      void helper.stop();
      finish([]);
    }, timeoutMs);
    timer.unref();
    if (!helper.start()) finish([]);
  });
}
