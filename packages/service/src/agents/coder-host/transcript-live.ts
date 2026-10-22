import {
  LIVE_COUNT,
  type LiveStatement,
  liveLatest,
  liveSelection,
  liveStatementOf,
} from "@luke/database/core/live-statement";
import { queryBuilder } from "@luke/database/core/query";
import { agentReachableBy } from "@luke/database/models/workspace-store";
import type { ConversationTarget } from "@luke/database/models/writer";
import { user } from "@luke/database/schemas/auth";
import { codingAgent, codingAgentDelegation } from "@luke/database/schemas/coding-agent";
import { asks, conversations, messages, turns } from "@luke/database/schemas/storage";
import { CODING_AGENT_BOUNDS, PART_CUT_FIELD } from "@luke/features/coding-agent-wire";
import { TRANSCRIPT_WINDOW } from "@luke/features/transcript-window";
import { and, desc, eq, exists, inArray, isNotNull, isNull, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Option } from "effect";
import { CUT_END_CHARS, CUT_TOOLS, REASONING_PART_TYPE } from "./part-cut.js";
import { CODER_TOOL_SET } from "./tool-set.js";

/**
 * transcript-live.ts -- what a coding agent's transcript is read from, written for Neon Realtime, so a reader hears the moment a page past its cursor would say something new.
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
 * delegation being recorded (`workers`). Each reads only the rows of the
 * account that started the agent, as the held read does, and only while
 * the reader is a member of the agent's workspace: the membership is joined
 * in the statement, so a member taken out of the workspace stops hearing
 * anything at once, as Neon's guide asks, rather than at the next seal.
 * The newest messages themselves are followed too, as rows (`window`): the
 * last `TRANSCRIPT_WINDOW` by sequence, one row a message keyed by its id,
 * each with what the page carries beside it joined in rather than read
 * after (`@luke/features/transcript-window`), so a reader draws them from
 * the rows that arrive (`transcriptWindowLiveStatements`), and their parts
 * keyed apart, the heavy ones cut as a page asked cut cuts them.
 * Every row that is one of many carries its key. Nothing in them reads the clock: a status
 * that changes with time alone, such as an agent past its grace, is the
 * reader's to ask for at the end of its hold.
 */

/** The statements a transcript is followed by, each a part of the one read. */
/** The statements a transcript's newest messages are drawn from: the messages, and their parts keyed apart. */
export interface TranscriptWindowStatements {
  readonly window: LiveStatement;
  readonly windowParts: LiveStatement;
}

export interface TranscriptLiveStatements extends TranscriptWindowStatements {
  readonly messages: LiveStatement;
  readonly turns: LiveStatement;
  readonly conversation: LiveStatement;
  readonly agent: LiveStatement;
  readonly workers: LiveStatement;
}

/** A number Postgres holds as `bigint`, as a number rather than the text Realtime would carry. */
const asNumber = (value: SQL): SQL<number> => sql<number>`(${value})::float8`;

/** When a turn last changed: the latest of the stamps its opening, start, settling, and Stop write. */
const TURN_CHANGED = sql`greatest(
  ${turns.queuedAt},
  coalesce(${turns.startedAt}, ${turns.queuedAt}),
  coalesce(${turns.settledAt}, ${turns.queuedAt}),
  coalesce(${turns.cancelRequestedAt}, ${turns.queuedAt})
)`;

/** The journal of the turn that took a developer's line in, which shares the turn's id as its client id. */
const takingJournal = alias(messages, "taking_journal");
/** The coding agent that sent a line, apart from the agent the statement's membership reads. */
const sendingAgent = alias(codingAgent, "sending_agent");

/** The newest messages' own rows, by id, which the parts statement reads the parts of. */
const windowMessage = alias(messages, "window_message");

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
function windowPartsOf(target: ConversationTarget, reached: SQL) {
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
  const cut = sql`coalesce(length(${element.words}) > ${CODING_AGENT_BOUNDS.MAX_PART_CHARS}, false)`;
  const newest = queryBuilder
    .select({ id: windowMessage.id })
    .from(windowMessage)
    .where(
      and(
        eq(windowMessage.conversationId, target.conversationId),
        eq(windowMessage.userId, target.userId),
      ),
    )
    .orderBy(desc(windowMessage.seq))
    .limit(TRANSCRIPT_WINDOW);
  return queryBuilder
    .select({
      messageId: sql<string>`${messages.id}`.as("messageId"),
      index: sql<number>`${element.index}`.as("index"),
      part: sql`case when ${cut} then ${element.value} - ${element.field} else ${element.value} end`.as(
        "part",
      ),
      cutField: sql<string | null>`case when ${cut} then ${element.field} end`.as("cutField"),
      bytes: sql<number | null>`case when ${cut} then octet_length(${element.words}) end`.as(
        "bytes",
      ),
      head: sql<
        string | null
      >`case when ${cut} then left(${element.words}, ${CUT_END_CHARS}) end`.as("head"),
      tail: sql<
        string | null
      >`case when ${cut} then right(${element.words}, ${CUT_END_CHARS}) end`.as("tail"),
    })
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
    );
}

/**
 * The newest `TRANSCRIPT_WINDOW` messages of `target`'s conversation, each
 * with what sent it, where a turn under way took it in, the turn the ask a
 * spoken line followed ran in, and the turn it was written in, each join
 * naming one row at most, so a message is one row keyed by its id, with how
 * many parts it holds, which `windowParts` carries one row each; read
 * only while `reached` holds, as the other statements are. None where it
 * names a value Realtime cannot carry.
 */
