import type { NotebookMemoryAccess } from "@sidecar/memory";
import {
  type ChildCancellation,
  type ChildSpawnOutcome,
  type EffectiveToolPolicy,
  type ForkSnapshot,
  type SkillLoad,
  TOOL_EFFECT,
  TOOL_EXECUTION,
  TOOL_POLICY_LAYER,
  type ToolDescriptor,
  type WorkspaceReadResult,
  type WorkspaceWriteResult,
} from "@sidecar/runtime";
import {
  type ChildCleanup,
  type ChildCompletionRecord,
  type ChildContextMode,
  type ChildPolicyMetadata,
  type ChildRunRecord,
  type ContextEngine,
  type ConversationRecord,
  isChildCleanup,
  isChildContextMode,
  type SessionKey,
  type ToolExecutionContext,
  type ToolExecutor,
  type ToolInvocation,
} from "@sidecar/runtime/vocabulary";
import type { SessionIdentity } from "@sidecar/session";
import {
  ACT_RESULT_STATUS,
  isWireBoolean,
  isWireNumber,
  isWireString,
  text,
  type WireRecord,
} from "@sidecar/wire";
import { estimateTokens } from "./compaction.js";
import { identityFromRecord, parsedRecord, rejection, sameIdentity } from "./generation.js";
import {
  childSpawnReceiptRecord,
  childSummaryRecord,
  conversationListingRecord,
} from "./input-items.js";
import { UNCONFIRMED_ACT_RESULT, UNKNOWN_ACT_RESULT } from "./journal.js";
import type { BrainActExecution, BrainActPerformer, BrainRoster } from "./performer.js";
import { answer } from "./tool-results.js";
import {
  BRAIN_TOOL,
  isBrainOnlyTool,
  maximumBriefingLength,
  maximumChildTaskLength,
  maximumMemoryQueryLength,
  maximumMemorySearchResults,
  maximumSessionsHistoryLines,
} from "./tools.js";
import { REFUSAL_REASON, type RunControl, SPAWN_REFUSAL_REASON, type TurnContext } from "./turn.js";
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

/** How the memory tools reach the notebook's index: the memory host's own access, bounded and validated by the host that supplies it. */
export type BrainMemoryAccess = NotebookMemoryAccess;

/** How the workspace tools reach the agent's own files: bounded to the workspace by the host that supplies it. */
export interface BrainWorkspaceAccess {
  read(name: string): Promise<WorkspaceReadResult>;
  write(name: string, content: string): Promise<WorkspaceWriteResult>;
  loadSkill(location: string): Promise<SkillLoad>;
}

/** One spawn as the agent asks it of the host, already bounded and validated from the model's call. */
export interface BrainChildSpawnAsk {
  readonly task: string;
  readonly label?: string;
  readonly context?: ChildContextMode;
  readonly cleanup?: ChildCleanup;
  readonly timeoutMs?: number;
  readonly expectsCompletion?: boolean;
  /** The run the spawn was called in, for the child's record. */
  readonly requesterRunId: string;
  /** The effective policy of the turn that spawned, as names, for the child's record. */
  readonly policy: ChildPolicyMetadata;
  /** This conversation's active context, taken only if the host decides on a fork. */
  readonly fork: () => ForkSnapshot | undefined;
}

/** One child as the host lists it: its record and, once it has ended, its completion. */
export interface BrainChildListing {
  readonly record: ChildRunRecord;
  readonly completion: ChildCompletionRecord | undefined;
}

/**
 * How the session tools reach delegation: the host owns the conversations,
 * the child service, and the directory, and answers each in its own typed
 * terms; the records the model reads are built here. The agent validates the
 * call's arguments and its own standing; the host validates ownership — a
 * child named here must be this conversation's, and one that is not is
 * answered with nothing — and everything after.
 */
