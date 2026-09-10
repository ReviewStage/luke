import { randomUUID } from "node:crypto";
import {
  ACTION_KIND,
  ACTION_REFUSAL,
  ACTION_RESULT_STATUS,
  type AdmitContext,
  type BrainActionExecution,
  type BrainActionPerformer,
  type CloudAgentProviderId,
  CONVERSATION_ENTRY_KIND,
  type ConversationEntry,
  dispatchByKind,
  isCloudAgentProviderId,
  isRecord,
  isRunOrigin,
  isWireString,
  type RealtimeFunctionCall,
  type RememberedFact,
  RUN_ORIGIN,
  type SessionActionKind,
  sessionActionConversationEntry,
  toolAction,
  type UnparsedWireValue,
  type ValidatedAction,
  type WireRecord,
  workspaceAgentModels,
} from "../../core.js";
import type { ActionExecutionAnswer, HostedSessionActionKind } from "../action-execute.js";
import type { HostedWorkspaceDefaults } from "./context.js";
import type { HostedRoster } from "./roster.js";

/**
 * The gauntlet every action the hosted brain asks for runs, in the service:
 * the call is admitted by `admit`, against the stored roster snapshot it
 * reads for itself, the projects that snapshot listed, and the facts Luke
 * remembers, and only the validated action it mints reaches what carries it
 * — the facts table for a memory, the cloud action execution for a session
 * or a workspace, which admits it once more against the same snapshot before
 * the provider's documented endpoint sees it. Nothing here reaches a
 * machine: an open, an app action, and an issue action have no performer on
 * the service and the tool policy offers none of them, so a call that still
 * names one is refused before admission runs.
 */

/** The facts as an action reaches them: remember answers whether the words now stand, forget whether the entry is gone. */
export interface HostedFactsWriter {
  list(): Promise<readonly RememberedFact[]>;
  remember(ask: { id: string; words: string; replaces?: string }): Promise<boolean>;
  forget(id: string): Promise<boolean>;
}

/** One session action carried to its provider through the service's own execution, admitted there again. */
export type CloudActionExecutor = (input: {
  kind: HostedSessionActionKind;
  providerId: CloudAgentProviderId;
  fields: WireRecord;
  apiKey: string;
}) => Promise<ActionExecutionAnswer>;

export interface HostedPerformerDependencies {
  /** The roster as the snapshot holds it now, read again for every action. */
  roster: () => Promise<HostedRoster>;
  defaults: () => Promise<HostedWorkspaceDefaults>;
  facts: HostedFactsWriter;
  /** The account's stored key for a provider, decrypted; nothing where none is stored. */
  apiKey: (providerId: CloudAgentProviderId) => Promise<string | undefined>;
  execute: CloudActionExecutor;
  /** Records the ask a carried session action was, so the Conversation holds it. */
  recordLine: (entry: ConversationEntry) => Promise<void>;
}

const REFUSAL = {
  NO_EXECUTION: "Not run: an action needs the standing of a turn.",
  TURN_OVER: ACTION_REFUSAL.TURN_OVER,
  MEMORY_NOT_SAVED: "That memory could not be saved.",
  MEMORY_NOT_REMOVED: "That memory could not be removed.",
  NOT_HERE: "Not run: this action reaches a machine, and the service has none.",
  NO_KEY: "No provider key is stored for that session's provider.",
  NOT_CLOUD: "Not run: that session's provider is not one the service reaches.",
  UNREADABLE_CALL: "Not run: the call's arguments are not a record.",
} as const;

function rejection(reason: string): WireRecord {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason };
}

function isExecution(
  execution: BrainActionExecution | undefined,
): execution is BrainActionExecution {
  return (
    execution !== undefined &&
    execution !== null &&
    isWireString(execution.runId) &&
    execution.runId.length > 0 &&
    isRunOrigin(execution.origin) &&
    execution.isRevoked instanceof Function &&
    execution.signal instanceof AbortSignal
  );
}

