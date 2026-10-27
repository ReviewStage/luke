/**
 * inbox-settle.ts -- the inbox items whose reason is gone settled on their own: their task's work done or canceled, or their agent archived.
 *
 * An item waits on the developer for as long as its task's work does. A
 * task moved to Done or Canceled, by a member or by Luke's own finish, and
 * an agent archived, by whoever archives it, close every open item of
 * theirs, a question and a post alike, in the same transaction as the write
 * that moved them, so no caller has to remember it: each store write that
 * moves a task to a settled status or stamps an agent archived settles here.
 * The close reads as the agent's own, with why (`INBOX_SETTLED_REASON`), and
 * withdraws the ask the item held open with the same why. Nothing is
 * deleted, nothing is sent to the agent, and nothing moves the item's last
 * change, so a settled item keeps its place and stays read for whoever had
 * read it. The act's opposite reverses it: an agent brought back from an
 * archive, and a task a member moves off Done or Canceled to work again,
 * open again exactly the items that archive or that move settled, keyed on
 * the act's own stamp (the agent's `archived_at`, the task's
 * `completed_at`), the instant it wrote both the act and the settle, each
 * holding open again the ask it withdrew, and nothing a settle before or
 * since closed. An item the other act still settles, its agent still
 * archived or its task still Done or Canceled, stays settled and is handed
 * to that act instead, its reason and stamp, so undoing that act in turn
 * opens it. A task Luke reopens on its own, as a turn starting on it does
 * (`beginTaskWork`), opens nothing; only the agent's own post under the
 * item's key does.
 */

import { INBOX_ASK_STATUS, INBOX_STATUS } from "@luke/features/inbox-wire";
import { TASK_STATUS, type TaskStatus } from "@luke/features/task-wire";
import {
  type AnyColumn,
  and,
  desc,
  eq,
  getTableName,
  inArray,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";
import type { AnyPgTable } from "drizzle-orm/pg-core";
import { Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError } from "../core/query.js";
import { codingAgent } from "../schemas/coding-agent.js";
import { inboxItem } from "../schemas/inbox.js";
import { inboxMessage } from "../schemas/inbox-message.js";
import { task } from "../schemas/task.js";

type SettleEffect<A> = Effect.Effect<A, QueryError | Schema.SchemaError, DatabaseServices>;

/** Why an item settled on its own, as its close and its withdrawn ask say it. */
export const INBOX_SETTLED_REASON = {
  TASK_DONE: "Its task is done.",
  TASK_CANCELED: "Its task was canceled.",
  AGENT_ARCHIVED: "Its agent was archived.",
} as const;

export type InboxSettledReason = (typeof INBOX_SETTLED_REASON)[keyof typeof INBOX_SETTLED_REASON];

/** Why a task standing in `status` settles its items: Done's or Canceled's reason, none for a status its work is open in. */
function taskSettledReason(status: TaskStatus): InboxSettledReason | undefined {
  if (status === TASK_STATUS.DONE) return INBOX_SETTLED_REASON.TASK_DONE;
  if (status === TASK_STATUS.CANCELED) return INBOX_SETTLED_REASON.TASK_CANCELED;
  return undefined;
}

/** What an item settles by: every item of one task, or of some agents. */
const SETTLE_BY = { TASK: "task", AGENTS: "agents" } as const;

const SettleRequestSchema = Schema.Struct({
  by: Schema.Literals(Object.values(SETTLE_BY)),
  ids: Schema.Array(Schema.String),
  reason: Schema.String,
  now: Schema.Date,
});

/** The open items of the task or the agents closed with why and no ask held open; their ids. */
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
          ),
        )
        .returning({ id: inboxItem.id }),
    ),
});

/**
 * Every ask still kept open on the items named withdrawn with why. Note that
 * only the ask's standing keys are merged over it, as the inbox store's own
 * close writes them, so a deployment that does not know the ask's type keeps
 * the keys it does not read.
 */
