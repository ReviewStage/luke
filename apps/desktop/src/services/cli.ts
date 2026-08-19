import { execFile } from "node:child_process";
import path from "node:path";
import { isWireNumber } from "@sidecar/core";
import { CLI_FAILURE, CliFailure } from "@sidecar/core/effect-errors";
import { Context, Effect, Layer } from "effect";

/**
 * Where provider CLIs actually land on a Mac. An app launched from the Finder
 * inherits a PATH without the package-manager directories a terminal adds, so
 * these are appended after the inherited PATH — never ahead of it, so a binary
 * the user's own shell would resolve still wins.
 */
const WELL_KNOWN_BINARY_DIRECTORIES = ["/opt/homebrew/bin", "/usr/local/bin"] as const;

export interface CliRunResult {
  exitCode: number;
  stdout: string;
}

export class Cli extends Context.Tag("Cli")<
  Cli,
  {
    readonly run: (
      binary: string,
      argv: readonly string[],
      options: Readonly<{ timeoutMs: number; maximumOutputBytes: number; provider: string }>,
    ) => Effect.Effect<CliRunResult, CliFailure>;
  }
>() {}

export const CliLive: Layer.Layer<Cli> = Layer.succeed(Cli, {
  run: (binary, argv, options) =>
    Effect.async<CliRunResult, CliFailure>((resume) => {
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
            resume(Effect.succeed({ exitCode: 0, stdout }));
            return;
          }
          // SAFETY: The preceding check establishes the asserted contract.
          const exitCode = (error as NodeJS.ErrnoException & { code?: unknown }).code;
          if (isWireNumber(exitCode)) {
            resume(Effect.succeed({ exitCode, stdout }));
            return;
          }
          resume(
            Effect.fail(
              new CliFailure({
                // SAFETY: The preceding check establishes the asserted contract.
                failure:
                  (error as NodeJS.ErrnoException).code === "ENOENT"
                    ? CLI_FAILURE.UNAVAILABLE
                    : CLI_FAILURE.TRANSIENT,
                provider: options.provider,
              }),
            ),
          );
        },
      );
    }),
});