export interface BrainChildAccess {
  /** The conversation these tools belong to, which the listing marks current. */
  readonly sessionKey: SessionKey;
  spawn(ask: BrainChildSpawnAsk): Promise<ChildSpawnOutcome>;
  list(): Promise<readonly BrainChildListing[]>;
  /** Cancels one of this conversation's children and its descendants; nothing for a child that is not its own. */
  cancel(childId: string): Promise<ChildCancellation | undefined>;
  conversations(): Promise<readonly ConversationRecord[]>;
  /** One of this conversation's children's history lines, most recent last; nothing for a child that is not its own. */
  history(childId: string, limit: number): Promise<readonly string[] | undefined>;
}

/** A spawn's outcome as the model reads it: the receipt, or the refusal's sentence with the service's detail. */
function spawnOutcomeRecord(outcome: ChildSpawnOutcome): WireRecord {
  if (outcome.accepted) return childSpawnReceiptRecord(outcome.receipt);
  const words = SPAWN_REFUSAL_REASON[outcome.reason];
  return rejection(outcome.detail ? `${words}: ${outcome.detail}` : words);
}

function cancellationRecord(childId: string, cancelled: ChildCancellation): WireRecord {
  if (cancelled.ok) return { status: ACT_RESULT_STATUS.ACCEPTED, cancelled: [childId] };
  return rejection(`not every child could be cancelled: ${cancelled.remaining.join(", ")}`);
}

/** A context as a fork would take it: its items and their estimated size, or nothing when it holds none. */
function forkSnapshotOf(context: ContextEngine): ForkSnapshot | undefined {
  const items = context.checkpoint().items;
  if (items.length === 0) return undefined;
  return { items, estimatedTokens: estimateTokens(items) };
}