const withdrawOpenAsks = SqlSchema.void({
  Request: Schema.Struct({ itemIds: Schema.Array(Schema.String), reason: Schema.String }),
  execute: ({ itemIds, reason }) =>
    Database.use((db) =>
      db
        .update(inboxMessage)
        .set({
          ask: sql`${inboxMessage.ask} || jsonb_build_object('status', ${INBOX_ASK_STATUS.WITHDRAWN}::text, 'withdrawnReason', ${reason}::text)`,
        })
        .where(
          and(
            inArray(inboxMessage.itemId, itemIds),
            sql`${inboxMessage.ask} ->> 'status' = ${INBOX_ASK_STATUS.OPEN}`,
          ),
        ),
    ),
});

/** The open items named settled, and their open asks withdrawn, with why; how many settled. */
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
    yield* withdrawOpenAsks({ itemIds: closed.map(({ id }) => id), reason });
    return closed.length;
  });
}

/** The task's open items settled, where it moved to Done or Canceled at `now`, its finish's stamp; nothing for a move to any other status. Run inside the transaction that moved it. */
export function settleTaskInboxItems(
  taskId: string,
  status: TaskStatus,
  now: Date,
): SettleEffect<number> {
  const reason = taskSettledReason(status);
  return reason === undefined ? Effect.succeed(0) : settle(SETTLE_BY.TASK, [taskId], reason, now);
}

/** The agents' open items settled, as their archive settles them; run inside the transaction that archived them. */
export function settleAgentInboxItems(
  agentIds: readonly string[],
  now: Date,
): SettleEffect<number> {
  return settle(SETTLE_BY.AGENTS, agentIds, INBOX_SETTLED_REASON.AGENT_ARCHIVED, now);
}

/** A column named by its table, for a subquery correlated with the item an update writes. */
function qualified(table: AnyPgTable, column: AnyColumn) {
  return sql`${sql.identifier(getTableName(table))}.${sql.identifier(column.name)}`;
}

const ITEM_AGENT = qualified(inboxItem, inboxItem.agentId);
const ITEM_TASK = qualified(inboxItem, inboxItem.taskId);
const AGENT_ID = qualified(codingAgent, codingAgent.id);
const AGENT_ARCHIVED_AT = qualified(codingAgent, codingAgent.archivedAt);
const TASK_ID = qualified(task, task.id);
const TASK_STATUS_COLUMN = qualified(task, task.status);
const TASK_COMPLETED_AT = qualified(task, task.completedAt);

/** Whether the item's agent stands archived: the other act that settles an item a task's settle closed. */
const AGENT_STILL_ARCHIVED = sql`exists (select 1 from ${codingAgent} where ${AGENT_ID} = ${ITEM_AGENT} and ${AGENT_ARCHIVED_AT} is not null)`;

/** Whether the item's task stands Done or Canceled: the other act that settles an item an archive closed. */
const TASK_STILL_SETTLED = sql`exists (select 1 from ${task} where ${TASK_ID} = ${ITEM_TASK} and ${TASK_STATUS_COLUMN} in (${TASK_STATUS.DONE}, ${TASK_STATUS.CANCELED}) and ${TASK_COMPLETED_AT} is not null)`;

/** The condition that the item is one the settle named closed: of the task or the agents, for its reason, at its stamp. */
function settledBy({ by, ids, reason, now }: typeof SettleRequestSchema.Type) {
  return and(
    by === SETTLE_BY.TASK ? inArray(inboxItem.taskId, ids) : inArray(inboxItem.agentId, ids),
    eq(inboxItem.status, INBOX_STATUS.CLOSED),
    isNull(inboxItem.closedBy),
    eq(inboxItem.closedReason, reason),
    eq(inboxItem.settledAt, now),
  );
}

/**
 * The items one settle closed that the other act still settles handed to
 * it, closed for its reason at its stamp: a task's to the archive of their
 * agent, an archive's to their task's Done or Canceled. Their ids and the
 * reason they now stand closed for.
 */
