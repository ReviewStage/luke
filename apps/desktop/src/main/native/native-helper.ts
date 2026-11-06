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

function nativeDirectory(): string {
  resolvedNativeDirectory ??= app.isPackaged
    ? process.resourcesPath
    : path.join(app.getAppPath(), ".build", "native");
  return resolvedNativeDirectory;
}

export function nativeHelperPath(binary: string): string {
  return path.join(nativeDirectory(), binary);
}

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

  endInput(): void {
    const child = this.#detach();
    try {
      child?.stdin?.end?.();
    } catch {}
  }

  stop(): void {
    this.#detach()?.kill?.();
  }

  #spawn(): NativeHelperProcess | undefined {
    if (process.platform !== "darwin") return undefined;
    const stdio: StdioOptions = [
      this.#options.input ?? "ignore",
      this.#options.output === "lines" ? "pipe" : "inherit",
      "ignore",
    ];
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
