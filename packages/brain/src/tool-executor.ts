import {
  ACTION_OUTPUT,
  ACTION_REFUSAL,
  actionToolFamily,
  refusedActionOutput,
  unknownActionOutput,
} from "@sidecar/actions";
import {
  type EffectiveToolPolicy,
  type ForkSnapshot,
  TOOL_EFFECT,
  TOOL_EXECUTION,
  TOOL_POLICY_LAYER,
  type ToolDescriptor,
} from "@sidecar/runtime";
import {
  type ContextEngine,
  type MemoryDefinition,
  memoryToolNamed,
  type ToolExecutionContext,
  type ToolExecutor,
  type ToolInvocation,
} from "@sidecar/runtime/vocabulary";
import type { SessionIdentity } from "@sidecar/session";
import { ACTION_RESULT_STATUS, UNKNOWN_ACTION_STATUS, type WireRecord } from "@sidecar/wire";
import { estimateTokens } from "./compaction.js";
import { UNCONFIRMED_ACTION_RESULT, UNKNOWN_ACTION_RESULT } from "./journal.js";
import type { BrainActionExecution, BrainActionPerformer, BrainRoster } from "./performer.js";
import { answer } from "./tool-results.js";
import { actionToolNamed } from "./tools/action-tools.js";
import { ANNOUNCE_TOOL } from "./tools/announce-tool.js";
import { BRAIN_TOOL } from "./tools/names.js";
import { readToolNamed } from "./tools/read-tools.js";
import { parsedRecord, rejection } from "./tools/records.js";
import { REFUSAL_REASON } from "./tools/refusals.js";
import { type BrainChildAccess, sessionToolNamed } from "./tools/session-tools.js";
import { toolArguments } from "./tools/tool-module.js";
import { type BrainWorkspaceAccess, workspaceToolNamed } from "./tools/workspace-tools.js";
import type { RunControl, TurnContext } from "./turn.js";
import type { BrainDelivery } from "./wake-events.js";

export type { BrainChildAccess } from "./tools/session-tools.js";
export type { BrainWorkspaceAccess } from "./tools/workspace-tools.js";

/**
 * The tool executor one turn hands its runtime. Every call the model emits
 * lands here, is refused when the effective policy does not offer it, and is
 * otherwise dispatched to its module by what the catalog says the tool is:
 * an action tool's module run through the journal, a workspace module with
 * the journal in its context for its one write, a memory provider's read, or
 * one of the brain's own — the reads, the briefing, delegation. The policy is
 * enforced again at this door, whatever the model was shown, and the
 * runtime's own standing joins the turn's: an action prepared inside a run
 * the runtime has ended is refused. What each module is handed is its own
 * context and nothing wider, so the briefing's module has no carrier to
 * reach and a read module no journal to write.
 */

/** A context as a fork would take it: its items and their estimated size, or nothing when it holds none. */
function forkSnapshotOf(context: ContextEngine): ForkSnapshot | undefined {
  const items = context.checkpoint().items;
  if (items.length === 0) return undefined;
  return { items, estimatedTokens: estimateTokens(items) };
}

/** What the agent lends the executor: its reads, its performer, its journal's checkpoint, and its clock. */
export interface ToolExecutorDependencies {
  readonly roster: () => BrainRoster;
  readonly actions: BrainActionPerformer;
  readonly workspace: BrainWorkspaceAccess | undefined;
  /** Delegation, when the host wired it; absent, the session tools refuse. */
  readonly children: BrainChildAccess | undefined;
  /** The memory provider bound to this conversation's scope, when the host wired one; absent, the memory tools refuse. */
  readonly memory: MemoryDefinition | undefined;
  readonly readWhole: (identity: SessionIdentity, context: TurnContext) => Promise<WireRecord>;
  /** Checkpoints the turn's context and journal; false when the store refused, after which no action may run. */
  readonly checkpoint: (context: TurnContext) => Promise<boolean>;
  readonly runRevoked: (run: RunControl) => boolean;
  readonly now: () => number;
}

/** The one turn an executor serves. */
export interface ToolExecutorTurn {
  readonly policy: EffectiveToolPolicy;
  readonly context: TurnContext;
  readonly execution: BrainActionExecution;
  /** A briefing the model decided to give, handed to the turn to deliver once its context is kept. */
  readonly onBriefing: (delivery: BrainDelivery) => void;
}

/** Whether a tool's call goes through the journal as an effect: every write, and every action the performer carries. */
export function journaledEffect(policy: EffectiveToolPolicy, name: string): boolean {
  const tool = policy.allowed.find((candidate) => candidate.schema.name === name);
  return (
    tool !== undefined &&
    (tool.effect === TOOL_EFFECT.WRITE || tool.execution === TOOL_EXECUTION.PERFORMER)
  );
}

