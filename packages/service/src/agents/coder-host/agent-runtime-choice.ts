/**
 * agent-runtime-choice.ts -- the runtime a new coding agent runs on and who pays for it, decided once as it starts.
 *
 * An agent runs on a native harness when, and only when, that provider's
 * plan pays for it. For Release 1's cohort that is Claude Code, paid for by
 * the account's Claude plan, offered to an account in
 * `LUKE_NATIVE_AGENT_ACCOUNTS`, on a Claude model Claude Code runs (no fast
 * variant), where the account keeps a Claude setup-token and this function
 * can launch the runner (`NativeAgentSessions`; TODO(P11b): the eve apps
 * cannot yet, so an agent their tools start decides eve).
 *
 * Where the plan is offered, the payer is the one Start picked for this
 * agent, else the account's default: the plan where its row's "Use my Claude
 * plan for coding agents" is on, eve's payer where it is off. eve's payer is
 * the account's own Anthropic API key where it saved one, and Luke's key
 * where it did not, since that is the key eve's steps run on
 * (`account-keys.ts`), so a pick of either names eve and the payer recorded
 * is the one eve bills. Where the plan is not offered, the agent runs on eve
 * exactly as before, with no payer recorded, whatever was picked.
 *
 * The choice is written on the agent as it is made and never changes: a
 * plan that later runs out or is disconnected pauses the agent, and never
 * moves it to another payer. P24 adds Codex for a ChatGPT plan here.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import { listProviderKeyRows } from "@luke/database/models/provider-key-store";
import { CONVERSATION_RUNTIME, type ConversationRuntime } from "@luke/database/storage-vocabulary";
import { CODING_AGENT_PAYER, type CodingAgentPayer } from "@luke/features/coding-agent-wire";
import { MODEL_PROVIDER } from "@luke/features/models-wire";
import { PROVIDER_KEY_KIND, PROVIDER_KEY_PROVIDER } from "@luke/features/provider-key-wire";
import { Effect, Option } from "effect";
import { HostedEnvironment } from "../../environment.js";
import type { StoreFailure } from "../../http/store-failure.js";
import { providerModelOf } from "../../providers/model-catalog.js";
import { NativeAgentSessions } from "./runtime-sessions.js";

/** What a new agent runs on, and who pays for it; no payer for an agent on eve outside the plan's offer, as before payers were recorded. */
export interface AgentRuntimeChoice {
  readonly runtime: ConversationRuntime;
  readonly payer: CodingAgentPayer | undefined;
}

const ON_EVE: AgentRuntimeChoice = { runtime: CONVERSATION_RUNTIME.EVE, payer: undefined };

const ON_CLAUDE_PLAN: AgentRuntimeChoice = {
  runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
  payer: CODING_AGENT_PAYER.CLAUDE_SUBSCRIPTION,
};

/** The account's Claude plan where it is offered for the model: the setup-token's row's default; none where the plan is not offered. */
const offeredClaudePlan = Effect.fnUntraced(function* (
  userId: string,
  model: string,
): Effect.fn.Return<{ readonly forAgents: boolean } | undefined, StoreFailure, DatabaseServices> {
  const environment = yield* Effect.serviceOption(HostedEnvironment);
  const cohort =
    Option.isSome(environment) && environment.value.nativeAgentAccounts.includes(userId);
  if (!cohort) return undefined;
  const provider = providerModelOf(model);
  if (provider?.provider !== MODEL_PROVIDER.ANTHROPIC || provider.fast) return undefined;
  if (Option.isNone(yield* Effect.serviceOption(NativeAgentSessions))) return undefined;
  const tokens = yield* listProviderKeyRows(userId, PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN);
  const token = tokens.find((row) => row.provider === PROVIDER_KEY_PROVIDER.ANTHROPIC);
  return token === undefined ? undefined : { forAgents: token.forAgents };
});

/** eve's payer for the account's Claude agents: its own Anthropic API key where it saved one, Luke's where it did not. */
const evePayer = Effect.fnUntraced(function* (
  userId: string,
): Effect.fn.Return<AgentRuntimeChoice, StoreFailure, DatabaseServices> {
  const keys = yield* listProviderKeyRows(userId, PROVIDER_KEY_KIND.API_KEY);
  const own = keys.some((row) => row.provider === PROVIDER_KEY_PROVIDER.ANTHROPIC);
  return {
    runtime: CONVERSATION_RUNTIME.EVE,
    payer: own ? CODING_AGENT_PAYER.API_KEY : CODING_AGENT_PAYER.LUKE,
  };
});

/** The runtime and payer of a new agent of the account's on the model given, the payer Start picked honoured where it was offered, as above. */
export const agentRuntimeChoice = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  model: string,
  picked?: CodingAgentPayer,
): Effect.fn.Return<AgentRuntimeChoice, StoreFailure, DatabaseServices> {
  const plan = yield* offeredClaudePlan(userId, model);
  if (plan === undefined) return ON_EVE;
  const onPlan =
    picked === undefined ? plan.forAgents : picked === CODING_AGENT_PAYER.CLAUDE_SUBSCRIPTION;
  return onPlan ? ON_CLAUDE_PLAN : yield* evePayer(userId);
});
