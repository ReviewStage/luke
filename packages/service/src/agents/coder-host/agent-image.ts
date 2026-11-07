/**
 * agent-image.ts -- the image every cloud agent's sandbox boots from, as the deploy names it to Vercel, and the runner the deploy launches in it.
 *
 * The image is built from `apps/web/agent-image/` and pushed to the
 * project's registry by CI under a tag that is a digest of what went into it
 * (`apps/web/scripts/agent-image.ts`), the runner's bundle among it. The web
 * build computes the same reference and ships it beside each function that
 * opens a sandbox (`apps/web/scripts/bundle-functions.ts`), under the names
 * below, with a digest of the image without the runner, which a base
 * snapshot is keyed on (`../base-snapshot.ts`), and the runner's bundle
 * itself, which each launch writes into the sandbox over whatever runner its
 * disk holds. The function reads each from the directory its own entry
 * stands in, once per instance.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Context, Data, Effect, Layer } from "effect";

/** The image's repository in the project's registry, which a sandbox's `image` names with its tag. */
export const AGENT_IMAGE_REPOSITORY = "agent-image";

/** The file the web build writes the image's reference into, beside each function that opens a sandbox. */
export const AGENT_IMAGE_FILE = "agent-image.txt";

/** The file the web build writes a digest of the image without the runner into, beside the reference. */
export const AGENT_IMAGE_BASE_FILE = "agent-image-base.txt";

/** The runner's bundle, as the image's context and each function that opens a sandbox name it. */
export const AGENT_RUNNER_FILE = "agent-runner.mjs";

/** The reference could not be read where the build should have left it. */
export class AgentImageMissing extends Data.TaggedError("AgentImageMissing") {}

export interface AgentImageService {
  /** The image as Vercel resolves it in the deployment's own project: its repository and tag. */
  readonly reference: Effect.Effect<string, AgentImageMissing>;
  /** A digest of the image without the runner: what a base snapshot made on it holds. */
  readonly base: Effect.Effect<string, AgentImageMissing>;
  /** The runner's bundle the deploy launches, written into each sandbox at launch. */
  readonly runner: Effect.Effect<Uint8Array, AgentImageMissing>;
}

export class AgentImage extends Context.Service<AgentImage, AgentImageService>()("AgentImage") {}

/** A file the build left in the directory given, read at its first use and held for the instance's life. */
const cachedRead = (directory: string, file: string) =>
  Effect.cached(
    Effect.tryPromise({
      try: () => readFile(join(directory, file)),
      catch: () => new AgentImageMissing(),
    }),
  );

/** The reference, the base digest, and the runner, each read from the directory given at its first use. */
export function agentImageFromDirectory(directory: string): Layer.Layer<AgentImage> {
  return Layer.effect(
    AgentImage,
    Effect.map(
      Effect.all([
        cachedRead(directory, AGENT_IMAGE_FILE),
        cachedRead(directory, AGENT_IMAGE_BASE_FILE),
        cachedRead(directory, AGENT_RUNNER_FILE),
      ]),
      ([reference, base, runner]) => ({
        reference: Effect.map(reference, (bytes) => bytes.toString("utf8").trim()),
        base: Effect.map(base, (bytes) => bytes.toString("utf8").trim()),
        runner,
      }),
    ),
  );
}
