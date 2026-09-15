import type { ChildCancellation, ChildSpawnOutcome } from "@sidecar/runtime";
import type {
  ChildRunRecord,
  ChildSpawnReceipt,
  ConversationRecord,
  SessionKey,
} from "@sidecar/runtime/vocabulary";
import {
  ACTION_RESULT_STATUS,
  isWireBoolean,
  isWireNumber,
  text,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";
import { describeWire } from "@sidecar/wire/effect";
import { Effect, Schema as EffectSchema, SchemaTransformation } from "effect";
import {
  BRAIN_TOOL,
  maximumChildTaskLength,
  maximumSessionsConversationLines,
  SUBAGENTS_ACTION,
} from "./names.js";
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
  readonly expectsCompletion?: boolean;
  /** The run the spawn was called in, for the child's record. */
  readonly requesterRunId: string;
}

/**
 * How the session tools reach delegation: the host owns the conversations,
 * the child service, and the directory, and answers each in its own typed
 * terms.
 */
export interface BrainChildAccess {
  /** The conversation these tools belong to, which the listing marks current. */
  readonly sessionKey: SessionKey;
  spawn(ask: BrainChildSpawnAsk): Effect.Effect<ChildSpawnOutcome>;
  /** This conversation's children, as their records stand. */
  list(): Effect.Effect<readonly ChildRunRecord[]>;
  /** Cancels one of this conversation's children and its descendants; nothing for a child that is not its own. */
  cancel(childId: string): Effect.Effect<ChildCancellation | undefined>;
  conversations(): Effect.Effect<readonly ConversationRecord[]>;
  /** One of this conversation's children's conversation lines, most recent last; nothing for a child that is not its own. */
  lines(childId: string, limit: number): Effect.Effect<readonly string[] | undefined>;
}

export interface SessionToolContext extends ToolContext {
  /** Delegation, when the host wired it; absent, every session tool refuses. */
  readonly children: BrainChildAccess | undefined;
  /** Records an effect before it runs and its result before the model reads it; the executor's journal. */
  journal(effect: Effect.Effect<WireRecord>): Effect.Effect<WireRecord>;
}

type SessionToolModule = ToolModule<WireRecord, SessionToolContext>;

/** A text trimmed and refused when left with nothing. */
function trimmedText(description: string): EffectSchema.Codec<string, string> {
  return describeWire(
    EffectSchema.String.pipe(
      EffectSchema.decodeTo(
        EffectSchema.String.check(EffectSchema.isNonEmpty()),
        SchemaTransformation.trim(),
      ),
    ),
    description,
  );
}

/** A whole number, with no bound beyond being finite and integral. */
function wholeNumber(description: string): EffectSchema.Codec<number, number> {
  return describeWire(
    EffectSchema.Number.check(EffectSchema.isFinite(), EffectSchema.isInt()),
    description,
  );
}

function memberEnum<const Member extends string>(
  members: readonly Member[],
  description: string,
): EffectSchema.Codec<Member, Member> {
  return describeWire(EffectSchema.Literals(members), description);
}

/** Effect's `Codec` is invariant in its decoded type, so a concrete struct is erased to the module shape's type. */
function erase(schema: EffectSchema.Top): EffectSchema.Codec<unknown, UnparsedWireValue> {
  return EffectSchema.make(schema.ast);
}

const SESSIONS_SPAWN_INPUT = erase(
  EffectSchema.Struct({
    task: trimmedText(`The task, briefed in full, under ${maximumChildTaskLength} characters.`),
    label: EffectSchema.optionalKey(trimmedText("A short title for the work, for listings.")),
    expects_completion: EffectSchema.optionalKey(
      describeWire(
        EffectSchema.Boolean,
        "False for a fire-and-forget child whose end is not reported back; true by default.",
      ),
    ),
  }),
);

const SUBAGENTS_INPUT = erase(
  EffectSchema.Struct({
    action: EffectSchema.optionalKey(
      memberEnum(Object.values(SUBAGENTS_ACTION), "What to do; list by default."),
    ),
    child_id: EffectSchema.optionalKey(trimmedText("The child to cancel, as the list gave it.")),
  }),
);

const SESSIONS_LIST_INPUT = erase(EffectSchema.Struct({}));

const SESSIONS_HISTORY_INPUT = erase(
  EffectSchema.Struct({
    child_id: trimmedText("The child, as the subagents list gave it."),
    limit: EffectSchema.optionalKey(wholeNumber("How many lines at most.")),
  }),
);

/** A spawn's receipt as the model reads it: accepted, never done, with the completion's route named. */
function childSpawnReceiptRecord(receipt: ChildSpawnReceipt): WireRecord {
  return {
    status: ACTION_RESULT_STATUS.ACCEPTED,
    accepted: true,
    completed: false,
    child_id: receipt.childId,
    child_session_key: receipt.childSessionKey,
    completion:
      "arrives in this conversation as its own item when the child ends; do not poll for it",
  };
}

