import { INBOX_ASK_STATUS, INBOX_STATUS } from "@repo/features/inbox-wire";
import { TASK_STATUS, type TaskStatus } from "@repo/features/task-wire";
import {
  type AnyColumn,
  and,
  desc,
  eq,
  getTableName,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import type { AnyPgTable } from "drizzle-orm/pg-core";
import { Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { inboxItem } from "../schemas/inbox.js";
import { inboxMessage } from "../schemas/inbox-message.js";
import { task } from "../schemas/task.js";

type SettleEffect<A> = Effect.Effect<A, QueryError | Schema.SchemaError, DatabaseServices>;

export const INBOX_SETTLED_REASON = {
  TASK_DONE: "Its task is done.",
  TASK_CANCELED: "Its task was canceled.",
  AGENT_ARCHIVED: "Its agent was archived.",
} as const;

export type InboxSettledReason = (typeof INBOX_SETTLED_REASON)[keyof typeof INBOX_SETTLED_REASON];

function taskSettledReason(status: TaskStatus): InboxSettledReason | undefined {
  if (status === TASK_STATUS.DONE) return INBOX_SETTLED_REASON.TASK_DONE;
  if (status === TASK_STATUS.CANCELED) return INBOX_SETTLED_REASON.TASK_CANCELED;
  return undefined;
}

const SETTLE_BY = { TASK: "task", AGENTS: "agents" } as const;

const SettleRequestSchema = Schema.Struct({
  by: Schema.Literals(Object.values(SETTLE_BY)),
  ids: Schema.Array(Schema.String),
  reason: Schema.String,
  now: Schema.Date,
});

const closeOpenItems = SqlSchema.findAll({
  Request: SettleRequestSchema,
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ by, ids, reason, now }) =>
    Database.use((db) =>
      db
        .update(inboxItem)
        .set({
          status: INBOX_STATUS.CLOSED,
          closedReason: reason,
          closedBy: null,
          settledAt: now,
          openAskMessageId: null,
        })
        .where(
          and(
            by === SETTLE_BY.TASK
              ? inArray(inboxItem.taskId, ids)
              : inArray(inboxItem.agentId, ids),
            eq(inboxItem.status, INBOX_STATUS.OPEN),
            or(isNotNull(inboxItem.openAskMessageId), eq(inboxItem.needsReply, true)),
          ),
        )
        .returning({ id: inboxItem.id }),
    ),
});

const withdrawOpenAsks = SqlSchema.void({
  Request: Schema.Struct({
    itemIds: Schema.Array(Schema.String),
    reason: Schema.String,
    now: Schema.Date,
  }),
  execute: ({ itemIds, reason, now }) =>
    Database.use((db) =>
      db
        .update(inboxMessage)
        .set({
          ask: sql`${inboxMessage.ask} || jsonb_build_object('status', ${INBOX_ASK_STATUS.WITHDRAWN}::text, 'withdrawnReason', ${reason}::text, 'withdrawnAt', ${now.getTime()}::bigint)`,
        })
        .where(
          and(
            inArray(inboxMessage.itemId, itemIds),
            sql`${inboxMessage.ask} ->> 'status' = ${INBOX_ASK_STATUS.OPEN}`,
          ),
        ),
    ),
});

function settle(
  by: (typeof SETTLE_BY)[keyof typeof SETTLE_BY],
  ids: readonly string[],
  reason: InboxSettledReason,
  now: Date,
): SettleEffect<number> {
  if (ids.length === 0) return Effect.succeed(0);
  return Effect.gen(function* () {
    const closed = yield* closeOpenItems({ by, ids, reason, now });
    if (closed.length === 0) return 0;
    yield* withdrawOpenAsks({ itemIds: closed.map(({ id }) => id), reason, now });
    return closed.length;
  });
}

export function settleTaskInboxItems(
  taskId: string,
  status: TaskStatus,
  now: Date,
): SettleEffect<number> {
  const reason = taskSettledReason(status);
  return reason === undefined ? Effect.succeed(0) : settle(SETTLE_BY.TASK, [taskId], reason, now);
}

export function settleAgentInboxItems(
  agentIds: readonly string[],
  now: Date,
): SettleEffect<number> {
  return settle(SETTLE_BY.AGENTS, agentIds, INBOX_SETTLED_REASON.AGENT_ARCHIVED, now);
}

function qualified(table: AnyPgTable, column: AnyColumn) {
  return sql`${sql.identifier(getTableName(table))}.${sql.identifier(column.name)}`;
}