function parsedArguments(call: RealtimeFunctionCall): WireRecord | undefined {
  try {
    // SAFETY: JSON.parse returns unknown; isRecord below validates the shape.
    const parsed = JSON.parse(call.argumentsJson) as UnparsedWireValue;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function fromExecution(executed: ActionExecutionAnswer): WireRecord {
  return {
    status: executed.result,
    ...(executed.reason ? { reason: executed.reason } : undefined),
    ...(executed.providerSessionId
      ? { provider_session_id: executed.providerSessionId }
      : undefined),
  };
}

export function hostedActionPerformer(
  dependencies: HostedPerformerDependencies,
): BrainActionPerformer {
  const admissionContext = async (execution: BrainActionExecution): Promise<AdmitContext> => {
    // The roster and the projects an action is admitted against are two
    // readings of one snapshot, read once per action so a session that left
    // between the turn's opening and the call is refused rather than written to.
    let read: Promise<HostedRoster> | undefined;
    const roster = () => (read ??= dependencies.roster());
    return {
      origin: execution.origin,
      guard: execution,
      roster: { read: async () => (await roster()).sessions },
      projects: {
        read: async () => (await roster()).projects,
        defaults: () => dependencies.defaults(),
        agentModels: workspaceAgentModels,
      },
      rememberedFacts: await dependencies.facts.list(),
    };
  };

  const carrySessionAction = async (
    action: ValidatedAction<SessionActionKind>,
    kind: HostedSessionActionKind,
    fields: WireRecord,
    execution: BrainActionExecution,
  ): Promise<WireRecord> => {
    const providerId = "identity" in action ? action.identity.providerId : action.providerId;
    if (!isCloudAgentProviderId(providerId)) return rejection(REFUSAL.NOT_CLOUD);
    const apiKey = await dependencies.apiKey(providerId);
    if (execution.isRevoked()) return rejection(REFUSAL.TURN_OVER);
    if (!apiKey) return rejection(REFUSAL.NO_KEY);
    // The ask is recorded before the outcome is known: a refusal still leaves
    // the developer having asked it, or Luke having judged it worth doing.
    await dependencies.recordLine(
      sessionActionConversationEntry(
        action,
        (await dependencies.roster()).sessions,
        execution.origin === RUN_ORIGIN.USER
          ? CONVERSATION_ENTRY_KIND.ACTION
          : CONVERSATION_ENTRY_KIND.OWN_ACTION,
      ),
    );
    return fromExecution(await dependencies.execute({ kind, providerId, fields, apiKey }));
  };

  return {
    async perform(call, execution) {
      if (!isExecution(execution)) return rejection(REFUSAL.NO_EXECUTION);
      if (execution.isRevoked()) return rejection(REFUSAL.TURN_OVER);
      const fields = parsedArguments(call);
      if (!fields) return rejection(REFUSAL.UNREADABLE_CALL);
      const admitted = await toolAction(call, await admissionContext(execution));
      if (admitted.kind === undefined) return rejection(admitted.reason);
      if (execution.isRevoked()) return rejection(REFUSAL.TURN_OVER);
      return dispatchByKind(admitted, {
        [ACTION_KIND.REMEMBER]: async (action) =>
          (await dependencies.facts.remember({
            id: randomUUID(),
            words: action.words,
            ...(action.replaces !== undefined ? { replaces: action.replaces } : undefined),
          }))
            ? { status: ACTION_RESULT_STATUS.ACCEPTED }
            : rejection(REFUSAL.MEMORY_NOT_SAVED),
        [ACTION_KIND.FORGET]: async (action) =>
          (await dependencies.facts.forget(action.id))
            ? { status: ACTION_RESULT_STATUS.ACCEPTED }
            : rejection(REFUSAL.MEMORY_NOT_REMOVED),
        [ACTION_KIND.MESSAGE]: (action) =>
          carrySessionAction(action, ACTION_KIND.MESSAGE, fields, execution),
        [ACTION_KIND.CONTROL]: (action) =>
          carrySessionAction(action, ACTION_KIND.CONTROL, fields, execution),
        [ACTION_KIND.CREATE_WORKSPACE]: (action) =>
          carrySessionAction(action, ACTION_KIND.CREATE_WORKSPACE, fields, execution),
        [ACTION_KIND.ADD_AGENT]: (action) =>
          carrySessionAction(action, ACTION_KIND.ADD_AGENT, fields, execution),
        [ACTION_KIND.RENAME_WORKSPACE]: (action) =>
          carrySessionAction(action, ACTION_KIND.RENAME_WORKSPACE, fields, execution),
        [ACTION_KIND.RENAME_SESSION]: (action) =>
          carrySessionAction(action, ACTION_KIND.RENAME_SESSION, fields, execution),
        [ACTION_KIND.OPEN]: async () => rejection(REFUSAL.NOT_HERE),
        [ACTION_KIND.SETTING]: async () => rejection(REFUSAL.NOT_HERE),
        [ACTION_KIND.PANEL]: async () => rejection(REFUSAL.NOT_HERE),
        [ACTION_KIND.FEEDBACK]: async () => rejection(REFUSAL.NOT_HERE),
        [ACTION_KIND.UPDATE]: async () => rejection(REFUSAL.NOT_HERE),
        [ACTION_KIND.ISSUE_STATE]: async () => rejection(REFUSAL.NOT_HERE),
        [ACTION_KIND.ISSUE_COMMENT]: async () => rejection(REFUSAL.NOT_HERE),
      });
    },
  };
}
