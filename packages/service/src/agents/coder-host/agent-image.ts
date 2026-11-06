import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Context, Data, Effect, Layer } from "effect";

export const AGENT_IMAGE_REPOSITORY = "agent-image";

export const AGENT_IMAGE_FILE = "agent-image.txt";

export class AgentImageMissing extends Data.TaggedError("AgentImageMissing") {}

export interface AgentImageService {
  readonly reference: Effect.Effect<string, AgentImageMissing>;
}

export class AgentImage extends Context.Service<AgentImage, AgentImageService>()("AgentImage") {}

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
