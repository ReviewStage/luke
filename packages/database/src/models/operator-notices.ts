/**
 * operator-notices.ts -- the notices an operator reads of its member's agents on its next turn, and the hour a failure's wake holds.
 *
 * A member's operator watches their own agents of its workspace, every
 * `coding_agent` of the operator's workspace and member but an operator,
 * those the operator started among them and a teammate's never, through
 * notices (`../schemas/operator-notice.ts`). A notice is written only where
 * that member has a standing operator, in the one statement that finds it,
 * so a member without one is written nothing. A repeat event while its
 * notice is unread moves the notice's `at` rather than adding one, so the
 * desk reads at most one row per agent and kind.
 *
 * The desk reads the unread notices newest first and marks read those it
 * handed (`markOperatorNoticesRead`), only where nothing moved them since it
 * read them, so an event that landed between the read and the mark is not
 * lost. A failure that no wake answered within the hour before it is a wake
 * due (`dueOperatorWakes`); the wake is recorded only once it landed
 * (`recordOperatorWake`), so a wake that failed is tried again and holds
 * nothing.
 */

import { CODING_AGENT_KIND } from "@luke/features/coding-agent-wire";
import { and, asc, desc, eq, gte, isNull, lte, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError } from "../core/query.js";
import { codingAgent } from "../schemas/coding-agent.js";
import { operatorNotice, operatorWake } from "../schemas/operator-notice.js";
import { OPERATOR_NOTICE_KIND, type OperatorNoticeKind } from "../storage-vocabulary.js";
import { agentAutomationNameSql } from "./agent-name.js";

type NoticeEffect<A> = Effect.Effect<A, QueryError | Schema.SchemaError, DatabaseServices>;

/** The agent a notice is about: by its id, or by the conversation it is. */
export type NoticedAgent =
  | { readonly agentId: string; readonly conversationId?: undefined }
  | { readonly conversationId: string; readonly agentId?: undefined };

const NoticeKindSchema = Schema.Literals(Object.values(OPERATOR_NOTICE_KIND));

/** The operator standing over the agent's member in its workspace, as the notice's insert joins it. */
const operatorOf = alias(codingAgent, "operator");

/** How the notice's insert finds its agent: by the agent's id, or by its conversation's. */
const NOTICED_BY = { AGENT: "agent", CONVERSATION: "conversation" } as const;

const upsertNotice = SqlSchema.void({
  Request: Schema.Struct({
    by: Schema.Literals(Object.values(NOTICED_BY)),
    id: Schema.String,
    kind: NoticeKindSchema,
    at: Schema.Date,
  }),
  execute: ({ by, id, kind, at }) =>
    Database.use((db) =>
      db
        .insert(operatorNotice)
        .select((qb) =>
          qb
            .select({
              operatorId: sql<string>`${operatorOf.id}`.as("operator_id"),
              kind: sql<OperatorNoticeKind>`${kind}`.as("kind"),
              agentId: sql<string>`${codingAgent.id}`.as("agent_id"),
              taskId: sql<string | null>`${codingAgent.taskId}`.as("task_id"),
              at: sql<Date>`${at}::timestamptz`.as("at"),
            })
            .from(codingAgent)
            .innerJoin(
              operatorOf,
              and(
                eq(operatorOf.organizationId, codingAgent.organizationId),
                eq(operatorOf.userId, codingAgent.userId),
                eq(operatorOf.kind, CODING_AGENT_KIND.OPERATOR),
                isNull(operatorOf.archivedAt),
              ),
            )
            .where(
              and(
                by === NOTICED_BY.AGENT
                  ? eq(codingAgent.id, id)
                  : eq(codingAgent.conversationId, id),
                ne(codingAgent.kind, CODING_AGENT_KIND.OPERATOR),
              ),
            ),
        )
        .onConflictDoUpdate({
          target: [operatorNotice.operatorId, operatorNotice.agentId, operatorNotice.kind],
          targetWhere: sql`${operatorNotice.readAt} is null`,
          set: { at: sql`greatest(${operatorNotice.at}, excluded.at)` },
        }),
    ),
});

