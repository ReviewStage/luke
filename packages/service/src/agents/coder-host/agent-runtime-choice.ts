/**
 * agent-runtime-choice.ts -- the runtime a new coding agent runs on and who pays for it, decided once as it starts.
 *
 * An agent runs on a native harness when, and only when, that provider's
 * plan pays for it. The plan is offered to every account that connected it:
 *
 * - Claude Code, paid for by the account's Claude plan, on any Claude model,
 *   a fast version running with Claude Code's own fast mode on, where the
 *   account keeps a Claude setup-token and this function reaches a harness
 *   (`NativeAgentSessions`: a web function's own, or the eve app's relay to
 *   one, so a Start from an eve agent decides as the panel's does).
 * - Codex, paid for by the account's ChatGPT plan, on the same terms for a
 *   GPT model; Codex has no fast mode, so an account whose ChatGPT plan pays
 *   is offered no GPT fast version (`accountFastOffer`), where the account
 *   keeps a ChatGPT sign-in (`chatgpt_oauth`)
 *   that OpenAI has not signed out and the deployment can still open.
 *
 * Settings' choice for that harness decides: the plan where its row's
 * `forAgents` is on (Subscription) and the plan is offered, the account's
 * own API key for the model's provider, on eve, otherwise. Luke's own key
 * pays for no coding agent: an account with neither is refused by name
 * (`AgentCredentialMissing`, which names the provider), and connects one in
 * Settings › Agents. A brand-new account starts no coding agent until it
 * connects a subscription or saves an API key.
 *
 * The choice is written on the agent as it is made and never changes: a
 * plan that later runs out or is disconnected pauses the agent, and never
 * moves it to another payer.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import { openProviderKey, parseKeyRing } from "@luke/database/models/provider-key-seal";
import { listProviderKeyRows, type ProviderKeyRow } from "@luke/database/models/provider-key-store";
import { CONVERSATION_RUNTIME, type ConversationRuntime } from "@luke/database/storage-vocabulary";
import { CODING_AGENT_PAYER, type CodingAgentPayer } from "@luke/features/coding-agent-wire";
import { MODEL_PROVIDER, type ModelProvider } from "@luke/features/models-wire";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
} from "@luke/features/provider-key-wire";
import { Data, Effect, Option, type Redacted, Result } from "effect";
import { HostedEnvironment } from "../../environment.js";
import type { StoreFailure } from "../../http/store-failure.js";
import {
  type AccountFastOffer,
  type ModelCatalog,
  providerModelOf,
} from "../../providers/model-catalog.js";
import { anthropicFastAccess } from "./account-keys.js";
import { NativeAgentSessions } from "./runtime-sessions.js";

/** No credential of the account's pays for a coding agent on the provider's models: neither its subscription, selected in Settings, nor its API key. */
export class AgentCredentialMissing extends Data.TaggedError("AgentCredentialMissing")<{
  readonly provider: ModelProvider;
}> {}

/** What a new agent runs on, and who pays for it. The type keeps no payer readable for a row from before payers were recorded; a new agent always names one. */
export interface AgentRuntimeChoice {
  readonly runtime: ConversationRuntime;
  readonly payer: CodingAgentPayer | undefined;
}

const ON_API_KEY: AgentRuntimeChoice = {
  runtime: CONVERSATION_RUNTIME.EVE,
  payer: CODING_AGENT_PAYER.API_KEY,
};

const ON_CLAUDE_CODE: AgentRuntimeChoice = {
  runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
  payer: CODING_AGENT_PAYER.CLAUDE_SUBSCRIPTION,
};

const ON_CODEX: AgentRuntimeChoice = {
  runtime: CONVERSATION_RUNTIME.CODEX,
  payer: CODING_AGENT_PAYER.CHATGPT_SUBSCRIPTION,
};

