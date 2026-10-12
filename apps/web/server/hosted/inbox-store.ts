import {
  INBOX_BOUNDS,
  INBOX_KIND,
  INBOX_STATUS,
  type InboxItem,
  type InboxPost,
  type InboxReply,
  inboxOptionSchema,
  inboxReplySchema,
} from "@sidecar/hosted/inbox-wire";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { DateTime, Effect, Option, Result, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { codingAgent } from "../db/coding-agent-schema.js";
import { inboxItem } from "../db/inbox-schema.js";
import { db } from "../db/query.js";
import { InstantColumnSchema } from "./store/database.js";

/**
 * inbox-store.ts -- the developer's inbox: the items a plan's coding agents post, close, and read, and the developer's answers to them.
 *
 * Every statement names the account beside the plan, the agent, or the
 * item, so an id another account owns reads and writes exactly as one that
 * names nothing. An agent posts an item under a key of its own, which is
 * one row per agent and key: posting under a key it used before writes
 * that row again, moves its revision on, and opens it again whether it was
 * answered or closed, so the agent keeps an item current rather than
 * posting it twice. A post counts the agent's open items against the bound
 * under a lock on the agent's own row, so two posts of one step cannot both
 * slip under it. An answer is taken only by the revision it names and only
 * while the item is open, so an answer to an item the agent has since
 * changed is refused rather than taken for what it now asks; an answer sent
 * again under the key it was taken by finds it taken. Every function is an
 * effect over the ambient `SqlClient` and names no database of its own.
 */

type InboxStoreFailure = SqlError | Schema.SchemaError;

/** What an inbox store operation answers: an effect over the ambient client, composed into whatever called it. */
export type InboxStoreEffect<A> = Effect.Effect<A, InboxStoreFailure, SqlClient.SqlClient>;

/** The agent an item belongs to, as every write of the agent's names it. */
export interface InboxAgent {
  readonly userId: string;
  readonly planId: string;
  readonly agentId: string;
}

/** Why a post was not written. */
export const INBOX_POST_REFUSAL = {
  /** The agent holds as many open items as it may; it closes one first. */
  TOO_MANY_OPEN: "too-many-open",
  /** The agent is no longer the account's. */
  NO_AGENT: "no-agent",
} as const;

export type InboxPostRefusal = (typeof INBOX_POST_REFUSAL)[keyof typeof INBOX_POST_REFUSAL];

/** An item as the service holds it, beyond what the wire carries: the key its answer was taken under. */
export interface StoredInboxItem {
  readonly item: InboxItem;
  readonly answerKey: string | null;
}

/** The columns every read and every `returning` projects, so a row decodes one way whatever wrote it. */
const INBOX_COLUMNS = {
  id: inboxItem.id,
  agentId: inboxItem.agentId,
  key: inboxItem.key,
  revision: inboxItem.revision,
  kind: inboxItem.kind,
  title: inboxItem.title,
  details: inboxItem.details,
  options: inboxItem.options,
  recommended: inboxItem.recommended,
  needsReply: inboxItem.needsReply,
  status: inboxItem.status,
  answer: inboxItem.answer,
  answerKey: inboxItem.answerKey,
  closedReason: inboxItem.closedReason,
  postedAt: inboxItem.postedAt,
  updatedAt: inboxItem.updatedAt,
};

const InboxRowSchema = Schema.Struct({
  id: Schema.String,
  agentId: Schema.String,
  key: Schema.String,
  revision: Schema.Number,
  kind: Schema.Literals(Object.values(INBOX_KIND)),
  title: Schema.String,
  details: Schema.NullOr(Schema.String),
  options: Schema.NullOr(Schema.Array(inboxOptionSchema)),
  recommended: Schema.NullOr(Schema.String),
  needsReply: Schema.Boolean,
  status: Schema.Literals(Object.values(INBOX_STATUS)),
  answer: Schema.NullOr(inboxReplySchema),
  answerKey: Schema.NullOr(Schema.String),
  closedReason: Schema.NullOr(Schema.String),
  postedAt: InstantColumnSchema,
  updatedAt: InstantColumnSchema,
});

type InboxRow = typeof InboxRowSchema.Type;

/** A row as the wire carries it, each absent field left out rather than null. */
function storedItem(row: InboxRow): StoredInboxItem {
  return {
    item: {
      id: row.id,
      agentId: row.agentId,
      key: row.key,
      revision: row.revision,
      kind: row.kind,
      title: row.title,
      ...(row.details === null ? undefined : { details: row.details }),
      ...(row.options === null ? undefined : { options: row.options }),
      ...(row.recommended === null ? undefined : { recommended: row.recommended }),
      needsReply: row.needsReply,
      status: row.status,
      ...(row.answer === null ? undefined : { answer: row.answer }),
      ...(row.closedReason === null ? undefined : { closedReason: row.closedReason }),
      postedAt: row.postedAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    },
    answerKey: row.answerKey,
  };
}

const AgentKeySchema = Schema.Struct({ userId: Schema.String, agentId: Schema.String });

/** The agent's row under its own lock, where the account owns it, which serializes one agent's posts. */
const lockAgent = SqlSchema.findOneOption({
  Request: AgentKeySchema,
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, agentId }) =>
    db
      .select({ id: codingAgent.id })
      .from(codingAgent)
      .where(and(eq(codingAgent.id, agentId), eq(codingAgent.userId, userId)))
      .for("update"),
});

