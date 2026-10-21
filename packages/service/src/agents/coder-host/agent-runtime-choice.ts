/**
 * agent-runtime-choice.ts -- the runtime a new coding agent runs on and who pays for it, decided once as it starts.
 *
 * An agent runs on a native harness when, and only when, that provider's
 * plan pays for it. For Release 1's cohort that is:
 *
 * - Claude Code, paid for by the account's Claude plan, for an account in
 *   `LUKE_NATIVE_AGENT_ACCOUNTS`, on a Claude model Claude Code runs (no
 *   fast variant), where the account keeps a Claude setup-token and this
 *   function can launch the runner (`NativeAgentSessions`; TODO(P11b): the
 *   eve apps cannot yet, so an agent their tools start decides eve).
 * - eve, exactly as today, for everything else, with no payer recorded.
 *
 * The choice is written on the agent as it is made and never changes: a
 * plan that later runs out or is disconnected pauses the agent, and never
 * moves it to another payer. P14 lets Start pick the API key or Luke's key
 * in place of the plan; P24 adds Codex for a ChatGPT plan here.
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

/** What a new agent runs on, and who pays for it; no payer for an agent on eve, as before payers were recorded. */
export interface AgentRuntimeChoice {
  readonly runtime: ConversationRuntime;
  readonly payer: CodingAgentPayer | undefined;
}

const ON_EVE: AgentRuntimeChoice = { runtime: CONVERSATION_RUNTIME.EVE, payer: undefined };

/** The runtime and payer of a new agent of the account's on the model given, as above. */
export const agentRuntimeChoice = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  model: string,
): Effect.fn.Return<AgentRuntimeChoice, StoreFailure, DatabaseServices> {
  const environment = yield* Effect.serviceOption(HostedEnvironment);
  const cohort =
    Option.isSome(environment) && environment.value.nativeAgentAccounts.includes(userId);
  if (!cohort) return ON_EVE;
  const provider = providerModelOf(model);
  if (provider?.provider !== MODEL_PROVIDER.ANTHROPIC || provider.fast) return ON_EVE;
  if (Option.isNone(yield* Effect.serviceOption(NativeAgentSessions))) return ON_EVE;
  const tokens = yield* listProviderKeyRows(userId, PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN);
  if (!tokens.some((row) => row.provider === PROVIDER_KEY_PROVIDER.ANTHROPIC)) return ON_EVE;
  return {
    runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
    payer: CODING_AGENT_PAYER.CLAUDE_SUBSCRIPTION,
  } satisfies AgentRuntimeChoice;
});