/** One unread notice as the desk reads it, with the agent it is about as its row names it. */
const UnreadNoticeSchema = Schema.Struct({
  id: Schema.String,
  kind: NoticeKindSchema,
  agentId: Schema.String,
  taskId: Schema.NullOr(Schema.String),
  at: Schema.Date,
  agentKind: Schema.Literals(Object.values(CODING_AGENT_KIND)),
  agentTitle: Schema.NullOr(Schema.String),
  agentModel: Schema.String,
  agentAutomationName: Schema.NullOr(Schema.String),
});

export type UnreadOperatorNotice = typeof UnreadNoticeSchema.Type;

const findUnread = SqlSchema.findAll({
  Request: Schema.Struct({ operatorId: Schema.String, limit: Schema.Int }),
  Result: UnreadNoticeSchema,
  execute: ({ operatorId, limit }) =>
    Database.use((db) =>
      db
        .select({
          id: operatorNotice.id,
          kind: operatorNotice.kind,
          agentId: operatorNotice.agentId,
          taskId: operatorNotice.taskId,
          at: operatorNotice.at,
          agentKind: codingAgent.kind,
          agentTitle: codingAgent.title,
          agentModel: codingAgent.model,
          agentAutomationName: agentAutomationNameSql(codingAgent),
        })
        .from(operatorNotice)
        .innerJoin(codingAgent, eq(codingAgent.id, operatorNotice.agentId))
        .where(and(eq(operatorNotice.operatorId, operatorId), isNull(operatorNotice.readAt)))
        .orderBy(desc(operatorNotice.at), desc(operatorNotice.id))
        .limit(limit),
    ),
});

const updateRead = SqlSchema.void({
  Request: Schema.Struct({
    operatorId: Schema.String,
    notices: Schema.Array(Schema.Struct({ id: Schema.String, at: Schema.Date })),
    readAt: Schema.Date,
  }),
  execute: ({ operatorId, notices, readAt }) =>
    Database.use((db) =>
      db
        .update(operatorNotice)
        .set({ readAt })
        .where(
          and(
            eq(operatorNotice.operatorId, operatorId),
            isNull(operatorNotice.readAt),
            or(
              ...notices.map(({ id, at }) =>
                and(eq(operatorNotice.id, id), eq(operatorNotice.at, at)),
              ),
            ),
          ),
        ),
    ),
});

/** One failure a wake is due for: the notice, its operator and the member it is, and the agent that failed. */
const DueWakeSchema = Schema.Struct({
  noticeId: Schema.String,
  at: Schema.Date,
  operatorId: Schema.String,
  userId: Schema.String,
  organizationId: Schema.String,
  agentId: Schema.String,
  taskId: Schema.NullOr(Schema.String),
  agentKind: Schema.Literals(Object.values(CODING_AGENT_KIND)),
  agentTitle: Schema.NullOr(Schema.String),
  agentModel: Schema.String,
  agentAutomationName: Schema.NullOr(Schema.String),
});

export type DueOperatorWake = typeof DueWakeSchema.Type;

/** The agent that failed, as a due wake's join names it apart from the operator. */
const failedAgent = alias(codingAgent, "failed_agent");