/** How many items the agent holds open under a key other than the one given. */
const countOpenBesides = SqlSchema.findOne({
  Request: Schema.Struct({ ...AgentKeySchema.fields, key: Schema.String }),
  Result: Schema.Struct({ open: Schema.Number }),
  execute: ({ userId, agentId, key }) =>
    db
      .select({ open: sql<number>`count(*)::int` })
      .from(inboxItem)
      .where(
        and(
          eq(inboxItem.userId, userId),
          eq(inboxItem.agentId, agentId),
          eq(inboxItem.status, INBOX_STATUS.OPEN),
          ne(inboxItem.key, key),
        ),
      ),
});

const PostWriteSchema = Schema.Struct({
  userId: Schema.String,
  planId: Schema.String,
  agentId: Schema.String,
  key: Schema.String,
  kind: Schema.Literals(Object.values(INBOX_KIND)),
  title: Schema.String,
  details: Schema.NullOr(Schema.String),
  options: Schema.NullOr(Schema.Array(inboxOptionSchema)),
  recommended: Schema.NullOr(Schema.String),
  needsReply: Schema.Boolean,
  now: Schema.Date,
});

/** The item written under the agent's key: a new row at revision one, or the standing one written again, its revision moved on and opened again. */
const upsertItem = SqlSchema.findOne({
  Request: PostWriteSchema,
  Result: InboxRowSchema,
  execute: (write) => {
    const posted = {
      kind: write.kind,
      title: write.title,
      details: write.details,
      options: write.options,
      recommended: write.recommended,
      needsReply: write.needsReply,
      status: INBOX_STATUS.OPEN,
      answer: null,
      answerKey: null,
      closedReason: null,
      updatedAt: write.now,
    };
    return db
      .insert(inboxItem)
      .values({
        userId: write.userId,
        planId: write.planId,
        agentId: write.agentId,
        key: write.key,
        revision: 1,
        postedAt: write.now,
        ...posted,
      })
      .onConflictDoUpdate({
        target: [inboxItem.agentId, inboxItem.key],
        set: { ...posted, revision: sql`${inboxItem.revision} + 1` },
      })
      .returning(INBOX_COLUMNS);
  },
});

/** The agent's item under the key closed with why, its revision moved on; nothing where the agent has no item under it. */
const closeItem = SqlSchema.findOneOption({
  Request: Schema.Struct({
    ...AgentKeySchema.fields,
    key: Schema.String,
    reason: Schema.String,
    now: Schema.Date,
  }),
  Result: InboxRowSchema,
  execute: ({ userId, agentId, key, reason, now }) =>
    db
      .update(inboxItem)
      .set({
        status: INBOX_STATUS.CLOSED,
        closedReason: reason,
        revision: sql`${inboxItem.revision} + 1`,
        updatedAt: now,
      })
      .where(
        and(eq(inboxItem.userId, userId), eq(inboxItem.agentId, agentId), eq(inboxItem.key, key)),
      )
      .returning(INBOX_COLUMNS),
});

