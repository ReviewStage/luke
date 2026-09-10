import type { ChildCancellation, ChildSpawnOutcome, ForkSnapshot } from "@sidecar/runtime";
import {
  CHILD_CLEANUP,
  CHILD_CONTEXT_MODE,
  type ChildCleanup,
  type ChildCompletionRecord,
  type ChildContextMode,
  type ChildPolicyMetadata,
  type ChildRunRecord,
  type ChildSpawnReceipt,
  type ConversationRecord,
  isChildCleanup,
  isChildContextMode,
  type SessionKey,
} from "@sidecar/runtime/vocabulary";
import {
  ACTION_RESULT_STATUS,
  isWireBoolean,
  isWireNumber,
  RECORD_EXTRA_KEYS,
  s,
  text,
  type WireRecord,
} from "@sidecar/wire";
import { BRAIN_TOOL, maximumChildTaskLength, maximumSessionsConversationLines } from "./names.js";
import { rejection } from "./records.js";
import { REFUSAL_REASON, SPAWN_REFUSAL_REASON } from "./refusals.js";
import type { ToolContext, ToolModule } from "./tool-module.js";

/**
 * The session tools, OpenClaw's delegation and conversation inspection as
 * modules. The host owns the conversations, the child service, and the
 * directory, and answers each in its own typed terms through the access in
 * the context; the records the model reads are rendered here and nowhere
 * else. A module validates the call's arguments and its own standing; the
 * host validates ownership, so a child named here must be this
 * conversation's and one that is not is answered with nothing. A spawn and a
 * cancel are effects and run through the journal in the context, recorded
 * before the child service hears them, so a crash mid-spawn is found as an
 * action of unknown result and the same call id answers the same receipt;
 * the list and the history are reads.
 */