/** One child as `subagents` lists it: its record's standing. */
function childSummaryRecord(record: ChildRunRecord): WireRecord {
  return {
    child_id: record.childId,
    ...(record.label !== undefined ? { label: record.label } : undefined),
    status: record.status,
    accepted_at: new Date(record.acceptedAt).toISOString(),
    ...(record.settledAt !== undefined
      ? { settled_at: new Date(record.settledAt).toISOString() }
      : undefined),
    ...(record.resultText !== undefined ? { has_result: true } : undefined),
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
    "when it ends. The answer is a receipt that the child was accepted — its identifiers — " +
    "never its result. Do not poll for the result: end your turn as usual and the completion " +
    "arrives in this conversation as its own item. A child starts with a clean transcript and " +
    "knows only its task, so brief it in full.",
  inputSchema: SESSIONS_SPAWN_INPUT,
  execute(input: WireRecord, context: SessionToolContext): Effect.Effect<WireRecord> {
    return Effect.suspend(() => {
      const children = context.children;
      if (!children) return Effect.succeed(rejection(REFUSAL_REASON.NO_CHILDREN));
      if (context.isRevoked()) return Effect.succeed(rejection(REFUSAL_REASON.RUN_REVOKED));
      const task = text(input.task)?.trim().slice(0, maximumChildTaskLength);
      if (!task) return Effect.succeed(rejection(REFUSAL_REASON.EMPTY_TASK));
      const label = text(input.label)?.trim();
      const ask: BrainChildSpawnAsk = {
        task,
        ...(label ? { label } : undefined),
        ...(isWireBoolean(input.expects_completion)
          ? { expectsCompletion: input.expects_completion }
          : undefined),
        requesterRunId: context.runId,
      };
      return context.journal(Effect.map(children.spawn(ask), spawnOutcomeRecord));
    });
  },
};

const SUBAGENTS: SessionToolModule = {
  name: BRAIN_TOOL.SUBAGENTS,
  description:
    "List the children this conversation asked for — each with its id, label, status, and " +
    "when it was accepted and settled — or cancel one by id. Cancelling reaches every child " +
    "it spawned in turn. Check status only when debugging; completions arrive on their own.",
  inputSchema: SUBAGENTS_INPUT,
  execute(input: WireRecord, context: SessionToolContext): Effect.Effect<WireRecord> {
    return Effect.gen(function* () {
      const children = context.children;
      if (!children) return rejection(REFUSAL_REASON.NO_CHILDREN);
      if (context.isRevoked()) return rejection(REFUSAL_REASON.RUN_REVOKED);
      if (input.action === SUBAGENTS_ACTION.CANCEL) {
        const childId = text(input.child_id);
        if (!childId) return rejection(REFUSAL_REASON.NOT_OWN_CHILD);
        return yield* context.journal(
          Effect.map(children.cancel(childId), (cancelled) =>
            cancelled
              ? cancellationRecord(childId, cancelled)
              : rejection(REFUSAL_REASON.UNKNOWN_CHILD),
          ),
        );
      }
      const listed = yield* children.list();
      return { status: ACTION_RESULT_STATUS.ACCEPTED, children: listed.map(childSummaryRecord) };
    });
  },
};

const SESSIONS_LIST: SessionToolModule = {
  name: BRAIN_TOOL.SESSIONS_LIST,
  description:
    "List Luke's own conversations — main, the developer's threads, the observed sessions' " +
    "conversations, and child conversations — by key, kind, name, and last activity. These " +
    "are your own conversations, not the coding agents the roster lists.",
  inputSchema: SESSIONS_LIST_INPUT,
  execute(_input: WireRecord, context: SessionToolContext): Effect.Effect<WireRecord> {
    return Effect.gen(function* () {
      const children = context.children;
      if (!children) return rejection(REFUSAL_REASON.NO_CHILDREN);
      if (context.isRevoked()) return rejection(REFUSAL_REASON.RUN_REVOKED);
      const directory = yield* children.conversations();
      return conversationListingRecord(directory, children.sessionKey);
    });
  },
};

const SESSIONS_HISTORY: SessionToolModule = {
  name: BRAIN_TOOL.SESSIONS_HISTORY,
  description:
    "Read the recent history of one child this conversation asked for, most recent last, " +
    `bounded to ${maximumSessionsConversationLines} lines. Only a child of this conversation answers.`,
  inputSchema: SESSIONS_HISTORY_INPUT,
  execute(input: WireRecord, context: SessionToolContext): Effect.Effect<WireRecord> {
    return Effect.gen(function* () {
      const children = context.children;
      if (!children) return rejection(REFUSAL_REASON.NO_CHILDREN);
      if (context.isRevoked()) return rejection(REFUSAL_REASON.RUN_REVOKED);
      const childId = text(input.child_id);
      if (!childId) return rejection(REFUSAL_REASON.NOT_OWN_CHILD);
      const limit =
        isWireNumber(input.limit) && input.limit > 0
          ? Math.min(Math.floor(input.limit), maximumSessionsConversationLines)
          : maximumSessionsConversationLines;
      const lines = yield* children.lines(childId, limit);
      if (!lines) return rejection(REFUSAL_REASON.UNKNOWN_CHILD);
      return { status: ACTION_RESULT_STATUS.ACCEPTED, lines: [...lines] };
    });
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
