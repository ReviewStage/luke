/**
 * agent-runtime-choice.ts -- the runtime a new coding agent runs on and who pays for it, decided once as it starts.
 *
 * An agent runs on a native harness when, and only when, that provider's
 * plan pays for it. The plan is offered to every account that connected it:
 *
 * - Claude Code, paid for by the account's Claude plan, on a Claude model
 *   Claude Code runs (no fast variant), where the account keeps a Claude
 *   setup-token and this
 *   function reaches a harness (`NativeAgentSessions`: a web function's own,
 *   or the eve app's relay to one, so a Start from an eve agent decides as
 *   the panel's does).
 * - Codex, paid for by the account's ChatGPT plan, on the same terms for a
 *   GPT model (no fast variant), where the account keeps a ChatGPT sign-in
 *   (`chatgpt_oauth`) that OpenAI has not signed out and the deployment can
 *   still open.
 *
 * Where a plan is offered, the payer is the one Start picked for this
 * agent, else the account's default: the plan where its row's "Use my
 * Claude plan" or "Use my ChatGPT plan for coding agents" is on, eve's
 * payer where it is off. eve's payer is the account's own API key for the
 * model's provider where it saved one, and Luke's key where it did not,
 * since that is the key eve's steps run on (`account-keys.ts`), so a pick of
 * either names eve and the payer recorded is the one eve bills. A pick of
 * the other provider's plan is no pick of this one's. Where no plan is
 * offered, as for an account that connected none, the agent runs on eve
 * exactly as before, with no payer recorded, whatever was picked.
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
import { MODEL_PROVIDER } from "@luke/features/models-wire";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
} from "@luke/features/provider-key-wire";
import { Effect, Option, type Redacted, Result } from "effect";
import { HostedEnvironment } from "../../environment.js";
import type { StoreFailure } from "../../http/store-failure.js";
import { providerModelOf } from "../../providers/model-catalog.js";
import { NativeAgentSessions } from "./runtime-sessions.js";

/** What a new agent runs on, and who pays for it; no payer for an agent on eve outside a plan's offer, as before payers were recorded. */
export interface AgentRuntimeChoice {
  readonly runtime: ConversationRuntime;
  readonly payer: CodingAgentPayer | undefined;
}

const ON_EVE: AgentRuntimeChoice = { runtime: CONVERSATION_RUNTIME.EVE, payer: undefined };

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

/** eve's payer for the account's agents on the provider's models: its own API key for that provider where it saved one, Luke's where it did not. */
const evePayer = Effect.fnUntraced(function* (
  userId: string,
  provider: string,
): Effect.fn.Return<AgentRuntimeChoice, StoreFailure, DatabaseServices> {
  const keys = yield* listProviderKeyRows(userId, PROVIDER_KEY_KIND.API_KEY);
  const own = keys.some((row) => row.provider === provider);
  return {
    runtime: CONVERSATION_RUNTIME.EVE,
    payer: own ? CODING_AGENT_PAYER.API_KEY : CODING_AGENT_PAYER.LUKE,
  };
});

/** The runtime and payer of a new agent of the account's on the model given, the payer Start picked honoured where a plan is offered, as above. */
export const agentRuntimeChoice = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  model: string,
  picked?: CodingAgentPayer,
): Effect.fn.Return<AgentRuntimeChoice, StoreFailure, DatabaseServices> {
  const provider = providerModelOf(model);
  if (provider === undefined || provider.fast) return ON_EVE;
  if (Option.isNone(yield* Effect.serviceOption(NativeAgentSessions))) return ON_EVE;
  const environment = yield* Effect.serviceOption(HostedEnvironment);
  const ring = Option.getOrUndefined(environment)?.providerKeyEncryptionKeys;
  const plan = yield* keptPlan(userId, provider.provider, ring);
  if (plan === undefined) return ON_EVE;
  const onPlan = onPlanOf(provider.provider);
  const chosen = picked === undefined ? plan.forAgents : picked === onPlan.payer;
  return chosen ? onPlan : yield* evePayer(userId, provider.provider);
});
