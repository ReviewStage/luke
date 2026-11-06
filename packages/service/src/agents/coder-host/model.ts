import { createAnthropic } from "@ai-sdk/anthropic";
import type { ModelProvider } from "@repo/features/models-wire";
import type { LanguageModel } from "ai";
import { Effect, Redacted } from "effect";
import { HostedEnvironment } from "../../environment.js";

/**
 * model.ts -- the model every title is generated on, reached at Anthropic directly on our own key, and the shape of an account's own key opened for a call beside its agents.
 *
 * A title, an agent's, its task's, or an inbox thread's, is one small call
 * on a fixed cheap model at Anthropic's own door, on the key the deployment
 * holds for titles (`HostedEnvironment`'s `titleAnthropicApiKey`), whether
 * or not the account saved one of its own, so an account on a subscription
 * alone is named by a model too. Nothing goes through AI Gateway, and the
 * account's own key never pays for a title. A deployment holding no such
 * key gives no model, and the title is cut from its first words
 * (`title.ts`). The key is revealed here alone, into the SDK client that
 * puts it on its requests.
 */

/** The one model every title is generated on: Anthropic's cheapest that names a task well, at its own id. */
const TITLE_MODEL_ID = "claude-haiku-5-5";

/** One provider's API key the account saved, opened, for a call beside its agents (`account-keys.ts`'s `ownKeyOf`). */
export interface OwnKey {
  readonly provider: ModelProvider;
  readonly key: Redacted.Redacted;
}

/** The model a title is generated on: Anthropic's small title model on our own key, or none where the deployment holds no such key. */
export function deploymentTitleModel(): Effect.Effect<
  LanguageModel | undefined,
  never,
  HostedEnvironment
> {
  return Effect.gen(function* () {
    const { titleAnthropicApiKey } = yield* HostedEnvironment;
    if (titleAnthropicApiKey === undefined) return undefined;
    // The key is revealed here alone, into the SDK client that puts it on its requests.
    return createAnthropic({ apiKey: Redacted.value(titleAnthropicApiKey) })(TITLE_MODEL_ID);
  });
}