const findAgentItems = SqlSchema.findAll({
  Request: AgentKeySchema,
  Result: InboxRowSchema,
  execute: ({ userId, agentId }) =>
    db
      .select(INBOX_COLUMNS)
      .from(inboxItem)
      .where(and(eq(inboxItem.userId, userId), eq(inboxItem.agentId, agentId)))
      .orderBy(desc(inboxItem.updatedAt))
      .limit(INBOX_BOUNDS.MAX_ITEMS_READ),
});

const PlanKeySchema = Schema.Struct({ userId: Schema.String, planId: Schema.String });

/** Every item of the plan still open, however long ago it last changed; the open bound per agent keeps these few. */
const findOpenPlanItems = SqlSchema.findAll({
  Request: PlanKeySchema,
  Result: InboxRowSchema,
  execute: ({ userId, planId }) =>
    db
      .select(INBOX_COLUMNS)
      .from(inboxItem)
      .where(
        and(
          eq(inboxItem.userId, userId),
          eq(inboxItem.planId, planId),
          eq(inboxItem.status, INBOX_STATUS.OPEN),
        ),
      )
      .orderBy(desc(inboxItem.updatedAt)),
});

/** The plan's settled items, the latest changed first, as many as a read carries. */
const findSettledPlanItems = SqlSchema.findAll({
  Request: PlanKeySchema,
  Result: InboxRowSchema,
  execute: ({ userId, planId }) =>
    db
      .select(INBOX_COLUMNS)
      .from(inboxItem)
      .where(
        and(
          eq(inboxItem.userId, userId),
          eq(inboxItem.planId, planId),
          ne(inboxItem.status, INBOX_STATUS.OPEN),
        ),
      )
      .orderBy(desc(inboxItem.updatedAt))
      .limit(INBOX_BOUNDS.MAX_ITEMS_READ),
});

const findItem = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, itemId: Schema.String }),
  Result: InboxRowSchema,
  execute: ({ userId, itemId }) =>
    db
      .select(INBOX_COLUMNS)
      .from(inboxItem)
      .where(and(eq(inboxItem.userId, userId), eq(inboxItem.id, itemId))),
});

/** The answer written on the item where it is open at the revision named; nothing where it is not. */
const answerItem = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    itemId: Schema.String,
    revision: Schema.Number,
    answer: inboxReplySchema,
    answerKey: Schema.String,
    now: Schema.Date,
  }),
  Result: InboxRowSchema,
  execute: ({ userId, itemId, revision, answer, answerKey, now }) =>
    db
      .update(inboxItem)
      .set({ status: INBOX_STATUS.ANSWERED, answer, answerKey, updatedAt: now })
      .where(
        and(
          eq(inboxItem.userId, userId),
          eq(inboxItem.id, itemId),
          eq(inboxItem.revision, revision),
          eq(inboxItem.status, INBOX_STATUS.OPEN),
        ),
      )
      .returning(INBOX_COLUMNS),
});

/**
 * The agent's post written: a new item under its key, or the one standing
 * under it written again and opened; refused where the agent would hold
 * more open items than the bound, or is no longer the account's. Note that
 * the post's own key is not counted, because writing it again opens no
 * second item.
 */