const findDueWakes = SqlSchema.findAll({
  Request: Schema.Struct({ since: Schema.Date, holdMs: Schema.Int, limit: Schema.Int }),
  Result: DueWakeSchema,
  execute: ({ since, holdMs, limit }) =>
    Database.use((db) =>
      db
        .select({
          noticeId: operatorNotice.id,
          at: operatorNotice.at,
          operatorId: operatorNotice.operatorId,
          userId: operatorOf.userId,
          organizationId: operatorOf.organizationId,
          agentId: operatorNotice.agentId,
          taskId: operatorNotice.taskId,
          agentKind: failedAgent.kind,
          agentTitle: failedAgent.title,
          agentModel: failedAgent.model,
          agentAutomationName: agentAutomationNameSql(failedAgent),
        })
        .from(operatorNotice)
        .innerJoin(operatorOf, eq(operatorOf.id, operatorNotice.operatorId))
        .innerJoin(failedAgent, eq(failedAgent.id, operatorNotice.agentId))
        .leftJoin(
          operatorWake,
          and(
            eq(operatorWake.operatorId, operatorNotice.operatorId),
            eq(operatorWake.agentId, operatorNotice.agentId),
          ),
        )
        .where(
          and(
            eq(operatorNotice.kind, OPERATOR_NOTICE_KIND.TURN_FAILED),
            isNull(operatorNotice.readAt),
            gte(operatorNotice.at, since),
            isNull(operatorOf.archivedAt),
            or(
              isNull(operatorWake.id),
              lte(
                operatorWake.wokenAt,
                sql`${operatorNotice.at} - (${holdMs} * interval '1 millisecond')`,
              ),
            ),
          ),
        )
        .orderBy(asc(operatorNotice.at), asc(operatorNotice.id))
        .limit(limit),
    ),
});

const upsertWake = SqlSchema.void({
  Request: Schema.Struct({
    operatorId: Schema.String,
    agentId: Schema.String,
    wokenAt: Schema.Date,
  }),
  execute: ({ operatorId, agentId, wokenAt }) =>
    Database.use((db) =>
      db
        .insert(operatorWake)
        .values({ operatorId, agentId, wokenAt })
        .onConflictDoUpdate({
          target: [operatorWake.operatorId, operatorWake.agentId],
          set: { wokenAt: sql`greatest(${operatorWake.wokenAt}, excluded.woken_at)` },
        }),
    ),
});

/**
 * Notes the event of the kind given for the agent at `at`, for the operator
 * standing over its member in its workspace: a fresh unread notice, or the
 * unread one of that kind moved to `at`. Writes nothing for an operator's
 * own events, or where its member has no standing operator.
 */
export function writeOperatorNotice(
  agent: NoticedAgent,
  kind: OperatorNoticeKind,
  at: Date,
): NoticeEffect<void> {
  const found =
    agent.agentId !== undefined
      ? { by: NOTICED_BY.AGENT, id: agent.agentId }
      : { by: NOTICED_BY.CONVERSATION, id: agent.conversationId };
  return upsertNotice({ ...found, kind, at });
}

/** The operator's unread notices, newest first and at most `limit`, each with its agent's names. */
export function unreadOperatorNotices(
  operatorId: string,
  limit: number,
): NoticeEffect<readonly UnreadOperatorNotice[]> {
  return findUnread({ operatorId, limit });
}

/**
 * Marks read, at `readAt`, the operator's notices named that still stand as
 * they were read: one a later event moved since stays unread, so the desk
 * hands it again.
 */
export function markOperatorNoticesRead(
  operatorId: string,
  notices: readonly Pick<UnreadOperatorNotice, "id" | "at">[],
  readAt: Date,
): NoticeEffect<void> {
  if (notices.length === 0) return Effect.void;
  return updateRead({
    operatorId,
    notices: notices.map(({ id, at }) => ({ id, at })),
    readAt,
  });
}

/**
 * The failures a wake is due for, the oldest first and at most `limit`: an
 * unread failure notice of a standing operator's, no older than `since`,
 * whose agent no wake answered within `holdMs` before the failure. A wake
 * that landed after the failure answers it, so each is due once; one older
 * than `since` is left to the operator's next turn, so a wake that keeps
 * failing is not tried for ever.
 */
export function dueOperatorWakes(
  since: Date,
  holdMs: number,
  limit: number,
): NoticeEffect<readonly DueOperatorWake[]> {
  return findDueWakes({ since, holdMs, limit });
}

/** Records that a wake for the agent's failure reached its operator at `wokenAt`. */
export function recordOperatorWake(
  operatorId: string,
  agentId: string,
  wokenAt: Date,
): NoticeEffect<void> {
  return upsertWake({ operatorId, agentId, wokenAt });
}
