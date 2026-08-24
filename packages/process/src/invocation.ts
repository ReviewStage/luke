import { execFile } from "node:child_process";
import path from "node:path";

export const DEFAULT_CLI_PATH_DIRECTORIES = ["/opt/homebrew/bin", "/usr/local/bin"] as const;

export const INVOCATION_FAILURE = {
  UNAVAILABLE: "unavailable",
  TIMED_OUT: "timed-out",
  OUTPUT_LIMIT: "output-limit",
  FAILED: "failed",
} as const;

export type InvocationFailure = (typeof INVOCATION_FAILURE)[keyof typeof INVOCATION_FAILURE];

export class InvocationError extends Error {
  readonly failure: InvocationFailure;

  constructor(failure: InvocationFailure, binary: string) {
    super(`${binary} could not be invoked`);
    this.name = "InvocationError";
    this.failure = failure;
  }
}

export interface BoundedInvocationOptions {
  binary: string;
  arguments: readonly string[];
  timeoutMs: number;
  maximumOutputBytes: number;
  /** Appended after the inherited PATH, so the user's own resolution still wins. */
  pathDirectories?: readonly string[];
}

export interface BoundedInvocationResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** The PATH one invocation receives, with empty and duplicate entries removed. */
export function invocationPath(pathDirectories: readonly string[] = []): string {
  return [...(process.env.PATH ?? "").split(path.delimiter), ...pathDirectories]
    .filter((entry, index, entries) => entry.length > 0 && entries.indexOf(entry) === index)
    .join(path.delimiter);
}

/**
 * Runs one binary directly with bounded time and output. A non-zero exit is an
 * answer and stays in the result; failures mean the invocation itself could
 * not produce a bounded answer. No shell is involved, so an argument remains
 * one argument whatever text it contains.
 */
export function boundedInvocation(
  options: BoundedInvocationOptions,
): Promise<BoundedInvocationResult> {
  return new Promise((resolve, reject) => {
    execFile(
      options.binary,
      [...options.arguments],
      {
        timeout: options.timeoutMs,
        maxBuffer: options.maximumOutputBytes,
        windowsHide: true,
        env: {
          ...process.env,
          PATH: invocationPath(options.pathDirectories),
        },
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ exitCode: 0, stdout, stderr });
          return;
        }
        // SAFETY: execFile reports command failures as errno-like errors.
        const commandError = error as NodeJS.ErrnoException & {
          code?: unknown;
          killed?: boolean;
        };
        const exitCode = Number(commandError.code);
        if (Number.isInteger(exitCode)) {
          resolve({ exitCode, stdout, stderr });
          return;
        }
        const failure =
          commandError.code === "ENOENT"
            ? INVOCATION_FAILURE.UNAVAILABLE
            : commandError.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
              ? INVOCATION_FAILURE.OUTPUT_LIMIT
              : commandError.killed || commandError.code === "ETIMEDOUT"
                ? INVOCATION_FAILURE.TIMED_OUT
                : INVOCATION_FAILURE.FAILED;
        reject(new InvocationError(failure, options.binary));
      },
    );
  });
}