const handOverSettledItems = SqlSchema.findAll({
  Request: SettleRequestSchema,
  Result: Schema.Struct({ id: Schema.String, reason: Schema.String }),
  execute: (request) =>
    Database.use((db) =>
      db
        .update(inboxItem)
        .set(
          request.by === SETTLE_BY.TASK
            ? {
                closedReason: INBOX_SETTLED_REASON.AGENT_ARCHIVED,
                settledAt: sql`(select ${AGENT_ARCHIVED_AT} from ${codingAgent} where ${AGENT_ID} = ${ITEM_AGENT})`,
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
        .returning({ id: inboxItem.id, reason: sql<string>`${inboxItem.closedReason}` }),
    ),
});

/** The withdrawn ask of the message named made to say the reason its item was handed to. */
const rewordWithdrawnAsk = SqlSchema.void({
  Request: Schema.Struct({ messageId: Schema.String, reason: Schema.String }),
  execute: ({ messageId, reason }) =>
    Database.use((db) =>
      db
        .update(inboxMessage)
        .set({
          ask: sql`${inboxMessage.ask} || jsonb_build_object('withdrawnReason', ${reason}::text)`,
        })
        .where(eq(inboxMessage.id, messageId)),
    ),
});

/** The items of the task or the agents one settle closed, by its reason and its stamp, opened again with nothing settled on them; their ids. */
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

/** The latest message of each item named that carries an ask, the one an item's open ask always is. */
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

/** The ask of the message named open again, the why of its withdrawal taken off, and its item holding it open. */
const reopenAsk = SqlSchema.void({
  Request: Schema.Struct({ messageId: Schema.String, itemId: Schema.String }),
  execute: ({ messageId, itemId }) =>
    Effect.andThen(
      Database.use((db) =>
        db
          .update(inboxMessage)
          .set({
            ask: sql`(${inboxMessage.ask} - 'withdrawnReason') || jsonb_build_object('status', ${INBOX_ASK_STATUS.OPEN}::text)`,
          })
          .where(eq(inboxMessage.id, messageId)),
      ),
      Database.use((db) =>
        db.update(inboxItem).set({ openAskMessageId: messageId }).where(eq(inboxItem.id, itemId)),
      ),
    ),
});

/**
 * The items one settle closed opened again, as an undo of the act that
 * settled them does: only those it closed for `reason` at `settledAt`, the
 * act's own stamp, each holding open again the ask that settle withdrew.
 * Note that an item's open ask is always its latest asking message, since a
 * post replaces every ask before it, so the settle withdrew that one where
 * it withdrew any; one already replaced or answered, as a notice's latest
 * ask is, is left as it stands. An item the other act still settles is
 * handed to it first, its withdrawn ask saying that act's reason, and opens
 * nothing. Answers how many opened.
 */
function reopen(
  by: (typeof SETTLE_BY)[keyof typeof SETTLE_BY],
  ids: readonly string[],
  reason: InboxSettledReason,
  settledAt: Date,
): SettleEffect<number> {
  if (ids.length === 0) return Effect.succeed(0);
  return Effect.gen(function* () {
    const request = { by, ids, reason, now: settledAt };
    const handed = yield* handOverSettledItems(request);
    if (handed.length > 0) {
      const latest = yield* findLatestAsks({ itemIds: handed.map(({ id }) => id) });
      const handedTo = new Map(handed.map((item) => [item.id, item.reason]));
      yield* Effect.forEach(
        latest.filter(
          (ask) => ask.status === INBOX_ASK_STATUS.WITHDRAWN && ask.withdrawnReason === reason,
        ),
        (ask) =>
          rewordWithdrawnAsk({ messageId: ask.id, reason: handedTo.get(ask.itemId) ?? reason }),
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

/** The items a task's move to `standing` (Done or Canceled) stamped at `completedAt` settled opened again, as a member moving it off that status does; run inside the transaction that moves it. */
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

/** The agent's items its archive stamped at `archivedAt` settled opened again, as bringing the agent back from that archive does; run inside the transaction that brings it back. */
export function reopenAgentInboxItems(agentId: string, archivedAt: Date): SettleEffect<number> {
  return reopen(SETTLE_BY.AGENTS, [agentId], INBOX_SETTLED_REASON.AGENT_ARCHIVED, archivedAt);
}
