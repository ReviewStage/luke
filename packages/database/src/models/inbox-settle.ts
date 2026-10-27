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
 * read it. A task reopened or an agent brought back later opens nothing
 * again; only the agent's own post under the item's key does.
 */

import { INBOX_ASK_STATUS, INBOX_STATUS } from "@luke/features/inbox-wire";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError } from "../core/query.js";
import { inboxItem } from "../schemas/inbox.js";
import { inboxMessage } from "../schemas/inbox-message.js";

type SettleEffect<A> = Effect.Effect<A, QueryError | Schema.SchemaError, DatabaseServices>;

/** Why an item settled on its own, as its close and its withdrawn ask say it. */
export const INBOX_SETTLED_REASON = {
  TASK_DONE: "Its task is done.",
  TASK_CANCELED: "Its task was canceled.",
  AGENT_ARCHIVED: "Its agent was archived.",
} as const;

export type InboxSettledReason = (typeof INBOX_SETTLED_REASON)[keyof typeof INBOX_SETTLED_REASON];

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

/** The task's open items settled, as its move to Done or Canceled settles them; run inside the transaction that moved it. */
export function settleTaskInboxItems(
  taskId: string,
  reason: InboxSettledReason,
  now: Date,
): SettleEffect<number> {
  return settle(SETTLE_BY.TASK, [taskId], reason, now);
}

/** The agents' open items settled, as their archive settles them; run inside the transaction that archived them. */
export function settleAgentInboxItems(
  agentIds: readonly string[],
  now: Date,
): SettleEffect<number> {
  return settle(SETTLE_BY.AGENTS, agentIds, INBOX_SETTLED_REASON.AGENT_ARCHIVED, now);
}
