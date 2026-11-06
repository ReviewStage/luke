import { parseKeyRing, sealProviderKey } from "@repo/database/models/provider-key-seal";
import { saveProviderKey } from "@repo/database/models/provider-key-store";
import {
  type FastAccess,
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  type ProviderKeyProvider,
} from "@repo/features/provider-key-wire";
import { Effect, Redacted, Result } from "effect";

const FIXTURE_RING = `1:${Buffer.alloc(32, 3).toString("base64")}`;

export const AGENT_KEY_RING = Redacted.make(FIXTURE_RING);

const agentKeyFixture = (provider: ProviderKeyProvider) => `${provider}-agent-key-fixture`;

interface AgentKeysSaved {
  readonly providers?: readonly ProviderKeyProvider[];
  readonly anthropicFast?: FastAccess | null;
}

export const connectAgentApiKeys = (userId: string, saved: AgentKeysSaved = {}) =>
  Effect.gen(function* () {
    const ring = parseKeyRing(AGENT_KEY_RING);
    if (Result.isFailure(ring)) return yield* Effect.die(new Error("the fixture ring is no ring"));
    const providers = saved.providers ?? Object.values(PROVIDER_KEY_PROVIDER);
    for (const provider of providers) {
      const owner = { userId, provider, kind: PROVIDER_KEY_KIND.API_KEY };
      yield* saveProviderKey(
        userId,
        provider,
        owner.kind,
        sealProviderKey(ring.success, owner, Redacted.make(agentKeyFixture(provider))),
        "sk-…ture",
        provider === PROVIDER_KEY_PROVIDER.ANTHROPIC ? (saved.anthropicFast ?? null) : null,
        new Date(0),
      );
    }
  });
