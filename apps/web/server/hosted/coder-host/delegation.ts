import { codingAgentDelegationInputSchema } from "@sidecar/hosted/coding-agent-wire";
import type { ModelChoice } from "@sidecar/hosted/models-wire";
import { Effect, Result, type Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { openChildConversation } from "../brain-host/conversation.js";
import { childConversationId } from "../brain-host/ids.js";
import { writeDelegation } from "../coding-agent-store.js";
import { MODEL_CHOICE_REFUSAL, type OfferedModel, validateModelChoice } from "../model-catalog.js";
import type { ConversationTarget } from "../store/index.js";

/**
 * delegation.ts -- what a coding agent chooses for a worker: the model and effort, checked as a Start checks its own.
 *
 * The agent names a model and an effort for each worker, or leaves either
 * to its own: an absent model or effort is the agent's own, read from its
 * row as the delegation is made. The pair is held to the same catalog a
 * Start and a change of model are, and a refusal is one sentence the model
 * can act on: the models the catalog offers, or the efforts the named model
 * lists. The pair taken is recorded under the child conversation the call
 * names, opened here ahead of the worker's session, so the worker's steps
 * read it there (`host.ts`).
 */

/** The delegation tool as the model is shown it (`coder/tools/delegate.ts`): what it does, and its input, the task with the pair the agent chose. */
export const DELEGATE_TOOL = {
  description:
    "Hand one scoped task to a read-only worker that reads your checkout, your uncommitted edits included, and wait for its complete answer. Name the model and effort it runs on, or leave either to your own. Several calls in one step run at once.",
  inputSchema: codingAgentDelegationInputSchema,
} as const;

/** What the agent asked for a worker: a model and an effort, each absent where it left it to its own. */
export interface DelegationAsk {
  readonly model?: string | undefined;
  readonly effort?: string | undefined;
}

const LIST_SEPARATOR = ", ";

/** The models the catalog offers, as the refusal names them. */
function offeredIds(catalog: readonly OfferedModel[]): string {
  return catalog.map((model) => model.id).join(LIST_SEPARATOR);
}

/**
 * The pair a worker runs on, or the one sentence refusing it. Note that the
 * refusal lists what would have been accepted, because the agent reads it
 * as a tool's failure and tries again from it.
 */
export function delegationChoice(
  own: ModelChoice,
  asked: DelegationAsk,
  catalog: readonly OfferedModel[],
): Result.Result<ModelChoice, string> {
  const choice = { model: asked.model ?? own.model, effort: asked.effort ?? own.effort };
  const checked = validateModelChoice(catalog, choice);
  if (Result.isSuccess(checked)) return checked;
  if (checked.failure === MODEL_CHOICE_REFUSAL.UNKNOWN_MODEL) {
    return Result.fail(
      `Not run: \`${choice.model}\` is no model Luke offers. The models: ${offeredIds(catalog)}.`,
    );
  }
  const efforts = catalog.find((offered) => offered.id === choice.model)?.efforts ?? [];
  return Result.fail(
    `Not run: \`${choice.model}\` lists no effort \`${choice.effort}\`. Its efforts: ${efforts.join(LIST_SEPARATOR)}.`,
  );
}

/**
 * Records a delegation ahead of the worker's session: the child conversation
 * the call names, which the worker is recorded in, opened under the agent's,
 * and the pair it runs on written beside it with the call's id, in one
 * transaction.
 */
export function recordDelegation(
  parent: ConversationTarget,
  callId: string,
  choice: ModelChoice,
  label: string,
): Effect.Effect<void, SqlError | Schema.SchemaError, SqlClient.SqlClient> {
  const child = childConversationId(parent.conversationId, callId);
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.andThen(
        openChildConversation(parent, child, label),
        writeDelegation(child, callId, choice),
      ),
    ),
  );
}
