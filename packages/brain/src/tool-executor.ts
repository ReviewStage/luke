import {
  type EffectiveToolPolicy,
  type SkillLoad,
  TOOL_EFFECT,
  TOOL_EXECUTION,
  TOOL_POLICY_LAYER,
  type ToolDescriptor,
  type WorkspaceReadResult,
  type WorkspaceWriteResult,
} from "@sidecar/runtime";
import type {
  ToolExecutionContext,
  ToolExecutor,
  ToolInvocation,
  ToolResult,
} from "@sidecar/runtime-contracts";
import type { SessionIdentity } from "@sidecar/session";
import { ACT_RESULT_STATUS, isWireString, text, type WireRecord } from "@sidecar/wire";
import { identityFromRecord, parsedRecord, rejection, sameIdentity } from "./generation.js";
import { UNCONFIRMED_ACT_RESULT, UNKNOWN_ACT_RESULT } from "./journal.js";
import type { BrainActExecution, BrainActPerformer, BrainRoster } from "./performer.js";
import { BRAIN_TOOL, isBrainOnlyTool, maximumBriefingLength } from "./tools.js";
import { REFUSAL_REASON, type RunControl, type TurnContext } from "./turn.js";
import type { BrainDelivery } from "./wake-events.js";

/**
 * The tool executor one turn hands its runtime. Every call the model emits
 * lands here, is refused when the effective policy does not offer it, and is
 * otherwise dispatched by what the catalog says the tool is: an act carried
 * through the journal to the performer, a workspace file's read or write, or
 * one of the brain's own — the roster in full, a whole transcript, the
 * briefing it decided to give. The policy is enforced again at this door,
 * whatever the model was shown, and the runtime's own standing joins the
 * turn's: an act prepared inside a run the runtime has ended is refused.
 */

/** How the workspace tools reach the agent's own files: bounded to the workspace by the host that supplies it. */
export interface BrainWorkspaceAccess {
  read(name: string): Promise<WorkspaceReadResult>;
  write(name: string, content: string): Promise<WorkspaceWriteResult>;
  loadSkill(location: string): Promise<SkillLoad>;
}

/** What the agent lends the executor: its reads, its performer, its journal's checkpoint, and its clock. */
export interface ToolExecutorDependencies {
  readonly roster: () => BrainRoster;
  readonly acts: BrainActPerformer;
  readonly workspace: BrainWorkspaceAccess | undefined;
  readonly readWhole: (identity: SessionIdentity, context: TurnContext) => Promise<WireRecord>;
  /** Checkpoints the turn's context and journal; false when the store refused, after which no act may run. */
  readonly checkpoint: (context: TurnContext) => Promise<boolean>;
  readonly runRevoked: (run: RunControl) => boolean;
  readonly now: () => number;
}

/** The one turn an executor serves. */
export interface ToolExecutorTurn {
  readonly policy: EffectiveToolPolicy;
  readonly context: TurnContext;
  readonly execution: BrainActExecution;
  /** A briefing the model decided to give, handed to the turn to deliver once its context is kept. */
  readonly onBriefing: (delivery: BrainDelivery) => void;
}

/** Whether a tool's call goes through the journal as an effect: every write, and every act the performer carries. */
export function journaledEffect(policy: EffectiveToolPolicy, name: string): boolean {
  const tool = policy.allowed.find((candidate) => candidate.id === name);
  return (
    tool !== undefined &&
    (tool.effect === TOOL_EFFECT.WRITE || tool.execution === TOOL_EXECUTION.PERFORMER)
  );
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
  const layer = policy.deniedBy(name);
  if (layer === undefined) return rejection(REFUSAL_REASON.NOT_OFFERED);
  if (layer === TOOL_POLICY_LAYER.TURN && name === BRAIN_TOOL.ANNOUNCE) {
    return rejection(REFUSAL_REASON.ANNOUNCE_IN_ASK);
  }
  return rejection(REFUSAL_REASON.NOT_ALLOWED);
}

function answer(output: WireRecord): ToolResult {
  const status = text(output.status);
  return { outputJson: JSON.stringify(output), ...(status ? { status } : undefined) };
}

