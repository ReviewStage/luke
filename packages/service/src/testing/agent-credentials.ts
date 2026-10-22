// agent-credentials.ts -- an account's own API keys saved for both providers, so a suite's agents start and take messages.
import { parseKeyRing, sealProviderKey } from "@luke/database/models/provider-key-seal";
import { saveProviderKey } from "@luke/database/models/provider-key-store";
import {
  type FastAccess,
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  type ProviderKeyProvider,
} from "@luke/features/provider-key-wire";
import { Effect, Redacted, Result } from "effect";

/**
 * Luke's key pays for no coding agent (`agent-runtime-choice.ts`), and for
 * no call beside one either, so a suite whose account starts or messages an
 * agent on eve saves its own API keys first. The keys are sealed under a
 * ring of the suite's own (`AGENT_KEY_RING`), which a suite that opens them,
 * as a title or chapters do, hands its deployment; a step that would open
 * them is otherwise a provider call no suite makes, so the ring the
 * deployment holds need not match.
 */

const FIXTURE_RING = `1:${Buffer.alloc(32, 3).toString("base64")}`;

/** The ring the saved keys are sealed under, for a deployment that opens them. */
export const AGENT_KEY_RING = Redacted.make(FIXTURE_RING);

/** The key saved for a provider, as a provider faked at its door receives it. */
const agentKeyFixture = (provider: ProviderKeyProvider) => `${provider}-agent-key-fixture`;

/** What a suite saves: the providers, both where none are named, and the Anthropic key's fast access, unasked where none is given. */
interface AgentKeysSaved {
  readonly providers?: readonly ProviderKeyProvider[];
  readonly anthropicFast?: FastAccess | null;
}

/** Saves an API key of the account's for each provider named, Anthropic and OpenAI where none is. */
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