/**
 * How a kind of tool spells the two answers the executor itself gives: a
 * refusal at the door, and a result it cannot vouch for. An action tool
 * answers in the envelope every action tool shares, whoever wrote the answer;
 * every other tool answers the bare record it always has.
 */
interface ExecutorOutcomes {
  readonly refuse: (reason: string) => WireRecord;
  readonly unknown: (reason: string) => WireRecord;
}

const RECORD_OUTCOMES: ExecutorOutcomes = {
  refuse: rejection,
  unknown: (reason) => ({ status: UNKNOWN_ACTION_STATUS, reason }),
};

const ACTION_OUTCOMES: ExecutorOutcomes = {
  refuse: refusedActionOutput,
  unknown: unknownActionOutput,
};

function outcomesFor(name: string): ExecutorOutcomes {
  return actionToolFamily(name) !== undefined ? ACTION_OUTCOMES : RECORD_OUTCOMES;
}

/**
 * Why the policy refuses a call, from the policy's own answer: a name the
 * catalog never held, the briefing channel withheld by the turn's own layer
 * because the reply is the speech, or a tool a configured layer removed.
 */
export function refusalForPolicy(
  policy: EffectiveToolPolicy,
  name: string,
): WireRecord | undefined {
  if (policy.allows(name)) return undefined;
  const { refuse } = outcomesFor(name);
  const layer = policy.deniedBy(name);
  if (layer === undefined) return refuse(REFUSAL_REASON.NOT_OFFERED);
  if (layer === TOOL_POLICY_LAYER.TURN && name === BRAIN_TOOL.ANNOUNCE) {
    return refuse(REFUSAL_REASON.ANNOUNCE_IN_ASK);
  }
  return refuse(REFUSAL_REASON.NOT_ALLOWED);
}

