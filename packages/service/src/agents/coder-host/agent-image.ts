/**
 * agent-image.ts -- the image every cloud agent's sandbox boots from, as the deploy names it to Vercel.
 *
 * The image is built from `apps/web/agent-image/` and pushed to the
 * project's registry by CI under a tag that is a digest of what went into it
 * (`apps/web/scripts/agent-image.ts`), the runner's bundle among it. The web
 * build computes the same reference and ships it beside each function that
 * opens a sandbox (`apps/web/scripts/bundle-functions.ts`), under the name
 * below, and the function reads it from the directory its own entry stands
 * in, once per instance.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Context, Data, Effect, Layer } from "effect";

/** The image's repository in the project's registry, which a sandbox's `image` names with its tag. */
export const AGENT_IMAGE_REPOSITORY = "agent-image";

/** The file the web build writes the image's reference into, beside each function that opens a sandbox. */
export const AGENT_IMAGE_FILE = "agent-image.txt";

/** The reference could not be read where the build should have left it. */
class AgentImageMissing extends Data.TaggedError("AgentImageMissing") {}

export interface AgentImageService {
  /** The image as Vercel resolves it in the deployment's own project: its repository and tag. */
  readonly reference: Effect.Effect<string, AgentImageMissing>;
}

export class AgentImage extends Context.Service<AgentImage, AgentImageService>()("AgentImage") {}

/** The reference read from the directory given at its first use, and held for the instance's life. */
export function agentImageFromDirectory(directory: string): Layer.Layer<AgentImage> {
  return Layer.effect(
    AgentImage,
    Effect.map(
      Effect.cached(
        Effect.tryPromise({
          try: async () => (await readFile(join(directory, AGENT_IMAGE_FILE), "utf8")).trim(),
          catch: () => new AgentImageMissing(),
        }),
      ),
      (reference) => ({ reference }),
    ),
  );
}