export function createTurnToolExecutor(
  dependencies: ToolExecutorDependencies,
  turn: ToolExecutorTurn,
): ToolExecutor {
  const { policy, context } = turn;
  const descriptors = new Map<string, ToolDescriptor>(
    policy.allowed.map((tool) => [tool.id, tool]),
  );

  /**
   * One act through the journal. A call id the run already answered gets its
   * recorded result back rather than a second effect — or the honest
   * unknown, when the act started and its result was lost — and the same id
   * with other arguments is refused rather than guessed at. A fresh call is
   * written as started and checkpointed before the effect runs, so a crash
   * mid-act is found as an act of unknown result and never replayed; a
   * checkpoint that will not land refuses the act instead, because an act
   * nobody could find afterwards is one the developer could not account
   * for. An effect that throws after dispatch has answered nothing about
   * itself: the outcome is unknown, counted as such, and never a refusal.
   */
  const performJournaled = async (
    call: ToolInvocation,
    execution: BrainActExecution,
    effect: () => Promise<WireRecord>,
  ): Promise<WireRecord> => {
    const { run, generation } = context;
    if (dependencies.runRevoked(run) || execution.isRevoked()) {
      return rejection(REFUSAL_REASON.RUN_REVOKED);
    }
    const recorded = generation.journal.get(run.runId, call.callId);
    if (recorded) {
      if (recorded.argumentsJson !== call.argumentsJson) {
        return rejection(REFUSAL_REASON.CALL_ID_REUSED);
      }
      return recorded.outputJson === undefined
        ? { ...UNKNOWN_ACT_RESULT }
        : parsedRecord(recorded.outputJson);
    }
    if (run.checkpointFailed) return rejection(REFUSAL_REASON.NOT_CHECKPOINTED);
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
      return rejection(REFUSAL_REASON.NOT_CHECKPOINTED);
    }
    let output: WireRecord;
    try {
      output = await effect();
    } catch {
      output = { ...UNCONFIRMED_ACT_RESULT };
    }
    if (output.status === ACT_RESULT_STATUS.ACCEPTED) run.performedActs += 1;
    if (output.status === UNCONFIRMED_ACT_RESULT.status) run.unknownActs += 1;
    generation.journal.settle(run.runId, call.callId, JSON.stringify(output), dependencies.now());
    return output;
  };

  /**
   * A workspace tool through the same journal an act runs through: the write
   * is recorded before it lands and its result before the model reads it,
   * and a read is answered directly. A call whose arguments are not the
   * strings the tool takes is refused before anything is journaled, never
   * filled in. The host's access is what bounds the names to the workspace;
   * a host with none refuses them all.
   */
  const workspaceTool = async (
    call: ToolInvocation,
    args: WireRecord,
    execution: BrainActExecution,
  ): Promise<WireRecord> => {
    const workspace = dependencies.workspace;
    if (!workspace) return rejection(REFUSAL_REASON.NO_WORKSPACE);
    if (execution.isRevoked()) return rejection(REFUSAL_REASON.RUN_REVOKED);
    switch (call.name) {
      case BRAIN_TOOL.READ_WORKSPACE_FILE: {
        if (!isWireString(args.name)) return rejection(REFUSAL_REASON.MALFORMED_ARGUMENTS);
        const read = await workspace.read(args.name);
        return read.ok
          ? { status: ACT_RESULT_STATUS.ACCEPTED, content: read.content }
          : rejection(read.reason);
      }
      case BRAIN_TOOL.LOAD_SKILL: {
        if (!isWireString(args.location)) return rejection(REFUSAL_REASON.MALFORMED_ARGUMENTS);
        const loaded = await workspace.loadSkill(args.location);
        return loaded.ok
          ? {
              status: ACT_RESULT_STATUS.ACCEPTED,
              instructions: loaded.instructions,
              truncated: loaded.truncated,
            }
          : rejection(loaded.reason);
      }
      case BRAIN_TOOL.WRITE_WORKSPACE_FILE: {
        const { name, content } = args;
        if (!isWireString(name) || !isWireString(content)) {
          return rejection(REFUSAL_REASON.MALFORMED_ARGUMENTS);
        }
        return performJournaled(call, execution, async () => {
          const written = await workspace.write(name, content);
          return written.ok
            ? { status: ACT_RESULT_STATUS.ACCEPTED, chars: written.chars }
            : rejection(written.reason);
        });
      }
      default:
        return rejection(REFUSAL_REASON.NOT_OFFERED);
    }
  };

  return {
    execute: async (call: ToolInvocation, runtimeContext: ToolExecutionContext) => {
      const refused = refusalForPolicy(policy, call.name);
      if (refused) return answer(refused);
      const roster = dependencies.roster();
      const args = parsedRecord(call.argumentsJson);
      const execution: BrainActExecution = {
        runId: turn.execution.runId,
        origin: turn.execution.origin,
        isRevoked: () => turn.execution.isRevoked() || runtimeContext.isRevoked(),
        signal: turn.execution.signal,
      };
      const tool = descriptors.get(call.name);
      if (tool?.execution === TOOL_EXECUTION.PERFORMER) {
        return answer(
          await performJournaled(call, execution, () =>
            dependencies.acts.perform(
              { name: call.name, argumentsJson: call.argumentsJson },
              execution,
            ),
          ),
        );
      }
      if (tool?.execution === TOOL_EXECUTION.WORKSPACE) {
        return answer(await workspaceTool(call, args, execution));
      }
      if (!isBrainOnlyTool(call.name)) return answer(rejection(REFUSAL_REASON.NOT_OFFERED));
      switch (call.name) {
        case BRAIN_TOOL.LIST_SESSIONS:
          return answer({ roster: roster.text });
        case BRAIN_TOOL.READ_TRANSCRIPT: {
          const named = identityFromRecord(args);
          const observed =
            named !== undefined && roster.identities.some((listed) => sameIdentity(listed, named));
          if (!named || !observed) return answer(rejection(REFUSAL_REASON.UNOBSERVED_SESSION));
          return answer(await dependencies.readWhole(named, context));
        }
        case BRAIN_TOOL.ANNOUNCE: {
          const briefing = text(args.briefing)?.slice(0, maximumBriefingLength);
          if (!briefing) return answer(rejection(REFUSAL_REASON.EMPTY_BRIEFING));
          turn.onBriefing({ briefing, decidedAt: dependencies.now() });
          return answer({ status: ACT_RESULT_STATUS.ACCEPTED });
        }
        default:
          return answer(rejection(REFUSAL_REASON.NOT_OFFERED));
      }
    },
  };
}
