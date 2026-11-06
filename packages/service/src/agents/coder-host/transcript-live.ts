import {
  LIVE_COUNT,
  type LiveStatement,
  liveLatest,
  liveSelection,
  liveStatementOf,
} from "@repo/database/core/live-statement";
import { queryBuilder } from "@repo/database/core/query";
import type { MessageCursor } from "@repo/database/models/message-reads";
import { agentVisibleTo } from "@repo/database/models/workspace-store";
import type { ConversationTarget } from "@repo/database/models/writer";
import { agentDelegationTable, agentTable } from "@repo/database/schemas/agent";
import { agentQueue } from "@repo/database/schemas/agent-queue";
import { user } from "@repo/database/schemas/auth";
import { deviceAgentLine } from "@repo/database/schemas/device-agent";
import { conversations, messages, standingLine, turns } from "@repo/database/schemas/storage";
import { AGENT_BOUNDS, PART_CUT_FIELD } from "@repo/features/agent-wire";
import { DEVICE_AGENT_LINE_KIND } from "@repo/features/device-agent-wire";
import { TRANSCRIPT_WINDOW } from "@repo/features/transcript-window";
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
import { Option } from "effect";
import { CUT_END_CHARS, CUT_TOOLS, REASONING_PART_TYPE } from "./part-cut.js";
import { CODER_TOOL_SET } from "./tool-set.js";

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
  readonly queueRevision: LiveStatement;
  readonly launch: LiveStatement;
}

const asNumber = (value: SQL): SQL<number> => sql<number>`(${value})::float8`;

const TURN_CHANGED = sql`greatest(
  ${turns.queuedAt},
  coalesce(${turns.startedAt}, ${turns.queuedAt}),
  coalesce(${turns.settledAt}, ${turns.queuedAt}),
  coalesce(${turns.cancelRequestedAt}, ${turns.queuedAt})
)`;

const takingJournal = alias(messages, "taking_journal");
const sendingAgent = alias(agentTable, "sending_agent");

const windowMessage = alias(messages, "window_message");

const pastCursor = (
  row: { readonly seq: AnyPgColumn; readonly revision: AnyPgColumn },
  past: MessageCursor | undefined,
): SQL | undefined =>
  past === undefined ? undefined : or(gt(row.seq, past.seq), gt(row.revision, past.revision));

const CUT_TOOL_TYPES = sql.join(
  [...CUT_TOOLS].map((tool) => sql`${`tool-${tool}`}`),
  sql`, `,
);

const HELD_TOOLS = Object.keys(CODER_TOOL_SET).join(" ");

const retired = (element: SQL) => sql`(${element}->>'type' like 'tool-%'
  and substr(${element}->>'type', 6) <> all(string_to_array(${HELD_TOOLS}, ' ')))`;

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

export function transcriptWindowLiveStatements(
  target: ConversationTarget,
  reached: SQL,
  past?: MessageCursor,
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
          automationId: messages.senderAutomationId,
          journalId: takingJournal.id,
          afterStep: messages.takenAfterStep,
          askTurnId: sql<string | null>`null::text`,
          askAfterStep: sql<number | null>`null::integer`,
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
    .leftJoin(turns, and(eq(turns.id, messages.turnId), eq(turns.userId, messages.userId)))
    .where(
      and(
        eq(messages.conversationId, target.conversationId),
        eq(messages.userId, target.userId),
        standingLine(messages),
        pastCursor(messages, past),
        reached,
      ),
    )
    .orderBy(desc(messages.seq))
    .limit(TRANSCRIPT_WINDOW);
  return Option.all({
    window: liveStatementOf(window),
    windowParts: liveStatementOf(windowPartsOf(target, reached, past)),
  });
}

export function agentFollowedBy(
  ownerId: string,
  parentConversationId: string,
  readerId: string,
): SQL {
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

export function transcriptLiveStatements(
  target: ConversationTarget,
  parentConversationId: string,
  reached: SQL,
  past?: MessageCursor,
): Option.Option<TranscriptLiveStatements> {
  const { userId, conversationId } = target;
  const written = queryBuilder
    .select({
      rows: LIVE_COUNT.as("rows"),
      seq: asNumber(sql`coalesce(max(${messages.seq}), 0)`).as("seq"),
    })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.userId, userId),
        standingLine(messages),
        reached,
      ),
    );
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
    .select(liveSelection({ id: agentTable.id, title: agentTable.title }))
    .from(agentTable)
    .where(
      and(
        eq(agentTable.conversationId, parentConversationId),
        eq(agentTable.userId, userId),
        reached,
      ),
    );
  const workers = queryBuilder
    .select(
      liveSelection({
        id: conversations.id,
        title: conversations.title,
        callId: agentDelegationTable.callId,
      }),
    )
    .from(conversations)
    .leftJoin(agentDelegationTable, eq(agentDelegationTable.childConversationId, conversations.id))
    .where(
      and(
        eq(conversations.parentConversationId, parentConversationId),
        eq(conversations.userId, userId),
        isNull(conversations.deletedAt),
        reached,
      ),
    );
  const queueRevision = queryBuilder
    .select({ revision: agentQueue.revision })
    .from(agentQueue)
    .innerJoin(agentTable, eq(agentTable.id, agentQueue.agentId))
    .where(
      and(
        eq(agentTable.conversationId, parentConversationId),
        eq(agentTable.userId, userId),
        reached,
      ),
    );
  const launch = queryBuilder
    .select(
      liveSelection({
        id: deviceAgentLine.id,
        step: deviceAgentLine.launchStep,
        claimed: sql<boolean>`${deviceAgentLine.claimedAt} is not null`,
        settled: sql<boolean>`${deviceAgentLine.settledAt} is not null`,
      }),
    )
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
    .limit(1);
  return Option.all({
    messages: liveStatementOf(written),
    turns: liveStatementOf(run),
    conversation: liveStatementOf(conversation),
    agent: liveStatementOf(agent),
    workers: liveStatementOf(workers),
    queueRevision: liveStatementOf(queueRevision),
    launch: liveStatementOf(launch),
  }).pipe(
    Option.flatMap((statements) =>
      Option.map(transcriptWindowLiveStatements(target, reached, past), (window) => ({
        ...statements,
        ...window,
      })),
    ),
  );
}