const ITEM_AGENT = qualified(inboxItem, inboxItem.agentId);
const ITEM_TASK = qualified(inboxItem, inboxItem.taskId);
const AGENT_ID = qualified(agentTable, agentTable.id);
const AGENT_ARCHIVED_AT = qualified(agentTable, agentTable.archivedAt);
const TASK_ID = qualified(task, task.id);
const TASK_STATUS_COLUMN = qualified(task, task.status);
const TASK_COMPLETED_AT = qualified(task, task.completedAt);

const AGENT_STILL_ARCHIVED = sql`exists (select 1 from ${agentTable} where ${AGENT_ID} = ${ITEM_AGENT} and ${AGENT_ARCHIVED_AT} is not null)`;

const TASK_STILL_SETTLED = sql`exists (select 1 from ${task} where ${TASK_ID} = ${ITEM_TASK} and ${TASK_STATUS_COLUMN} in (${TASK_STATUS.DONE}, ${TASK_STATUS.CANCELED}) and ${TASK_COMPLETED_AT} is not null)`;

function settledBy({ by, ids, reason, now }: typeof SettleRequestSchema.Type) {
  return and(
    by === SETTLE_BY.TASK ? inArray(inboxItem.taskId, ids) : inArray(inboxItem.agentId, ids),
    eq(inboxItem.status, INBOX_STATUS.CLOSED),
    isNull(inboxItem.closedBy),
    eq(inboxItem.closedReason, reason),
    eq(inboxItem.settledAt, now),
  );
}

const lockOtherActRows = SqlSchema.void({
  Request: SettleRequestSchema,
  execute: (request) =>
    Database.use((db) => {
      const settled = (column: typeof inboxItem.agentId | typeof inboxItem.taskId) =>
        db.select({ id: column }).from(inboxItem).where(settledBy(request));
      return request.by === SETTLE_BY.TASK
        ? db
            .select({ id: agentTable.id })
            .from(agentTable)
            .where(inArray(agentTable.id, settled(inboxItem.agentId)))
            .for("share")
        : db
            .select({ id: task.id })
            .from(task)
            .where(inArray(task.id, settled(inboxItem.taskId)))
            .for("share");
    }),
});

const handOverSettledItems = SqlSchema.findAll({
  Request: SettleRequestSchema,
  Result: Schema.Struct({
    id: Schema.String,
    reason: Schema.String,
    settledAt: Schema.NullOr(Schema.Number),
  }),
  execute: (request) =>
    Database.use((db) =>
      db
        .update(inboxItem)
        .set(
          request.by === SETTLE_BY.TASK
            ? {
                closedReason: INBOX_SETTLED_REASON.AGENT_ARCHIVED,
                settledAt: sql`(select ${AGENT_ARCHIVED_AT} from ${agentTable} where ${AGENT_ID} = ${ITEM_AGENT})`,
              }
            : {
                closedReason: sql`(select case ${TASK_STATUS_COLUMN} when ${TASK_STATUS.DONE} then ${INBOX_SETTLED_REASON.TASK_DONE}::text else ${INBOX_SETTLED_REASON.TASK_CANCELED}::text end from ${task} where ${TASK_ID} = ${ITEM_TASK})`,
                settledAt: sql`(select ${TASK_COMPLETED_AT} from ${task} where ${TASK_ID} = ${ITEM_TASK})`,
              },
        )
        .where(
          and(
            settledBy(request),
            request.by === SETTLE_BY.TASK ? AGENT_STILL_ARCHIVED : TASK_STILL_SETTLED,
          ),
        )
        .returning({
          id: inboxItem.id,
          reason: sql<string>`${inboxItem.closedReason}`,
          settledAt: sql<
            number | null
          >`(extract(epoch from ${inboxItem.settledAt}) * 1000)::float8`,
        }),
    ),
});

const rewordWithdrawnAsk = SqlSchema.void({
  Request: Schema.Struct({
    messageId: Schema.String,
    reason: Schema.String,
    at: Schema.NullOr(Schema.Number),
  }),
  execute: ({ messageId, reason, at }) =>
    Database.use((db) =>
      db
        .update(inboxMessage)
        .set({
          ask: sql`${inboxMessage.ask} || jsonb_strip_nulls(jsonb_build_object('withdrawnReason', ${reason}::text, 'withdrawnAt', ${at}::bigint))`,
        })
        .where(eq(inboxMessage.id, messageId)),
    ),
});