export function postInboxItem(
  agent: InboxAgent,
  post: InboxPost,
): InboxStoreEffect<Result.Result<InboxItem, InboxPostRefusal>> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const locked = yield* lockAgent(agent);
        if (Option.isNone(locked)) return Result.fail(INBOX_POST_REFUSAL.NO_AGENT);
        const { open } = yield* countOpenBesides({ ...agent, key: post.key }).pipe(
          // A count that returned no row is the database breaking its own contract, not an outcome.
          Effect.catchTag("NoSuchElementError", Effect.die),
        );
        if (open >= INBOX_BOUNDS.MAX_OPEN_PER_AGENT) {
          return Result.fail(INBOX_POST_REFUSAL.TOO_MANY_OPEN);
        }
        const row = yield* upsertItem({
          ...agent,
          key: post.key,
          kind: post.kind,
          title: post.title,
          details: post.details ?? null,
          options: post.kind === INBOX_KIND.CHOICE ? (post.options ?? []) : null,
          recommended: post.kind === INBOX_KIND.CHOICE ? (post.recommended ?? null) : null,
          needsReply: post.needsReply ?? true,
          now: yield* DateTime.nowAsDate,
        }).pipe(Effect.catchTag("NoSuchElementError", Effect.die));
        return Result.succeed(storedItem(row).item);
      }),
    ),
  );
}

/** The agent's item under the key closed with why; nothing where it has none under the key. */
export function closeInboxItem(
  agent: Pick<InboxAgent, "userId" | "agentId">,
  key: string,
  reason: string,
): InboxStoreEffect<Option.Option<InboxItem>> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(
      closeItem({ ...agent, key, reason, now }),
      Option.map((row) => storedItem(row).item),
    ),
  );
}

/** Every item the agent posted, the latest changed first. */
export function agentInboxItems(
  agent: Pick<InboxAgent, "userId" | "agentId">,
): InboxStoreEffect<readonly InboxItem[]> {
  return Effect.map(findAgentItems(agent), (rows) => rows.map((row) => storedItem(row).item));
}

/**
 * The plan's inbox: every item still open, then the latest settled ones as
 * many as a read carries. Note that the open items are read apart from the
 * bound, because one left unanswered while many others changed must still
 * wait where the developer looks.
 */
export function planInboxItems(
  userId: string,
  planId: string,
): InboxStoreEffect<readonly InboxItem[]> {
  return Effect.map(
    Effect.all([findOpenPlanItems({ userId, planId }), findSettledPlanItems({ userId, planId })]),
    ([open, settled]) => [...open, ...settled].map((row) => storedItem(row).item),
  );
}

/** The account's item, with the key its answer was taken under; nothing for one the account does not own. */
export function readInboxItem(
  userId: string,
  itemId: string,
): InboxStoreEffect<Option.Option<StoredInboxItem>> {
  return Effect.map(findItem({ userId, itemId }), Option.map(storedItem));
}

/** The answer taken back off the item it was taken on under the key, opening it again; nothing where that answer no longer stands. */
const withdrawAnswer = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    itemId: Schema.String,
    answerKey: Schema.String,
    now: Schema.Date,
  }),
  Result: InboxRowSchema,
  execute: ({ userId, itemId, answerKey, now }) =>
    db
      .update(inboxItem)
      .set({ status: INBOX_STATUS.OPEN, answer: null, answerKey: null, updatedAt: now })
      .where(
        and(
          eq(inboxItem.userId, userId),
          eq(inboxItem.id, itemId),
          eq(inboxItem.answerKey, answerKey),
          eq(inboxItem.status, INBOX_STATUS.ANSWERED),
        ),
      )
      .returning(INBOX_COLUMNS),
});

/** The answer taken under the key withdrawn, the item open again, where it still stands; nothing where it does not. */
export function withdrawInboxAnswer(
  userId: string,
  itemId: string,
  answerKey: string,
): InboxStoreEffect<Option.Option<InboxItem>> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(
      withdrawAnswer({ userId, itemId, answerKey, now }),
      Option.map((row) => storedItem(row).item),
    ),
  );
}

/** The developer's answer taken on the item at the revision named, under the key the client sent it with; nothing where the item is no longer open at that revision. */
export function answerInboxItem(
  userId: string,
  itemId: string,
  revision: number,
  answer: InboxReply,
  answerKey: string,
): InboxStoreEffect<Option.Option<InboxItem>> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(
      answerItem({ userId, itemId, revision, answer, answerKey, now }),
      Option.map((row) => storedItem(row).item),
    ),
  );
}