export function createTurnToolExecutor(
  dependencies: ToolExecutorDependencies,
  turn: ToolExecutorTurn,
): ToolExecutor {
  const { policy, context } = turn;
  const descriptors = new Map<string, ToolDescriptor>(
    policy.allowed.map((tool) => [tool.schema.name, tool]),
  );

  /**
   * One effect through the journal. A call id the run already answered gets its
   * recorded result back rather than a second effect — or the honest
   * unknown, when the action started and its result was lost — and the same id
   * with other arguments is refused rather than guessed at. A fresh call is
   * written as started and checkpointed before the effect runs, so a crash
   * mid-action is found as an action of unknown result and never replayed; a
   * checkpoint that will not land refuses the action instead, because an action
   * nobody could find afterwards is one the developer could not account
   * for. An effect that throws after dispatch has answered nothing about
   * itself: the outcome is unknown, counted as such, and never a refusal.
   */
  const performJournaled = async (
    call: ToolInvocation,
    execution: BrainActionExecution,
    effect: () => Promise<WireRecord>,
  ): Promise<WireRecord> => {
    const { run, generation } = context;
    const outcomes = outcomesFor(call.name);
    if (dependencies.runRevoked(run) || execution.isRevoked()) {
      return outcomes.refuse(REFUSAL_REASON.RUN_REVOKED);
    }
    const recorded = generation.journal.get(run.runId, call.callId);
    if (recorded) {
      if (recorded.argumentsJson !== call.argumentsJson) {
        return outcomes.refuse(REFUSAL_REASON.CALL_ID_REUSED);
      }
      return recorded.outputJson === undefined
        ? outcomes.unknown(UNKNOWN_ACTION_RESULT.reason)
        : parsedRecord(recorded.outputJson);
    }
    if (run.checkpointFailed) return outcomes.refuse(REFUSAL_REASON.NOT_CHECKPOINTED);
    generation.journal.start({
      runId: run.runId,
      callId: call.callId,
      name: call.name,
      argumentsJson: call.argumentsJson,
      startedAt: dependencies.now(),
    });
    if (!(await dependencies.checkpoint(context))) {
      generation.journal.forget(run.runId, call.callId);
      run.checkpointFailed = true;
      return outcomes.refuse(REFUSAL_REASON.NOT_CHECKPOINTED);
    }
    let output: WireRecord;
    try {
      output = await effect();
    } catch {
      output = outcomes.unknown(UNCONFIRMED_ACTION_RESULT.reason);
    }
    if (output.status === ACTION_RESULT_STATUS.ACCEPTED) run.performedActions += 1;
    if (output.status === UNKNOWN_ACTION_STATUS) run.unknownActions += 1;
    generation.journal.settle(run.runId, call.callId, JSON.stringify(output), dependencies.now());
    return output;
  };

  /**
   * A memory provider's tool: a write through the same journal an action runs
   * through, a read answered directly. The provider is handed the turn's
   * standing and the scope it was bound to, and bounds the call's arguments
   * itself; a conversation with no provider refuses the tools.
   */
  const memoryTool = async (
    call: ToolInvocation,
    input: WireRecord,
    execution: BrainActionExecution,
  ): Promise<WireRecord> => {
    const memory = dependencies.memory;
    const tool = memory ? memoryToolNamed(memory.provider, call.name) : undefined;
    if (!memory || !tool) return rejection(REFUSAL_REASON.NO_MEMORY);
    const run = () => tool.execute(input, { ...execution, scope: memory.scope });
    if (tool.effect === TOOL_EFFECT.WRITE) return performJournaled(call, execution, run);
    if (execution.isRevoked()) return rejection(REFUSAL_REASON.RUN_REVOKED);
    return run();
  };

  /** One of the brain's own modules under the context its kind takes: the reads, the briefing, delegation. */
  const brainTool = async (
    call: ToolInvocation,
    input: WireRecord,
    execution: BrainActionExecution,
  ): Promise<WireRecord> => {
    const read = readToolNamed(call.name);
    if (read) {
      const roster = dependencies.roster();
      return read.execute(input, {
        ...execution,
        roster: { text: roster.text, identities: roster.identities },
        readTranscript: (identity) => dependencies.readWhole(identity, context),
      });
    }
    if (call.name === ANNOUNCE_TOOL.name) {
      return ANNOUNCE_TOOL.execute(input, {
        ...execution,
        announce: (briefing) => turn.onBriefing({ briefing, decidedAt: dependencies.now() }),
      });
    }
    const session = sessionToolNamed(call.name);
    if (session) {
      return session.execute(input, {
        ...execution,
        children: dependencies.children,
        policy: {
          allowed: policy.allowed.map((tool) => tool.schema.name),
          denied: policy.denied.map((denial) => denial.tool),
        },
        fork: () => forkSnapshotOf(context.context),
        journal: (effect) => performJournaled(call, execution, effect),
      });
    }
    return rejection(REFUSAL_REASON.NOT_OFFERED);
  };

  return {
    execute: async (call: ToolInvocation, runtimeContext: ToolExecutionContext) => {
      const refused = refusalForPolicy(policy, call.name);
      if (refused) return answer(refused);
      const execution: BrainActionExecution = {
        ...turn.execution,
        isRevoked: () => turn.execution.isRevoked() || runtimeContext.isRevoked(),
      };
      const tool = descriptors.get(call.name);
      if (tool?.execution === TOOL_EXECUTION.PERFORMER) {
        const actionTool = actionToolNamed(call.name);
        if (!actionTool) return answer(refusedActionOutput(REFUSAL_REASON.NOT_OFFERED));
        // The module runs inside the journal: admission, then the carrier,
        // whose answer is validated before the journal keeps it. One this
        // build cannot read is answered unknown: the action was dispatched,
        // and what became of it is exactly what could not be read.
        return answer(
          await performJournaled(call, execution, async () => {
            const input = toolArguments(call.argumentsJson);
            if (input === undefined) return refusedActionOutput(ACTION_REFUSAL.UNREADABLE);
            return actionTool.execute(input, {
              ...execution,
              admission: dependencies.actions.admission(execution),
              carry: async (action) =>
                ACTION_OUTPUT.parse(await dependencies.actions.carry(action, execution)) ??
                unknownActionOutput(REFUSAL_REASON.UNREADABLE_ANSWER),
            });
          }),
        );
      }
      // The brain's own modules read their arguments themselves and refuse
      // what is not the shape they take; a call that is not a record at all
      // reads as no arguments, as it always has.
      const input = toolArguments(call.argumentsJson) ?? {};
      if (tool?.execution === TOOL_EXECUTION.WORKSPACE) {
        const workspaceTool = workspaceToolNamed(call.name);
        if (!workspaceTool) return answer(rejection(REFUSAL_REASON.NOT_OFFERED));
        return answer(
          await workspaceTool.execute(input, {
            ...execution,
            workspace: dependencies.workspace,
            journal: (effect) => performJournaled(call, execution, effect),
          }),
        );
      }
      if (tool?.execution === TOOL_EXECUTION.MEMORY) {
        return answer(await memoryTool(call, input, execution));
      }
      return answer(await brainTool(call, input, execution));
    },
  };
}
