import { execFile } from "node:child_process";
import path from "node:path";
import { isWireNumber } from "@sidecar/core";
import { Context, Data, Effect, Layer } from "effect";
import {
  CLI_FAILURE,
  CliCommandError,
  type CliFailure,
  type CliRun,
  type CliRunResult,
} from "../cli-session-adapter";

export class CliRunService extends Context.Tag("CliRunService")<CliRunService, CliRun>() {}

export class CliRunFailure extends Data.TaggedError("CliRunFailure")<{
  readonly failure: CliFailure;
  readonly message: string;
}> {}

const WELL_KNOWN_BINARY_DIRECTORIES = ["/opt/homebrew/bin", "/usr/local/bin"] as const;

const defaultCliRun: CliRun = (binary, argv, options) =>
  new Promise((resolve, reject) => {
    execFile(
      binary,
      argv,
      {
        timeout: options.timeoutMs,
        maxBuffer: options.maximumOutputBytes,
        windowsHide: true,
        env: {
          ...process.env,
          PATH: [process.env.PATH, ...WELL_KNOWN_BINARY_DIRECTORIES]
            .filter(Boolean)
            .join(path.delimiter),
        },
      },
      (error, stdout) => {
        if (error === null) {
          resolve({ exitCode: 0, stdout });
          return;
        }
        // SAFETY: The preceding check establishes the asserted contract.
        const exitCode = (error as NodeJS.ErrnoException & { code?: unknown }).code;
        if (isWireNumber(exitCode)) {
          resolve({ exitCode, stdout });
          return;
        }
        reject(
          new CliCommandError(
            // SAFETY: The preceding check establishes the asserted contract.
            (error as NodeJS.ErrnoException).code === "ENOENT"
              ? CLI_FAILURE.UNAVAILABLE
              : CLI_FAILURE.TRANSIENT,
            `${binary} could not be run`,
          ),
        );
      },
    );
  });

export const CliRunLive = Layer.succeed(CliRunService, defaultCliRun);

export function fromCliCommandError(error: CliCommandError): CliRunFailure {
  return new CliRunFailure({ failure: error.failure, message: error.message });
}

function mapCliError(error: unknown, binary: string): CliRunFailure {
  if (error instanceof CliCommandError) {
    return fromCliCommandError(error);
  }
  return new CliRunFailure({
    failure: CLI_FAILURE.TRANSIENT,
    message: `${binary} could not be run`,
  });
}

export const cliRun = (
  binary: string,
  argv: readonly string[],
  options: Readonly<{ timeoutMs: number; maximumOutputBytes: number }>,
): Effect.Effect<CliRunResult, CliRunFailure, CliRunService> =>
  Effect.gen(function* () {
    const run = yield* CliRunService;
    return yield* Effect.tryPromise({
      try: () => run(binary, argv, options),
      catch: (error) => mapCliError(error, binary),
    });
  });