/** The statuses of a ChatGPT sign-in an agent cannot launch on: OpenAI signed it out or said the account is not eligible, or the deployment cannot open it. */
const UNUSABLE_SIGN_IN: ReadonlySet<string> = new Set([
  PROVIDER_KEY_STATUS.INVALID,
  PROVIDER_KEY_STATUS.INELIGIBLE,
  PROVIDER_KEY_STATUS.UNREADABLE,
]);

/**
 * The plan credential the provider's harness launches on, as the account
 * keeps it, or none, as above. A ChatGPT sign-in must also open under the
 * deployment's ring as it stands, since a row sealed under a key since
 * rotated out still reads as its last stored status.
 */
const keptPlan = (
  userId: string,
  provider: string,
  ring: Redacted.Redacted | undefined,
): Effect.Effect<ProviderKeyRow | undefined, StoreFailure, DatabaseServices> =>
  provider === MODEL_PROVIDER.ANTHROPIC
    ? Effect.map(listProviderKeyRows(userId, PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN), (rows) =>
        rows.find((row) => row.provider === PROVIDER_KEY_PROVIDER.ANTHROPIC),
      )
    : Effect.map(listProviderKeyRows(userId, PROVIDER_KEY_KIND.CHATGPT_OAUTH), (rows) => {
        const parsed = ring === undefined ? undefined : parseKeyRing(ring);
        if (parsed === undefined || Result.isFailure(parsed)) return undefined;
        const owner = {
          userId,
          provider: PROVIDER_KEY_PROVIDER.OPENAI,
          kind: PROVIDER_KEY_KIND.CHATGPT_OAUTH,
        };
        return rows.find(
          (row) =>
            row.provider === PROVIDER_KEY_PROVIDER.OPENAI &&
            !UNUSABLE_SIGN_IN.has(row.status) &&
            Result.isSuccess(openProviderKey(parsed.success, owner, row)),
        );
      });

/** The plan's runtime and payer for a model of the provider's: Claude Code for Anthropic's, Codex for OpenAI's. */
const onPlanOf = (provider: string): AgentRuntimeChoice =>
  provider === MODEL_PROVIDER.ANTHROPIC ? ON_CLAUDE_CODE : ON_CODEX;

/** Whether the account saved its own API key for the provider, which pays for its agents on eve. */
export const keepsApiKey = (
  userId: string,
  provider: ModelProvider,
): Effect.Effect<boolean, StoreFailure, DatabaseServices> =>
  Effect.map(listProviderKeyRows(userId, PROVIDER_KEY_KIND.API_KEY), (rows) =>
    rows.some((row) => row.provider === provider),
  );

/** eve on the account's own API key for the provider, or refused by name where it saved none, since Luke's key pays for no coding agent. */
export const onApiKey = Effect.fnUntraced(function* (
  userId: string,
  provider: ModelProvider,
): Effect.fn.Return<AgentRuntimeChoice, StoreFailure | AgentCredentialMissing, DatabaseServices> {
  if (!(yield* keepsApiKey(userId, provider))) {
    return yield* Effect.fail(new AgentCredentialMissing({ provider }));
  }
  return ON_API_KEY;
});

/** The provider of a model the catalog offers; every model a Start accepted has one, so none is a defect. */
export const providerOfModel = (model: string): Effect.Effect<ModelProvider> => {
  const named = providerModelOf(model);
  return named === undefined
    ? Effect.die(new Error(`no provider for the model ${model}`))
    : Effect.succeed(named.provider);
};

/** The runtime and payer of a new agent of the account's on a model of the provider's, by Settings' choice, or refused where no credential of the account's pays, as above. */
const providerRuntimeChoice = Effect.fnUntraced(function* (
  userId: string,
  provider: ModelProvider,
): Effect.fn.Return<AgentRuntimeChoice, StoreFailure | AgentCredentialMissing, DatabaseServices> {
  const harness = Option.isSome(yield* Effect.serviceOption(NativeAgentSessions));
  const environment = yield* Effect.serviceOption(HostedEnvironment);
  const ring = Option.getOrUndefined(environment)?.providerKeyEncryptionKeys;
  const plan = harness ? yield* keptPlan(userId, provider, ring) : undefined;
  if (plan?.forAgents === true) return onPlanOf(provider);
  return yield* onApiKey(userId, provider);
});

