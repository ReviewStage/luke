import { isWireNumber } from "@sidecar/core";
import { CLI_FAILURE, CliFailure } from "@sidecar/core/effect-errors";
import { Effect, Layer } from "effect";
import { Cli, type CliRunResult } from "../../src/services/cli";
import type { Files } from "../../src/services/files";
import { FilesLive } from "../../src/services/files";
import type { Http } from "../../src/services/http";
import { runWithHttp } from "./effect-http";

export function runLocalEffect<A, E>(effect: Effect.Effect<A, E, Files>): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(FilesLive)));
}

export function runHttpEffect<A, E>(
  effect: Effect.Effect<A, E, Http>,
  fetchLike: typeof fetch,
): Promise<A> {
  return runWithHttp(effect, fetchLike);
}

/** Fake CLI run used at the test boundary, matching `recordingFetch` for HTTP. */
export type CliRunForTest = (
  binary: string,
  argv: readonly string[],
) => Promise<CliRunResult> | CliRunResult;

export function cliLayerFromRun(run: CliRunForTest): Layer.Layer<Cli> {
  return Layer.succeed(Cli, {
    run: (binary, argv, options) =>
      Effect.async<CliRunResult, CliFailure>((resume) => {
        Promise.resolve(run(binary, argv))
          .then((result) => resume(Effect.succeed(result)))
          .catch((error) => {
            const exitCode = (error as NodeJS.ErrnoException & { code?: unknown }).code;
            if (isWireNumber(exitCode)) {
              resume(Effect.succeed({ exitCode, stdout: "" }));
              return;
            }
            resume(
              Effect.fail(
                new CliFailure({
                  failure:
                    (error as NodeJS.ErrnoException).code === "ENOENT"
                      ? CLI_FAILURE.UNAVAILABLE
                      : CLI_FAILURE.TRANSIENT,
                  provider: options.provider,
                }),
              ),
            );
          });
      }),
  });
}

export function runCliEffect<A, E>(
  effect: Effect.Effect<A, E, Cli>,
  run: CliRunForTest,
): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(cliLayerFromRun(run))));
}

/** @deprecated Prefer runLocalEffect or runHttpEffect at the call site. */
export const runTranscriptEffect = runLocalEffect;