export function transcriptWindowLiveStatements(
  target: ConversationTarget,
  reached: SQL,
): Option.Option<TranscriptWindowStatements> {
  const window = queryBuilder
    .select({
      ...liveSelection(
        {
          id: messages.id,
          clientId: messages.clientId,
          turnId: messages.turnId,
          role: messages.role,
          metadata: messages.metadata,
          sender: messages.sender,
          senderName: messages.senderName,
          senderModel: messages.senderModel,
          memberId: user.id,
          memberName: user.name,
          agentId: sendingAgent.id,
          agentTaskId: sendingAgent.taskId,
          journalId: takingJournal.id,
          afterStep: messages.takenAfterStep,
          askTurnId: asks.turnId,
          askAfterStep: asks.joinedAfterStep,
          turnStatus: turns.status,
          turnModel: turns.model,
          turnEffort: turns.reasoningEffort,
          turnUsage: turns.usage,
          turnFailure: turns.failure,
          turnFastRefused: turns.fastRefused,
        },
        {
          placedAt: messages.placedAt,
          finishedAt: messages.finishedAt,
          turnStartedAt: sql`coalesce(${turns.startedAt}, ${turns.queuedAt})`,
        },
      ),
      seq: asNumber(sql`${messages.seq}`).as("seq"),
      partCount: sql<number>`(
        select count(*)::int from jsonb_array_elements(${messages.parts}) as held(value)
        where not ${retired(sql`held.value`)}
      )`.as("partCount"),
    })
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
    .leftJoin(
      asks,
      and(
        eq(asks.userId, messages.userId),
        eq(asks.conversationId, messages.conversationId),
        eq(asks.clientId, sql`${messages.metadata}->>'delegation_id'`),
        isNotNull(asks.turnId),
      ),
    )
    .leftJoin(turns, and(eq(turns.id, messages.turnId), eq(turns.userId, messages.userId)))
    .where(
      and(
        eq(messages.conversationId, target.conversationId),
        eq(messages.userId, target.userId),
        reached,
      ),
    )
    .orderBy(desc(messages.seq))
    .limit(TRANSCRIPT_WINDOW);
  return Option.all({
    window: liveStatementOf(window),
    windowParts: liveStatementOf(windowPartsOf(target, reached)),
  });
}

/**
 * The condition that `readerId` may follow the transcripts under the coding
 * agent whose conversation is `parentConversationId`, which `ownerId`
 * started: it is a member of the agent's workspace. Joined in each statement,
 * so it stays live.
 */
export function agentFollowedBy(
  ownerId: string,
  parentConversationId: string,
  readerId: string,
): SQL {
  return exists(
    queryBuilder
      .select({ one: codingAgent.id })
      .from(codingAgent)
      .where(
        and(
          eq(codingAgent.conversationId, parentConversationId),
          eq(codingAgent.userId, ownerId),
          agentReachableBy(readerId),
        ),
      ),
  );
}

/**
 * The statements the transcript of `target`'s conversation is followed by,
 * under the conversation `parentConversationId`: an agent's own, where the
 * two are the same, or one of its workers', while `reached` holds, the
 * reader's membership of the workspace the transcript belongs to
 * (`agentFollowedBy`). None where a statement names a value Realtime cannot
 * carry.
 */
export function transcriptLiveStatements(
  target: ConversationTarget,
  parentConversationId: string,
  reached: SQL,
): Option.Option<TranscriptLiveStatements> {
  const { userId, conversationId } = target;
  const written = queryBuilder
    .select({
      rows: LIVE_COUNT.as("rows"),
      seq: asNumber(sql`coalesce(max(${messages.seq}), 0)`).as("seq"),
    })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.userId, userId), reached));
  const run = queryBuilder
    .select({
      ...liveSelection({ status: turns.status }),
      rows: LIVE_COUNT.as("rows"),
      stopped: sql<number>`count(${turns.cancelRequestedAt})::int`.as("stopped"),
      changedAt: liveLatest(TURN_CHANGED).as("changedAt"),
    })
    .from(turns)
    .where(and(eq(turns.conversationId, conversationId), eq(turns.userId, userId), reached))
    .groupBy(turns.status);
  const conversation = queryBuilder
    .select({
      ...liveSelection({ id: conversations.id, title: conversations.title }),
      revision: asNumber(sql`${conversations.journalRevision}`).as("revision"),
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.userId, userId),
        isNull(conversations.deletedAt),
        reached,
      ),
    );
  const agent = queryBuilder
    .select(liveSelection({ id: codingAgent.id, title: codingAgent.title }))
    .from(codingAgent)
    .where(
      and(
        eq(codingAgent.conversationId, parentConversationId),
        eq(codingAgent.userId, userId),
        reached,
      ),
    );
  const workers = queryBuilder
    .select(
      liveSelection({
        id: conversations.id,
        title: conversations.title,
        callId: codingAgentDelegation.callId,
      }),
    )
    .from(conversations)
    .leftJoin(
      codingAgentDelegation,
      eq(codingAgentDelegation.childConversationId, conversations.id),
    )
    .where(
      and(
        eq(conversations.parentConversationId, parentConversationId),
        eq(conversations.userId, userId),
        isNull(conversations.deletedAt),
        reached,
      ),
    );
  return Option.all({
    messages: liveStatementOf(written),
    turns: liveStatementOf(run),
    conversation: liveStatementOf(conversation),
    agent: liveStatementOf(agent),
    workers: liveStatementOf(workers),
  }).pipe(
    Option.flatMap((statements) =>
      Option.map(transcriptWindowLiveStatements(target, reached), (window) => ({
        ...statements,
        ...window,
      })),
    ),
  );
}