const reopenSettledItems = SqlSchema.findAll({
  Request: SettleRequestSchema,
  Result: Schema.Struct({ id: Schema.String }),
  execute: (request) =>
    Database.use((db) =>
      db
        .update(inboxItem)
        .set({ status: INBOX_STATUS.OPEN, closedReason: null, settledAt: null })
        .where(settledBy(request))
        .returning({ id: inboxItem.id }),
    ),
});

const findLatestAsks = SqlSchema.findAll({
  Request: Schema.Struct({ itemIds: Schema.Array(Schema.String) }),
  Result: Schema.Struct({
    id: Schema.String,
    itemId: Schema.String,
    status: Schema.NullOr(Schema.String),
    withdrawnReason: Schema.NullOr(Schema.String),
  }),
  execute: ({ itemIds }) =>
    Database.use((db) =>
      db
        .selectDistinctOn([inboxMessage.itemId], {
          id: inboxMessage.id,
          itemId: inboxMessage.itemId,
          status: sql<string | null>`${inboxMessage.ask} ->> 'status'`,
          withdrawnReason: sql<string | null>`${inboxMessage.ask} ->> 'withdrawnReason'`,
        })
        .from(inboxMessage)
        .where(and(inArray(inboxMessage.itemId, itemIds), isNotNull(inboxMessage.ask)))
        .orderBy(inboxMessage.itemId, desc(inboxMessage.createdAt), desc(inboxMessage.id)),
    ),
});

const reopenAsk = SqlSchema.void({
  Request: Schema.Struct({ messageId: Schema.String, itemId: Schema.String }),
  execute: ({ messageId, itemId }) =>
    Effect.andThen(
      Database.use((db) =>
        db
          .update(inboxMessage)
          .set({
            ask: sql`(${inboxMessage.ask} - 'withdrawnReason' - 'withdrawnAt') || jsonb_build_object('status', ${INBOX_ASK_STATUS.OPEN}::text)`,
          })
          .where(eq(inboxMessage.id, messageId)),
      ),
      Database.use((db) =>
        db.update(inboxItem).set({ openAskMessageId: messageId }).where(eq(inboxItem.id, itemId)),
      ),
    ),
});

function reopen(
  by: (typeof SETTLE_BY)[keyof typeof SETTLE_BY],
  ids: readonly string[],
  reason: InboxSettledReason,
  settledAt: Date,
): SettleEffect<number> {
  if (ids.length === 0) return Effect.succeed(0);
  return Effect.gen(function* () {
    const request = { by, ids, reason, now: settledAt };
    yield* lockOtherActRows(request);
    const handed = yield* handOverSettledItems(request);
    if (handed.length > 0) {
      const latest = yield* findLatestAsks({ itemIds: handed.map(({ id }) => id) });
      const handedTo = new Map(handed.map((item) => [item.id, item]));
      yield* Effect.forEach(
        latest.filter(
          (ask) => ask.status === INBOX_ASK_STATUS.WITHDRAWN && ask.withdrawnReason === reason,
        ),
        (ask) => {
          const to = handedTo.get(ask.itemId);
          return rewordWithdrawnAsk({
            messageId: ask.id,
            reason: to?.reason ?? reason,
            at: to?.settledAt ?? null,
          });
        },
        { discard: true },
      );
    }
    const reopened = yield* reopenSettledItems(request);
    if (reopened.length === 0) return 0;
    const latest = yield* findLatestAsks({ itemIds: reopened.map(({ id }) => id) });
    const withdrawn = latest.filter(
      (ask) => ask.status === INBOX_ASK_STATUS.WITHDRAWN && ask.withdrawnReason === reason,
    );
    yield* Effect.forEach(
      withdrawn,
      (ask) => reopenAsk({ messageId: ask.id, itemId: ask.itemId }),
      {
        discard: true,
      },
    );
    return reopened.length;
  });
}

export function reopenTaskInboxItems(
  taskId: string,
  standing: TaskStatus,
  completedAt: Date,
): SettleEffect<number> {
  const reason = taskSettledReason(standing);
  return reason === undefined
    ? Effect.succeed(0)
    : reopen(SETTLE_BY.TASK, [taskId], reason, completedAt);
}

export function reopenAgentInboxItems(agentId: string, archivedAt: Date): SettleEffect<number> {
  return reopen(SETTLE_BY.AGENTS, [agentId], INBOX_SETTLED_REASON.AGENT_ARCHIVED, archivedAt);
}
