import { createAnthropic } from "@ai-sdk/anthropic";
import type { ModelProvider } from "@repo/features/models-wire";
import type { LanguageModel } from "ai";
import { Effect, Redacted } from "effect";
import { HostedEnvironment } from "../../environment.js";

const TITLE_MODEL_ID = "claude-haiku-5-5";

export interface OwnKey {
  readonly provider: ModelProvider;
  readonly key: Redacted.Redacted;
}

export function deploymentTitleModel(): Effect.Effect<
  LanguageModel | undefined,
  never,
  HostedEnvironment
> {
  return Effect.gen(function* () {
    const { titleAnthropicApiKey } = yield* HostedEnvironment;
    if (titleAnthropicApiKey === undefined) return undefined;
    return createAnthropic({ apiKey: Redacted.value(titleAnthropicApiKey) })(TITLE_MODEL_ID);
  });
}
