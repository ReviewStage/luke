import { LIVE_COUNT } from "@repo/database/core/live-statement";
import { queryBuilder } from "@repo/database/core/query";
import { childConversationId } from "@repo/database/models/ids";
import { type MessageCursor, messageStandingNow } from "@repo/database/models/message-reads";
import { agentVisibleTo } from "@repo/database/models/workspace-store";
import type { ConversationTarget } from "@repo/database/models/writer";
import { agentDelegationTable, agentTable } from "@repo/database/schemas/agent";
import { agentQueue } from "@repo/database/schemas/agent-queue";
import { user } from "@repo/database/schemas/auth";
import { deviceAgentLine } from "@repo/database/schemas/device-agent";
import { conversations, messages, standingLine, turns } from "@repo/database/schemas/storage";
import { type SyncTopic, TOPIC } from "@repo/database/sync/notification";
import {
  agentDelegationSync,
  agentQueueSync,
  agentSync,
  conversationsSync,
  deviceAgentLineSync,
  githubPersonalTokenSync,
  githubRepositoryReadSync,
  memberSync,
  messagesSync,
  taskSync,
  turnsSync,
  userSync,
} from "@repo/database/sync/tables";
import { AGENT_TRANSCRIPT_READ } from "@repo/features/agent-transcript-live";
import {
  AGENT_BOUNDS,
  agentCallIdSchema,
  agentCursorSchema,
  PART_CUT_FIELD,
} from "@repo/features/agent-wire";
import { DEVICE_AGENT_LINE_KIND } from "@repo/features/device-agent-wire";
import { LIVE_POLL } from "@repo/features/live-wire";
import { TRANSCRIPT_WINDOW } from "@repo/features/transcript-window";
import { readEither } from "@repo/wire/effect";
import {
  and,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { type AnyPgColumn, alias } from "drizzle-orm/pg-core";
import { Effect, Option, Result } from "effect";
import { reachedAgentById } from "../../agents/agent-reach.js";
import { CUT_END_CHARS, CUT_TOOLS, REASONING_PART_TYPE } from "../../agents/coder-host/part-cut.js";
import { CODER_TOOL_SET } from "../../agents/coder-host/tool-set.js";
import { cursorOfWire, cursorToWire } from "../../agents/coder-host/transcript.js";
import { unparsedWire } from "../../core.js";
import { HOSTED_REFUSAL } from "../../http/http-effect.js";
import {
  bindLiveRead,
  liveRowsStatement,
  outerJoined,
  ownOrder,
  WATCHED_LOOK,
} from "../live-read-binding.js";
import { countAnswerBytes, countAnswerWait } from "../transcript-metrics.js";

/**
 * agent-transcript.ts -- a coding agent's transcript bound (`AGENT_TRANSCRIPT_READ`): what it is read from, written for Neon Realtime, so a reader hears the moment a page past its cursor would say something new, the tables they read, the topics that wake it, and where its cursor stands.
 *
 * A page of the transcript (`transcript.ts`) is assembled from many reads,
 * some priced against the model catalog, which lives outside Postgres, so
 * the page itself is not followed: these statements are the rows a held
 * read looks at for something new, and a reader that follows them reads the
 * page once they move rather than on a clock. Each moves where the held
 * read would wake: a message added to the conversation (`messages`) or
 * amended in place, which counts its journal revision up (`conversation`),
 * a turn opened, started, settled, or stopped (`turns`, counted by its
 * status, so a turn moving from one to another moves them), which is where the
 * status is read from and a line stops awaiting its turn, and a title
 * landing, the agent's own (`agent`) or a worker's, or a worker's
 * delegation being recorded (`workers`), and, for an agent on a device, its
 * newest launch line being claimed, stepping, or settling (`launch`), which
 * is where the page reads what the agent's start waits on. Each reads only the rows of the
 * account that started the agent, as the held read does, and only while
 * the reader is a member of the agent's workspace: the membership is joined
 * in the statement, so a member taken out of the workspace stops hearing
 * anything at once, as Neon's guide asks, rather than at the next seal.
 * The newest messages themselves are followed too, as rows (`window`): the
 * last `TRANSCRIPT_WINDOW` by sequence, one row a message keyed by its id,
 * each with what the page carries beside it joined in rather than read
 * after (`@repo/features/transcript-window`), so a reader draws them from
 * the rows that arrive (`windowOf`), and their parts
 * keyed apart, the heavy ones cut as a page asked cut cuts them.
 * Every row that is one of many carries its key. Nothing in them reads the clock: a status
 * that changes with time alone, such as an agent past its grace, is the
 * reader's to ask for at the end of its hold.
 */

/** A number Postgres holds as `bigint`, as a number rather than the text Realtime would carry. */
const asNumber = (value: SQL): SQL<number> => sql<number>`(${value})::float8`;

/** When a turn last changed: the latest of the stamps its opening, start, settling, and Stop write. */
const TURN_CHANGED = sql`greatest(
  ${turns.queuedAt},
  coalesce(${turns.startedAt}, ${turns.queuedAt}),
  coalesce(${turns.settledAt}, ${turns.queuedAt}),
  coalesce(${turns.cancelRequestedAt}, ${turns.queuedAt})
)`;

/** How many of a status's turns were asked to stop. */
const STOPPED = sql<number>`count(${turns.cancelRequestedAt})::int`;

/** The journal of the turn that took a developer's line in, which shares the turn's id as its client id. */
const takingJournal = alias(messages, "taking_journal");
/** The coding agent that sent a line, apart from the agent the statement's membership reads. */
const sendingAgent = alias(agentTable, "sending_agent");

/** A message of the window, and one of its parts, as their live rows declare them, which an expression among their columns is typed to. */
type WindowRow = (typeof AGENT_TRANSCRIPT_READ.parts.window.row)["Encoded"];
type PartRow = (typeof AGENT_TRANSCRIPT_READ.parts.windowParts.row)["Encoded"];

/** The newest messages' own rows, by id, which the parts statement reads the parts of. */
const windowMessage = alias(messages, "window_message");

/**
 * Whether the message row is past the cursor, where one is named: numbered
 * after its sequence, or amended in place after its revision, as a page past
 * a cursor reads (`listMessagesPast`). A row moved to a fresh sequence is
 * past it by that sequence.
 */
const pastCursor = (
  row: { readonly seq: AnyPgColumn; readonly revision: AnyPgColumn },
  past: MessageCursor | undefined,
): SQL | undefined =>
  past === undefined ? undefined : or(gt(row.seq, past.seq), gt(row.revision, past.revision));

/** The part types whose heavy field a page may cut: reasoning's words, and the outputs of the tools that answer as words (`part-cut.ts`). */
const CUT_TOOL_TYPES = sql.join(
  [...CUT_TOOLS].map((tool) => sql`${`tool-${tool}`}`),
  sql`, `,
);

/** The tools a transcript's reads hold, as one text a statement splits on spaces, which no tool's name holds. */
const HELD_TOOLS = Object.keys(CODER_TOOL_SET).join(" ");

/**
 * Whether the part `element` is a tool part the transcript's reads no longer
 * hold, which they leave out (`withoutRetiredToolParts`), so the window
 * leaves it out too and every part after it stands at the index a page and a
 * whole part's read give it.
 */
const retired = (element: SQL) => sql`(${element}->>'type' like 'tool-%'
  and substr(${element}->>'type', 6) <> all(string_to_array(${HELD_TOOLS}, ' ')))`;

/**
 * The parts of the window's messages, one row a part keyed by its message's
 * id and its index, each cut as a page asked cut cuts it (`part-cut.ts`): a
 * reasoning's words or a word-answering tool's output past `MAX_PART_CHARS`
 * is left out of the part and carried as its two ends and its size in
 * bytes. A journal growing in place then moves only the rows of the parts it
 * added or settled, rather than the whole journal. Note that the words are
 * measured in characters, as the page measures them in UTF-16 units, and a
 * tool output that is no string as Postgres spells its JSON, so a part at
 * the very bound may be cut on one and not the other; only the ends drawn
 * differ.
 */
function windowPartsOf(target: ConversationTarget, reached: SQL, past: MessageCursor | undefined) {
  const element = queryBuilder
    .select({
      value: sql`element.value`.as("value"),
      index: sql<number>`(row_number() over (order by element.ordinality) - 1)::int`.as("index"),
      field: sql<string | null>`case
        when element.value->>'type' = ${REASONING_PART_TYPE}
          and jsonb_typeof(element.value->'text') = 'string' then ${PART_CUT_FIELD.TEXT}
        when element.value->>'type' in (${CUT_TOOL_TYPES})
          and element.value->'output' is not null then ${PART_CUT_FIELD.OUTPUT}
      end`.as("field"),
      words: sql<string | null>`case
        when element.value->>'type' = ${REASONING_PART_TYPE}
          and jsonb_typeof(element.value->'text') = 'string' then element.value->>'text'
        when element.value->>'type' in (${CUT_TOOL_TYPES})
          and jsonb_typeof(element.value->'output') = 'string' then element.value->>'output'
        when element.value->>'type' in (${CUT_TOOL_TYPES})
          and element.value->'output' is not null then (element.value->'output')::text
      end`.as("words"),
    })
    .from(
      sql`jsonb_array_elements(${messages.parts}) with ordinality as element(value, ordinality)`,
    )
    .where(sql`not ${retired(sql`element.value`)}`)
    .as("part");
  const cut = sql`coalesce(length(${element.words}) > ${AGENT_BOUNDS.MAX_PART_CHARS}, false)`;
  const newest = queryBuilder
    .select({ id: windowMessage.id })
    .from(windowMessage)
    .where(
      and(
        eq(windowMessage.conversationId, target.conversationId),
        eq(windowMessage.userId, target.userId),
        standingLine(windowMessage),
        pastCursor(windowMessage, past),
      ),
    )
    .orderBy(desc(windowMessage.seq))
    .limit(TRANSCRIPT_WINDOW);
  return liveRowsStatement(
    AGENT_TRANSCRIPT_READ.parts.windowParts,
    {
      ordered: false,
      columns: {
        messageId: sql<string>`${messages.id}`,
        index: sql<number>`${element.index}`,
        part: sql<
          PartRow["part"]
        >`case when ${cut} then ${element.value} - ${element.field} else ${element.value} end`,
        cutField: sql<PartRow["cutField"]>`case when ${cut} then ${element.field} end`,
        bytes: sql<number | null>`case when ${cut} then octet_length(${element.words}) end`,
        head: sql<
          string | null
        >`case when ${cut} then left(${element.words}, ${CUT_END_CHARS}) end`,
        tail: sql<
          string | null
        >`case when ${cut} then right(${element.words}, ${CUT_END_CHARS}) end`,
      },
    },
    (selection) =>
      queryBuilder
        .select(selection)
        .from(messages)
        .innerJoin(
          conversations,
          and(eq(conversations.id, messages.conversationId), isNull(conversations.deletedAt)),
        )
        .crossJoinLateral(element)
        .where(
          and(
            eq(messages.conversationId, target.conversationId),
            eq(messages.userId, target.userId),
            inArray(messages.id, newest),
            reached,
          ),
        ),
  );
}

/**
 * The newest `TRANSCRIPT_WINDOW` messages of `target`'s conversation, each
 * with what sent it, where a turn under way took it in, and the turn it
 * was written in, each join
 * naming one row at most, so a message is one row keyed by its id, with how
 * many parts it holds, which `windowParts` carries one row each; read
 * only while `reached` holds, as the other statements are. Past a cursor,
 * where one is named, only the newest of the messages written or amended
 * past it. Note that the newest are taken by an order of its own, which the
 * reader's declared order matches.
 */
function windowOf(target: ConversationTarget, reached: SQL, past: MessageCursor | undefined) {
  return liveRowsStatement(
    AGENT_TRANSCRIPT_READ.parts.window,
    {
      ordered: false,
      columns: {
        id: messages.id,
        clientId: messages.clientId,
        turnId: sql<string | null>`${messages.turnId}`,
        role: messages.role,
        metadata: sql<WindowRow["metadata"]>`${messages.metadata}`,
        sender: messages.sender,
        senderName: messages.senderName,
        senderModel: messages.senderModel,
        memberId: outerJoined(user.id),
        memberName: outerJoined(user.name),
        agentId: outerJoined(sendingAgent.id),
        agentTaskId: sendingAgent.taskId,
        automationId: messages.senderAutomationId,
        journalId: outerJoined(takingJournal.id),
        afterStep: messages.takenAfterStep,
        // No line the voice said is folded under a turn any more; a released desktop still decodes the keys.
        askTurnId: sql<string | null>`null::text`,
        askAfterStep: sql<number | null>`null::integer`,
        turnStatus: outerJoined(turns.status),
        turnModel: outerJoined(turns.model),
        turnEffort: turns.reasoningEffort,
        turnUsage: turns.usage,
        turnFailure: turns.failure,
        turnFastRefused: outerJoined(turns.fastRefused),
        seq: asNumber(sql`${messages.seq}`),
        partCount: sql<number>`(
        select count(*)::int from jsonb_array_elements(${messages.parts}) as held(value)
        where not ${retired(sql`held.value`)}
      )`,
      },
      instants: {
        placedAt: messages.placedAt,
        finishedAt: messages.finishedAt,
        turnStartedAt: sql`coalesce(${turns.startedAt}, ${turns.queuedAt})`,
      },
    },
    // Note that the sequence and the count of parts stand after the instants, as the statement always selected them, so its text is as released.
    ({ seq, partCount, ...selected }) =>
      ownOrder(
        queryBuilder
          .select({ ...selected, seq, partCount })
          .from(messages)
          .innerJoin(
            conversations,
            and(eq(conversations.id, messages.conversationId), isNull(conversations.deletedAt)),
          )
          .leftJoin(user, eq(user.id, messages.senderUserId))
          .leftJoin(sendingAgent, eq(sendingAgent.id, messages.senderAgentId))
          .leftJoin(
            takingJournal,
            and(
              isNotNull(messages.takenAfterStep),
              eq(takingJournal.conversationId, messages.conversationId),
              eq(takingJournal.clientId, sql`${messages.turnId}::text`),
            ),
          )
          .leftJoin(turns, and(eq(turns.id, messages.turnId), eq(turns.userId, messages.userId)))
          .where(
            and(
              eq(messages.conversationId, target.conversationId),
              eq(messages.userId, target.userId),
              // A line its hand-over withdrew reads nowhere until a turn takes it (`message-reads.ts`).
              standingLine(messages),
              pastCursor(messages, past),
              reached,
            ),
          )
          .orderBy(desc(messages.seq))
          .limit(TRANSCRIPT_WINDOW),
      ),
  );
}

/**
 * The condition that `readerId` may follow the transcripts under the coding
 * agent whose conversation is `parentConversationId`, which `ownerId`
 * started: it is a member of the agent's workspace. Joined in each statement,
 * so it stays live.
 */
function agentFollowedBy(ownerId: string, parentConversationId: string, readerId: string): SQL {
  return exists(
    queryBuilder
      .select({ one: agentTable.id })
      .from(agentTable)
      .where(
        and(
          eq(agentTable.conversationId, parentConversationId),
          eq(agentTable.userId, ownerId),
          agentVisibleTo(readerId),
        ),
      ),
  );
}

/** The transcript's params as its statements read them: the conversation followed, under the agent's own. */
interface TranscriptParams {
  readonly ownerId: string;
  readonly conversationId: string;
  readonly parentConversationId: string;
  readonly userId: string;
}

/**
 * The statements the transcript of the conversation `conversationId` is
 * followed by, under the agent's own `parentConversationId`: an agent's
 * own, where the two are the same, or one of its workers', while the reader
 * is a member of the workspace the transcript belongs to
 * (`agentFollowedBy`); its newest messages past `past`, where a cursor is
 * named (`windowOf`, `windowPartsOf`).
 */
function transcriptStatements(params: TranscriptParams, past?: MessageCursor) {
  const { ownerId: userId, conversationId, parentConversationId } = params;
  const target = { userId, conversationId };
  const reached = agentFollowedBy(userId, parentConversationId, params.userId);
  const written = liveRowsStatement(
    AGENT_TRANSCRIPT_READ.parts.messages,
    {
      ordered: false,
      columns: {
        rows: LIVE_COUNT,
        seq: asNumber(sql`coalesce(max(${messages.seq}), 0)`),
      },
    },
    (selection) =>
      queryBuilder
        .select(selection)
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conversationId),
            eq(messages.userId, userId),
            standingLine(messages),
            reached,
          ),
        ),
  );
  const run = liveRowsStatement(
    AGENT_TRANSCRIPT_READ.parts.turns,
    {
      ordered: false,
      columns: {
        status: turns.status,
        rows: LIVE_COUNT,
        stopped: STOPPED,
      },
      instants: { changedAt: sql<Date>`max(${TURN_CHANGED})` },
    },
    // Note that the count of Stops is selected as it always was, outside the selection's own wrapping, so its column stands bare in this select of one table and its text is as released.
    ({ status, rows, changedAt }) =>
      queryBuilder
        .select({ status, rows, stopped: STOPPED.as("stopped"), changedAt })
        .from(turns)
        .where(and(eq(turns.conversationId, conversationId), eq(turns.userId, userId), reached))
        .groupBy(turns.status),
  );
  const conversation = liveRowsStatement(
    AGENT_TRANSCRIPT_READ.parts.conversation,
    {
      ordered: false,
      columns: {
        id: conversations.id,
        title: conversations.title,
        revision: asNumber(sql`${conversations.journalRevision}`),
      },
    },
    (selection) =>
      queryBuilder
        .select(selection)
        .from(conversations)
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.userId, userId),
            isNull(conversations.deletedAt),
            reached,
          ),
        ),
  );
  const agent = liveRowsStatement(
    AGENT_TRANSCRIPT_READ.parts.agent,
    { ordered: false, columns: { id: agentTable.id, title: agentTable.title } },
    (selection) =>
      queryBuilder
        .select(selection)
        .from(agentTable)
        .where(
          and(
            eq(agentTable.conversationId, parentConversationId),
            eq(agentTable.userId, userId),
            reached,
          ),
        ),
  );
  const workers = liveRowsStatement(
    AGENT_TRANSCRIPT_READ.parts.workers,
    {
      ordered: false,
      columns: {
        id: conversations.id,
        title: conversations.title,
        callId: outerJoined(agentDelegationTable.callId),
      },
    },
    (selection) =>
      queryBuilder
        .select(selection)
        .from(conversations)
        .leftJoin(
          agentDelegationTable,
          eq(agentDelegationTable.childConversationId, conversations.id),
        )
        .where(
          and(
            eq(conversations.parentConversationId, parentConversationId),
            eq(conversations.userId, userId),
            isNull(conversations.deletedAt),
            reached,
          ),
        ),
  );
  // The agent's queue as its revision, which every write to the queue or its pause moves on in the same
  // transaction (`agent-queue-store.ts`), so one number wakes the read for all of them. Note that its
  // column is selected bare under its own name, as the statement always selected it, so its text is as released.
  const queueRevision = liveRowsStatement(
    AGENT_TRANSCRIPT_READ.parts.queueRevision,
    { ordered: false, columns: { revision: agentQueue.revision } },
    () =>
      queryBuilder
        .select({ revision: agentQueue.revision })
        .from(agentQueue)
        .innerJoin(agentTable, eq(agentTable.id, agentQueue.agentId))
        .where(
          and(
            eq(agentTable.conversationId, parentConversationId),
            eq(agentTable.userId, userId),
            reached,
          ),
        ),
  );
  // The agent's newest launch line, on a device, as its claim, its step, and its settling stand,
  // read on the agent's own transcript alone, since a worker's conversation is no agent's.
  const launch = liveRowsStatement(
    AGENT_TRANSCRIPT_READ.parts.launch,
    {
      ordered: false,
      columns: {
        id: deviceAgentLine.id,
        step: deviceAgentLine.launchStep,
        claimed: sql<boolean>`${deviceAgentLine.claimedAt} is not null`,
        settled: sql<boolean>`${deviceAgentLine.settledAt} is not null`,
      },
    },
    (selection) =>
      ownOrder(
        queryBuilder
          .select(selection)
          .from(deviceAgentLine)
          .innerJoin(agentTable, eq(agentTable.id, deviceAgentLine.agentId))
          .where(
            and(
              eq(agentTable.conversationId, conversationId),
              eq(agentTable.userId, userId),
              eq(deviceAgentLine.userId, userId),
              eq(deviceAgentLine.kind, DEVICE_AGENT_LINE_KIND.LAUNCH),
              reached,
            ),
          )
          .orderBy(desc(deviceAgentLine.seq))
          .limit(1),
      ),
  );
  return {
    messages: written,
    turns: run,
    conversation,
    agent,
    workers,
    queueRevision,
    launch,
    window: windowOf(target, reached, past),
    windowParts: windowPartsOf(target, reached, past),
  };
}