/** One spawn as the agent asks it of the host, already bounded and validated from the model's call. */
interface BrainChildSpawnAsk {
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
interface BrainChildListing {
  readonly record: ChildRunRecord;
  readonly completion: ChildCompletionRecord | undefined;
}

/**
 * How the session tools reach delegation: the host owns the conversations,
 * the child service, and the directory, and answers each in its own typed
 * terms.
 */
export interface BrainChildAccess {
  /** The conversation these tools belong to, which the listing marks current. */
  readonly sessionKey: SessionKey;
  spawn(ask: BrainChildSpawnAsk): Promise<ChildSpawnOutcome>;
  list(): Promise<readonly BrainChildListing[]>;
  /** Cancels one of this conversation's children and its descendants; nothing for a child that is not its own. */
  cancel(childId: string): Promise<ChildCancellation | undefined>;
  conversations(): Promise<readonly ConversationRecord[]>;
  /** One of this conversation's children's conversation lines, most recent last; nothing for a child that is not its own. */
  lines(childId: string, limit: number): Promise<readonly string[] | undefined>;
}

export interface SessionToolContext extends ToolContext {
  /** Delegation, when the host wired it; absent, every session tool refuses. */
  readonly children: BrainChildAccess | undefined;
  /** The effective policy of the turn, as names, for a child's record. */
  readonly policy: ChildPolicyMetadata;
  /** This conversation's active context as a fork would take it, read only if the host decides on one. */
  fork(): ForkSnapshot | undefined;
  /** Records an effect before it runs and its result before the model reads it; the executor's journal. */
  journal(effect: () => Promise<WireRecord>): Promise<WireRecord>;
}

export type SessionToolModule = ToolModule<WireRecord, SessionToolContext>;

const SUBAGENTS_ACTION = {
  LIST: "list",
  CANCEL: "cancel",
} as const;

const SESSIONS_SPAWN_INPUT = s.record(
  {
    task: s.text({
      description: `The task, briefed in full, under ${maximumChildTaskLength} characters.`,
    }),
    label: s.text({ description: "A short title for the work, for listings." }).optional(),
    context: s
      .enumOf(Object.values(CHILD_CONTEXT_MODE), {
        description: "How the child's context starts; isolated by default.",
      })
      .optional(),
    cleanup: s
      .enumOf(Object.values(CHILD_CLEANUP), {
        description:
          "Whether the child's conversation is kept for an hour after it ends (default) or archived at once.",
      })
      .optional(),
    run_timeout_seconds: s
      .wholeNumber({
        description:
          "A deadline for this child alone; 0, the default, means none beyond the ordinary run deadline.",
      })
      .optional(),
    expects_completion: s
      .boolean({
        description:
          "False for a fire-and-forget child whose end is not reported back; true by default.",
      })
      .optional(),
  },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);

const SUBAGENTS_INPUT = s.record(
  {
    action: s
      .enumOf(Object.values(SUBAGENTS_ACTION), { description: "What to do; list by default." })
      .optional(),
    child_id: s.text({ description: "The child to cancel, as the list gave it." }).optional(),
  },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);

const SESSIONS_LIST_INPUT = s.record({}, { extraKeys: RECORD_EXTRA_KEYS.IGNORE });

const SESSIONS_HISTORY_INPUT = s.record(
  {
    child_id: s.text({ description: "The child, as the subagents list gave it." }),
    limit: s.wholeNumber({ description: "How many lines at most." }).optional(),
  },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);

/** A spawn's receipt as the model reads it: accepted, never done, with the completion's route named. */
function childSpawnReceiptRecord(receipt: ChildSpawnReceipt): WireRecord {
  return {
    status: ACTION_RESULT_STATUS.ACCEPTED,
    accepted: true,
    completed: false,
    child_id: receipt.childId,
    child_session_key: receipt.childSessionKey,
    child_run_id: receipt.childRunId,
    ...(receipt.model ? { model: receipt.model } : undefined),
    context: receipt.context,
    ...(receipt.contextNote ? { context_note: receipt.contextNote } : undefined),
    depth: receipt.depth,
    completion:
      "arrives in this conversation as its own item when the child ends; do not poll for it",
  };
}

/** One child as `subagents` lists it: its record's standing and, once it has one, its completion's delivery. */
function childSummaryRecord(
  record: ChildRunRecord,
  completion: ChildCompletionRecord | undefined,
): WireRecord {
  return {
    child_id: record.childId,
    ...(record.label !== undefined ? { label: record.label } : undefined),
    status: record.status,
    depth: record.depth,
    context: record.context,
    accepted_at: new Date(record.acceptedAt).toISOString(),
    ...(record.settledAt !== undefined
      ? { settled_at: new Date(record.settledAt).toISOString() }
      : undefined),
    ...(record.resultText !== undefined ? { has_result: true } : undefined),
    ...(completion ? { delivery: completion.delivery, attempts: completion.attempts } : undefined),
  };
}

/** The unarchived conversations as `sessions_list` answers them, the asking one marked current. */
function conversationListingRecord(
  directory: readonly ConversationRecord[],
  current: SessionKey,
): WireRecord {
  return {
    status: ACTION_RESULT_STATUS.ACCEPTED,
    conversations: directory
      .filter((record) => record.archivedAt === undefined)
      .map((record) => ({
        session_key: record.sessionKey,
        kind: record.kind,
        name: record.name,
        last_activity_at: new Date(record.lastActivityAt).toISOString(),
        ...(record.sessionKey === current ? { current: true } : undefined),
      })),
  };
}

/** A spawn's outcome as the model reads it: the receipt, or the refusal's sentence with the service's detail. */
function spawnOutcomeRecord(outcome: ChildSpawnOutcome): WireRecord {
  if (outcome.accepted) return childSpawnReceiptRecord(outcome.receipt);
  const words = SPAWN_REFUSAL_REASON[outcome.reason];
  return rejection(outcome.detail ? `${words}: ${outcome.detail}` : words);
}

function cancellationRecord(childId: string, cancelled: ChildCancellation): WireRecord {
  if (cancelled.ok) return { status: ACTION_RESULT_STATUS.ACCEPTED, cancelled: [childId] };
  return rejection(`not every child could be cancelled: ${cancelled.remaining.join(", ")}`);
}

const SESSIONS_SPAWN: SessionToolModule = {
  name: BRAIN_TOOL.SESSIONS_SPAWN,
  description:
    "Delegate a task to a child agent that runs in a conversation of its own and reports back " +
    "when it ends. The answer is a receipt that the child was accepted — its identifiers, the " +
    "model it runs on, and the context it actually started with — never its result. Do not " +
    "poll for the result: end your turn as usual and the completion arrives in this " +
    'conversation as its own item. Children start isolated unless context is "fork", ' +
    "which branches this conversation's current context into the child when it fits the cap.",
  inputSchema: SESSIONS_SPAWN_INPUT,
  async execute(input: WireRecord, context: SessionToolContext): Promise<WireRecord> {
    const children = context.children;
    if (!children) return rejection(REFUSAL_REASON.NO_CHILDREN);
    if (context.isRevoked()) return rejection(REFUSAL_REASON.RUN_REVOKED);
    const task = text(input.task)?.trim().slice(0, maximumChildTaskLength);
    if (!task) return rejection(REFUSAL_REASON.EMPTY_TASK);
    const label = text(input.label)?.trim();
    const seconds = input.run_timeout_seconds;
    const timeoutMs =
      isWireNumber(seconds) && Number.isInteger(seconds) && seconds >= 0
        ? seconds * 1000
        : undefined;
    const ask: BrainChildSpawnAsk = {
      task,
      ...(label ? { label } : undefined),
      ...(isChildContextMode(input.context) ? { context: input.context } : undefined),
      ...(isChildCleanup(input.cleanup) ? { cleanup: input.cleanup } : undefined),
      ...(timeoutMs !== undefined ? { timeoutMs } : undefined),
      ...(isWireBoolean(input.expects_completion)
        ? { expectsCompletion: input.expects_completion }
        : undefined),
      requesterRunId: context.runId,
      policy: context.policy,
      fork: () => context.fork(),
    };
    return context.journal(async () => spawnOutcomeRecord(await children.spawn(ask)));
  },
};

const SUBAGENTS: SessionToolModule = {
  name: BRAIN_TOOL.SUBAGENTS,
  description:
    "List the children this conversation asked for — each with its id, label, status, and " +
    "when it was accepted and settled — or cancel one by id. Cancelling reaches every child " +
    "it spawned in turn. Check status only when debugging; completions arrive on their own.",
  inputSchema: SUBAGENTS_INPUT,
  async execute(input: WireRecord, context: SessionToolContext): Promise<WireRecord> {
    const children = context.children;
    if (!children) return rejection(REFUSAL_REASON.NO_CHILDREN);
    if (context.isRevoked()) return rejection(REFUSAL_REASON.RUN_REVOKED);
    if (input.action === SUBAGENTS_ACTION.CANCEL) {
      const childId = text(input.child_id);
      if (!childId) return rejection(REFUSAL_REASON.NOT_OWN_CHILD);
      return context.journal(async () => {
        const cancelled = await children.cancel(childId);
        return cancelled
          ? cancellationRecord(childId, cancelled)
          : rejection(REFUSAL_REASON.UNKNOWN_CHILD);
      });
    }
    return {
      status: ACTION_RESULT_STATUS.ACCEPTED,
      children: (await children.list()).map(({ record, completion }) =>
        childSummaryRecord(record, completion),
      ),
    };
  },
};

const SESSIONS_LIST: SessionToolModule = {
  name: BRAIN_TOOL.SESSIONS_LIST,
  description:
    "List Luke's own conversations — main, the developer's threads, the observed sessions' " +
    "conversations, and child conversations — by key, kind, name, and last activity. These " +
    "are your own conversations, not the coding agents the roster lists.",
  inputSchema: SESSIONS_LIST_INPUT,
  async execute(_input: WireRecord, context: SessionToolContext): Promise<WireRecord> {
    const children = context.children;
    if (!children) return rejection(REFUSAL_REASON.NO_CHILDREN);
    if (context.isRevoked()) return rejection(REFUSAL_REASON.RUN_REVOKED);
    return conversationListingRecord(await children.conversations(), children.sessionKey);
  },
};

const SESSIONS_HISTORY: SessionToolModule = {
  name: BRAIN_TOOL.SESSIONS_HISTORY,
  description:
    "Read the recent history of one child this conversation asked for, most recent last, " +
    `bounded to ${maximumSessionsConversationLines} lines. Only a child of this conversation answers.`,
  inputSchema: SESSIONS_HISTORY_INPUT,
  async execute(input: WireRecord, context: SessionToolContext): Promise<WireRecord> {
    const children = context.children;
    if (!children) return rejection(REFUSAL_REASON.NO_CHILDREN);
    if (context.isRevoked()) return rejection(REFUSAL_REASON.RUN_REVOKED);
    const childId = text(input.child_id);
    if (!childId) return rejection(REFUSAL_REASON.NOT_OWN_CHILD);
    const limit =
      isWireNumber(input.limit) && input.limit > 0
        ? Math.min(Math.floor(input.limit), maximumSessionsConversationLines)
        : maximumSessionsConversationLines;
    const lines = await children.lines(childId, limit);
    if (!lines) return rejection(REFUSAL_REASON.UNKNOWN_CHILD);
    return { status: ACTION_RESULT_STATUS.ACCEPTED, lines: [...lines] };
  },
};

/** The four session tools, in the order the catalog lists them. */
export const SESSION_TOOLS: readonly SessionToolModule[] = [
  SESSIONS_SPAWN,
  SUBAGENTS,
  SESSIONS_LIST,
  SESSIONS_HISTORY,
];

const SESSION_TOOLS_BY_NAME = new Map(SESSION_TOOLS.map((tool) => [tool.name, tool]));

export function sessionToolNamed(name: string): SessionToolModule | undefined {
  return SESSION_TOOLS_BY_NAME.get(name);
}