/** What the agent lends the executor: its reads, its performer, its journal's checkpoint, and its clock. */
export interface ToolExecutorDependencies {
  readonly roster: () => BrainRoster;
  readonly acts: BrainActPerformer;
  readonly workspace: BrainWorkspaceAccess | undefined;
  /** Delegation, when the host wired it; absent, the session tools refuse. */
  readonly children: BrainChildAccess | undefined;
  /** The notebook's search and read, when the host wired an index; absent, the memory tools refuse. */
  readonly memory: BrainMemoryAccess | undefined;
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
  const tool = policy.allowed.find((candidate) => candidate.schema.name === name);
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

/**
 * The memory tools: reads of the notebook's index and files, bounded here
 * and validated by the host, which answers only for paths inside the
 * notebook. Neither is an effect, so neither runs through the journal.
 */
export async function memoryToolCall(
  call: Pick<ToolInvocation, "name">,
  args: WireRecord,
  memory: BrainMemoryAccess,
  execution: Pick<BrainActExecution, "isRevoked" | "signal">,
): Promise<WireRecord> {
  if (execution.isRevoked()) return rejection(REFUSAL_REASON.RUN_REVOKED);
  if (call.name === BRAIN_TOOL.MEMORY_SEARCH) {
    const query = text(args.query)?.replace(/\s+/g, " ").trim().slice(0, maximumMemoryQueryLength);
    if (!query) return rejection(REFUSAL_REASON.EMPTY_QUERY);
    const maxResults =
      isWireNumber(args.max_results) && args.max_results > 0
        ? Math.min(Math.floor(args.max_results), maximumMemorySearchResults)
        : undefined;
    return memory.search({
      query,
      ...(maxResults !== undefined ? { maxResults } : undefined),
      signal: execution.signal,
    });
  }
  const filePath = text(args.path)?.trim();
  if (!filePath) return rejection(REFUSAL_REASON.NOT_MEMORY_PATH);
  const from = isWireNumber(args.from) && args.from >= 1 ? Math.floor(args.from) : undefined;
  const lines = isWireNumber(args.lines) && args.lines >= 1 ? Math.floor(args.lines) : undefined;
  return memory.get({
    path: filePath,
    ...(from !== undefined ? { from } : undefined),
    ...(lines !== undefined ? { lines } : undefined),
  });
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

  /**
   * The session tools, through the host's delegation. A spawn and a cancel
   * are effects and run through the journal — recorded before the child
   * service hears them, so a crash mid-spawn is found as an act of unknown
   * result and the same call id answers the same receipt — while the list
   * and the history are reads. Arguments are bounded and validated here;
   * whose child a name is, the host decides.
   */
  const childTool = async (
    call: ToolInvocation,
    args: WireRecord,
    execution: BrainActExecution,
  ): Promise<WireRecord> => {
    const children = dependencies.children;
    if (!children) return rejection(REFUSAL_REASON.NO_CHILDREN);
    if (execution.isRevoked()) return rejection(REFUSAL_REASON.RUN_REVOKED);
    switch (call.name) {
      case BRAIN_TOOL.SESSIONS_SPAWN: {
        const task = text(args.task)?.trim().slice(0, maximumChildTaskLength);
        if (!task) return rejection(REFUSAL_REASON.EMPTY_TASK);
        const label = text(args.label)?.trim();
        const seconds = args.run_timeout_seconds;
        const timeoutMs =
          isWireNumber(seconds) && Number.isInteger(seconds) && seconds >= 0
            ? seconds * 1000
            : undefined;
        const ask: BrainChildSpawnAsk = {
          task,
          ...(label ? { label } : undefined),
          ...(isChildContextMode(args.context) ? { context: args.context } : undefined),
          ...(isChildCleanup(args.cleanup) ? { cleanup: args.cleanup } : undefined),
          ...(timeoutMs !== undefined ? { timeoutMs } : undefined),
          ...(isWireBoolean(args.expects_completion)
            ? { expectsCompletion: args.expects_completion }
            : undefined),
          requesterRunId: context.run.runId,
          policy: {
            allowed: policy.allowed.map((tool) => tool.schema.name),
            denied: policy.denied.map((denial) => denial.tool),
          },
          fork: () => forkSnapshotOf(context.context),
        };
        return performJournaled(call, execution, async () =>
          spawnOutcomeRecord(await children.spawn(ask)),
        );
      }
      case BRAIN_TOOL.SUBAGENTS: {
        if (args.action === "cancel") {
          const childId = text(args.child_id);
          if (!childId) return rejection(REFUSAL_REASON.NOT_OWN_CHILD);
          return performJournaled(call, execution, async () => {
            const cancelled = await children.cancel(childId);
            return cancelled
              ? cancellationRecord(childId, cancelled)
              : rejection(REFUSAL_REASON.UNKNOWN_CHILD);
          });
        }
        return {
          status: ACT_RESULT_STATUS.ACCEPTED,
          children: (await children.list()).map(({ record, completion }) =>
            childSummaryRecord(record, completion),
          ),
        };
      }
      case BRAIN_TOOL.SESSIONS_LIST:
        return conversationListingRecord(await children.conversations(), children.sessionKey);
      case BRAIN_TOOL.SESSIONS_HISTORY: {
        const childId = text(args.child_id);
        if (!childId) return rejection(REFUSAL_REASON.NOT_OWN_CHILD);
        const limit =
          isWireNumber(args.limit) && args.limit > 0
            ? Math.min(Math.floor(args.limit), maximumSessionsHistoryLines)
            : maximumSessionsHistoryLines;
        const lines = await children.history(childId, limit);
        if (!lines) return rejection(REFUSAL_REASON.UNKNOWN_CHILD);
        return { status: ACT_RESULT_STATUS.ACCEPTED, lines: [...lines] };
      }
      default:
        return rejection(REFUSAL_REASON.NOT_OFFERED);
    }
  };

  const memoryTool = (call: ToolInvocation, args: WireRecord, execution: BrainActExecution) =>
    dependencies.memory
      ? memoryToolCall(call, args, dependencies.memory, execution)
      : rejection(REFUSAL_REASON.NO_MEMORY);

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
        case BRAIN_TOOL.SESSIONS_SPAWN:
        case BRAIN_TOOL.SUBAGENTS:
        case BRAIN_TOOL.SESSIONS_LIST:
        case BRAIN_TOOL.SESSIONS_HISTORY:
          return answer(await childTool(call, args, execution));
        case BRAIN_TOOL.MEMORY_SEARCH:
        case BRAIN_TOOL.MEMORY_GET:
          return answer(await memoryTool(call, args, execution));
        default:
          return answer(rejection(REFUSAL_REASON.NOT_OFFERED));
      }
    },
  };
}
