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
 * - Codex, paid for by the account's ChatGPT plan, on the same terms for a
 *   GPT model (no fast variant), where the account keeps a ChatGPT sign-in
 *   (`chatgpt_oauth`) that OpenAI has not signed out and the deployment can
 *   still open.
 * - eve, exactly as today, for everything else, with no payer recorded.
 *
 * The choice is written on the agent as it is made and never changes: a
 * plan that later runs out or is disconnected pauses the agent, and never
 * moves it to another payer. P14 lets Start pick the API key or Luke's key
 * in place of the plan.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import { openProviderKey, parseKeyRing } from "@luke/database/models/provider-key-seal";
import { listProviderKeyRows } from "@luke/database/models/provider-key-store";
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

/** What a new agent runs on, and who pays for it; no payer for an agent on eve, as before payers were recorded. */
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

/** The statuses of a ChatGPT sign-in an agent cannot launch on: OpenAI signed it out, or the deployment cannot open it. */
const UNUSABLE_SIGN_IN: ReadonlySet<string> = new Set([
  PROVIDER_KEY_STATUS.INVALID,
  PROVIDER_KEY_STATUS.UNREADABLE,
]);

/**
 * Whether the account keeps the plan credential its provider's harness
 * launches on, as above. A ChatGPT sign-in must also open under the
 * deployment's ring as it stands, since a row sealed under a key since
 * rotated out still reads as its last stored status.
 */
const keepsPlan = (userId: string, provider: string, ring: Redacted.Redacted | undefined) =>
  provider === MODEL_PROVIDER.ANTHROPIC
    ? Effect.map(listProviderKeyRows(userId, PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN), (rows) =>
        rows.some((row) => row.provider === PROVIDER_KEY_PROVIDER.ANTHROPIC),
      )
    : Effect.map(listProviderKeyRows(userId, PROVIDER_KEY_KIND.CHATGPT_OAUTH), (rows) => {
        const parsed = ring === undefined ? undefined : parseKeyRing(ring);
        if (parsed === undefined || Result.isFailure(parsed)) return false;
        const owner = {
          userId,
          provider: PROVIDER_KEY_PROVIDER.OPENAI,
          kind: PROVIDER_KEY_KIND.CHATGPT_OAUTH,
        };
        return rows.some(
          (row) =>
            row.provider === PROVIDER_KEY_PROVIDER.OPENAI &&
            !UNUSABLE_SIGN_IN.has(row.status) &&
            Result.isSuccess(openProviderKey(parsed.success, owner, row)),
        );
      });

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
  if (provider === undefined || provider.fast) return ON_EVE;
  if (Option.isNone(yield* Effect.serviceOption(NativeAgentSessions))) return ON_EVE;
  const ring = environment.value.providerKeyEncryptionKeys;
  if (!(yield* keepsPlan(userId, provider.provider, ring))) return ON_EVE;
  return provider.provider === MODEL_PROVIDER.ANTHROPIC ? ON_CLAUDE_CODE : ON_CODEX;
});