/** The delegation call a query named, where one is a call id; one of any other shape names no worker, and is not found. */
const callIdOf = /* @__PURE__ */ Effect.fnUntraced(function* (call: string) {
  const read = readEither(agentCallIdSchema)(unparsedWire(call));
  if (Result.isFailure(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return read.success;
});

/**
 * A coding agent's transcript, or one of its workers' (`call`, under the
 * agent's own `parentConversationId`), started by `ownerId` and read by the
 * account while it is a member of the agent's workspace, the agent read as
 * the account first, so one it does not reach is not found. A worker's
 * delegation may not be recorded yet, as a tab opened on its call is read
 * before it is, so its statements name the conversation the call will open
 * rather than wait for it. It is woken by a write to the transcript's
 * messages, turns, or conversation, to a worker's conversation or
 * delegation under the agent's, to the agent itself, its queue, or a line
 * queued for its device, and to what admits the reader to its workspace or
 * repository; the agent's task is read for the reader's reach of it
 * (`agentVisibleTo`) and wakes nothing, as a task's reach moves with what
 * admits the reader. It is looked at every second where nothing wakes it,
 * as a transcript someone watches move.
 *
 * Its newest messages (`window`, `windowParts`) are followed by cursor:
 * where the reader holds them, the highest sequence it has and the journal
 * revision it read at, as a page past a cursor reads them
 * (`listMessagesPast`). Every write to a message locks its conversation and
 * takes its sequence or revision from the conversation's counters, so they
 * move in commit order, and a reader past a cursor read before its rows
 * misses none. A rewind moves the conversation's rewound revision, and a
 * reader whose cursor is older is answered the window whole. A cursor of
 * no shape is refused, once the call is read and before the agent is.
 *
 * Note that a line's sender's name, and a sending agent's task, are read
 * beside the line rather than written on it, so a change to either wakes no
 * transcript and moves no line past the cursor: a cursor reader sees it the
 * next time it reads the window whole, and a reader that names no cursor at
 * the hold's end, within 25 s. A turn settling moves its journal's revision
 * (`writer.ts`'s `reviseJournal`), so what the settled turn says of it is
 * answered past the cursor. Its answers are measured
 * (`transcript-metrics.ts`).
 */
export const agentTranscriptRead = bindLiveRead(AGENT_TRANSCRIPT_READ, {
  reads: [
    messagesSync,
    conversationsSync,
    turnsSync,
    agentDelegationSync,
    userSync,
    agentSync,
    taskSync,
    memberSync,
    githubPersonalTokenSync,
    githubRepositoryReadSync,
    agentQueueSync,
    deviceAgentLineSync,
  ],
  topics: ({ conversationId, parentConversationId, agentId, userId }) => {
    const parent: readonly SyncTopic[] =
      parentConversationId === conversationId ? [] : [[TOPIC.CONVERSATION, parentConversationId]];
    return [
      [TOPIC.CONVERSATION, conversationId],
      ...parent,
      [TOPIC.AGENT, agentId],
      [TOPIC.ACCOUNT, userId],
    ];
  },
  statements: (params, past) =>
    transcriptStatements(params, past === undefined ? undefined : cursorOfWire(past)),
  cursor: {
    parts: ["window", "windowParts"],
    standing: ({ ownerId, conversationId }) =>
      Effect.map(messageStandingNow(ownerId, conversationId), ({ cursor, rewound }) => ({
        next: cursorToWire(cursor),
        stands: (asked) =>
          Option.match(rewound, {
            onNone: () => true,
            onSome: (at) => cursorOfWire(asked).revision >= at,
          }),
      })),
  },
  // Note that the query is read for the call and the cursor, so a call named empty is not found as one of no shape is, and both are read before the agent, as they always were.
  serve: ({ userId, id }, query) =>
    Effect.gen(function* () {
      const call = query.call;
      const callId = call === undefined ? undefined : yield* callIdOf(call);
      const cursor = query[LIVE_POLL.CURSOR];
      if (
        cursor !== undefined &&
        Result.isFailure(readEither(agentCursorSchema)(unparsedWire(cursor)))
      ) {
        return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
      }
      const { agent, target } = yield* reachedAgentById(userId, id);
      return {
        ownerId: target.userId,
        conversationId:
          callId === undefined
            ? target.conversationId
            : childConversationId(target.conversationId, callId),
        parentConversationId: target.conversationId,
        agentId: agent.id,
      };
    }),
  look: WATCHED_LOOK,
  woken: countAnswerWait,
  answered: countAnswerBytes,
});
