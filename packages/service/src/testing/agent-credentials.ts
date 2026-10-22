// agent-credentials.ts -- an account's own API keys saved for both providers, so a suite's agents start and take messages.
import { parseKeyRing, sealProviderKey } from "@luke/database/models/provider-key-seal";
import { saveProviderKey } from "@luke/database/models/provider-key-store";
import { PROVIDER_KEY_KIND, PROVIDER_KEY_PROVIDER } from "@luke/features/provider-key-wire";
import { Effect, Redacted, Result } from "effect";

/**
 * Luke's key pays for no coding agent (`agent-runtime-choice.ts`), so a
 * suite whose account starts or messages an agent on eve saves its own API
 * keys first. The keys are sealed under a ring of the suite's own; a step
 * that would open them is a provider call no suite makes, so the ring the
 * deployment holds need not match.
 */

const FIXTURE_RING = `1:${Buffer.alloc(32, 3).toString("base64")}`;

/** Saves an API key of the account's for Anthropic and for OpenAI. */
export const connectAgentApiKeys = (userId: string) =>
  Effect.gen(function* () {
    const ring = parseKeyRing(Redacted.make(FIXTURE_RING));
    if (Result.isFailure(ring)) return yield* Effect.die(new Error("the fixture ring is no ring"));
    for (const provider of [PROVIDER_KEY_PROVIDER.ANTHROPIC, PROVIDER_KEY_PROVIDER.OPENAI]) {
      const owner = { userId, provider, kind: PROVIDER_KEY_KIND.API_KEY };
      yield* saveProviderKey(
        userId,
        provider,
        owner.kind,
        sealProviderKey(ring.success, owner, Redacted.make(`${provider}-agent-key-fixture`)),
        "sk-…ture",
        null,
        new Date(0),
      );
    }
  });
