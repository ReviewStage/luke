/**
 * runner-bundle.ts -- the runner a native harness's sandbox runs, as the one bundled file the launch uploads.
 *
 * `@luke/agent-runner` builds to one file with the Agent SDK inside it
 * (`pnpm --filter @luke/agent-runner build`), and the web build ships that
 * file beside each function that launches it (`apps/web/scripts/bundle-functions.ts`),
 * under the name below. The function reads it from the directory its own
 * entry stands in, once per instance.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Context, Data, Effect, Layer } from "effect";

/** The bundle's name, as the runner's build writes it and the web build ships it. */
export const RUNNER_BUNDLE_FILE = "agent-runner.mjs";

/** The bundle could not be read where the build should have left it. */
class RunnerBundleMissing extends Data.TaggedError("RunnerBundleMissing") {}

export interface RunnerBundleService {
  /** The bundle's bytes. */
  readonly contents: Effect.Effect<Uint8Array, RunnerBundleMissing>;
}

export class RunnerBundle extends Context.Service<RunnerBundle, RunnerBundleService>()(
  "RunnerBundle",
) {}

/** The bundle read from the directory given at its first use, and held for the instance's life. */
export function runnerBundleFromDirectory(directory: string): Layer.Layer<RunnerBundle> {
  return Layer.effect(
    RunnerBundle,
    Effect.map(
      Effect.cached(
        Effect.tryPromise({
          try: () => readFile(join(directory, RUNNER_BUNDLE_FILE)),
          catch: () => new RunnerBundleMissing(),
        }),
      ),
      (contents) => ({ contents }),
    ),
  );
}