/** The runtime and payer of a new agent of the account's on the model given, as above. */
export const agentRuntimeChoice = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  model: string,
): Effect.fn.Return<AgentRuntimeChoice, StoreFailure | AgentCredentialMissing, DatabaseServices> {
  return yield* providerRuntimeChoice(userId, yield* providerOfModel(model));
});

/**
 * The provider whose credential an agent standing on eve lacks to take a
 * message, or none where it may: one recorded as paid for by Luke's key is
 * refused whatever its starter keeps now, since an agent never moves to
 * another payer, and any other agent on eve (its own API key, or from
 * before payers were recorded) needs its starter's API key for its model's
 * provider, which its steps run on (`account-keys.ts`). An agent on a native
 * harness is its plan's, which refuses by its own words.
 */
export const messageCredentialMissing = /* @__PURE__ */ Effect.fnUntraced(function* (
  agent: { readonly userId: string; readonly model: string },
  routing: { readonly runtime: ConversationRuntime; readonly payer: CodingAgentPayer | null },
): Effect.fn.Return<ModelProvider | undefined, StoreFailure, DatabaseServices> {
  if (routing.runtime !== CONVERSATION_RUNTIME.EVE) return undefined;
  const provider = yield* providerOfModel(agent.model);
  if (routing.payer === CODING_AGENT_PAYER.LUKE) return provider;
  return (yield* keepsApiKey(agent.userId, provider)) ? undefined : provider;
});

/**
 * The providers none of whose models a Start of the account's would run,
 * since no credential of its pays for them, as `agentRuntimeChoice` decides
 * it; the menus mark those models rather than let a Start fail late.
 */
export const unconnectedProviders = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
): Effect.fn.Return<ReadonlySet<ModelProvider>, StoreFailure, DatabaseServices> {
  const missing = new Set<ModelProvider>();
  for (const provider of Object.values(MODEL_PROVIDER)) {
    const paid = yield* providerRuntimeChoice(userId, provider).pipe(
      Effect.as(true),
      Effect.catchTag("AgentCredentialMissing", () => Effect.succeed(false)),
    );
    if (!paid) missing.add(provider);
  }
  return missing;
});

/** The models offered the account, each of a provider no credential of its pays for marked so (`unconnectedProviders`). */
export const markedUnconnected = /* @__PURE__ */ Effect.fnUntraced(function* <
  Model extends { readonly provider: ModelProvider },
>(
  userId: string,
  offered: readonly Model[],
): Effect.fn.Return<readonly Model[], StoreFailure, DatabaseServices> {
  const missing = yield* unconnectedProviders(userId);
  if (missing.size === 0) return offered;
  return offered.map((model) =>
    missing.has(model.provider) ? { ...model, credentialMissing: true } : model,
  );
});

/**
 * Which fast versions the account is offered (`offeredToAccount`): by the
 * Anthropic key its steps run on, and whether its ChatGPT plan pays for its
 * GPT agents, as Start would choose it here, since Codex runs no fast mode
 * and a Fast it cannot run is never offered.
 */
export const accountFastOffer = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
): Effect.fn.Return<AccountFastOffer, StoreFailure, DatabaseServices | ModelCatalog> {
  const anthropic = yield* anthropicFastAccess(userId);
  const environment = yield* Effect.serviceOption(HostedEnvironment);
  const ring = Option.getOrUndefined(environment)?.providerKeyEncryptionKeys;
  const plan = yield* keptPlan(userId, MODEL_PROVIDER.OPENAI, ring);
  return { anthropic, chatGptPlan: plan?.forAgents === true };
});
