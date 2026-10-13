import { randomUUID } from "node:crypto";
import { db } from "@sidecar/database/core/query";
import { InstantColumnSchema } from "@sidecar/database/models/columns";
import { codingAgent } from "@sidecar/database/schemas/coding-agent";
import { inboxItem } from "@sidecar/database/schemas/inbox";
import { inboxAttachment } from "@sidecar/database/schemas/inbox-attachment";
import { plan } from "@sidecar/database/schemas/plan";
import type { AccountInboxEntry, AccountInboxPlan } from "@sidecar/hosted/account-inbox-wire";
import {
  INBOX_BLOCK,
  INBOX_BOUNDS,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxBlock,
  type InboxImageType,
  type InboxItem,
  type InboxPost,
  type InboxPostBlock,
  type InboxReply,
  inboxBlockSchema,
  inboxImageTypeSchema,
  inboxReplySchema,
  inboxResponseSchema,
} from "@sidecar/hosted/inbox-wire";
import { and, count, desc, eq, isNull, max, ne, notInArray, sql } from "drizzle-orm";
import { DateTime, Effect, Option, Result, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";

/**
 * inbox-store.ts -- the developer's inbox: the items a plan's coding agents post, close, and read, and the developer's answers to them.
 *
 * Every statement names the account beside the plan, the agent, or the
 * item, so an id another account owns reads and writes exactly as one that
 * names nothing. An agent posts an item under a key of its own, which is
 * one row per agent and key: posting under a key it used before writes
 * that row again, moves its revision on, and opens it again whether it was
 * answered or closed, so the agent keeps an item current rather than
 * posting it twice. A row keeps the item's blocks and its response as the
 * wire's own JSON under the version of the vocabulary that wrote them,
 * decoded on every read against the wire's closed shapes. An image block
 * is posted by a path and kept by an attachment: the caller reads the
 * file's bytes from the agent's sandbox and hands them in beside the post,
 * and the post writes each as a row of the item's
 * (`@sidecar/database/schemas/inbox-attachment`) under an id minted here, which the
 * block kept on the item names in the path's place; the item's attachments
 * its new blocks no longer name go with the same write, so a picture the
 * agent dropped from an item is dropped from the store. A post counts the agent's open items against the bound
 * under a lock on the agent's own row, so two posts of one step cannot both
 * slip under it. An answer is taken only by the revision it names and only
 * while the item is open, so an answer to an item the agent has since
 * changed is refused rather than taken for what it now asks; an answer sent
 * again under the key it was taken by finds it taken. What waits across
 * the account, every open item on a plan it has not archived, is read on
 * its own index, so a desktop can hold that read whichever plan is open.
 * Every function is an effect over the ambient `SqlClient` and names no
 * database of its own.
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

/** Where one item stands, without what it says. */
export interface InboxStamp {
  readonly id: string;
  readonly revision: number;
  readonly status: InboxItem["status"];
  readonly updatedAt: number;
}

/** An item as the service holds it, beyond what the wire carries: the key its answer was taken under. */
export interface StoredInboxItem {
  readonly item: InboxItem;
  readonly answerKey: string | null;
}

/** One picture as a post hands it in and a read answers it: the type its bytes were sniffed to be, and the bytes. */
export interface InboxImage {
  readonly contentType: InboxImageType;
  readonly bytes: Uint8Array;
}

/** The columns every read and every `returning` projects, so a row decodes one way whatever wrote it. */
const INBOX_COLUMNS = {
  id: inboxItem.id,
  agentId: inboxItem.agentId,
  key: inboxItem.key,
  revision: inboxItem.revision,
  version: inboxItem.version,
  title: inboxItem.title,
  blocks: inboxItem.blocks,
  response: inboxItem.response,
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
  version: Schema.Number,
  title: Schema.String,
  blocks: Schema.Array(inboxBlockSchema),
  response: inboxResponseSchema,
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
      version: row.version,
      title: row.title,
      blocks: row.blocks,
      response: row.response,
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
  title: Schema.String,
  blocks: Schema.Array(inboxBlockSchema),
  response: inboxResponseSchema,
  needsReply: Schema.Boolean,
  now: Schema.Date,
});

const AttachmentWriteSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  planId: Schema.String,
  itemId: Schema.String,
  contentType: inboxImageTypeSchema,
  byteCount: Schema.Number,
  bytes: Schema.Uint8Array,
  now: Schema.Date,
});

/** One picture written as a row of the item's, under the id the block names. */
const insertAttachment = SqlSchema.void({
  Request: AttachmentWriteSchema,
  execute: ({ now, ...attachment }) =>
    db.insert(inboxAttachment).values({ ...attachment, createdAt: now }),
});

/** The item's attachments no block of its names any longer, deleted. */
const deleteOtherAttachments = SqlSchema.void({
  Request: Schema.Struct({ itemId: Schema.String, kept: Schema.Array(Schema.String) }),
  execute: ({ itemId, kept }) =>
    db
      .delete(inboxAttachment)
      .where(
        kept.length === 0
          ? eq(inboxAttachment.itemId, itemId)
          : and(eq(inboxAttachment.itemId, itemId), notInArray(inboxAttachment.id, [...kept])),
      ),
});

/** The account's attachment, where it is the item's: its type and its bytes. */
const findAttachment = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    itemId: Schema.String,
    attachmentId: Schema.String,
  }),
  Result: Schema.Struct({ contentType: inboxImageTypeSchema, bytes: Schema.Uint8Array }),
  execute: ({ userId, itemId, attachmentId }) =>
    db
      .select({ contentType: inboxAttachment.contentType, bytes: inboxAttachment.bytes })
      .from(inboxAttachment)
      .where(
        and(
          eq(inboxAttachment.userId, userId),
          eq(inboxAttachment.itemId, itemId),
          eq(inboxAttachment.id, attachmentId),
        ),
      ),
});

/** The blocks as the item keeps them: each image block naming the attachment minted for it, in the order the images were handed in, and every other block as posted. */
function storedBlocks(
  blocks: readonly InboxPostBlock[],
  attachmentIds: readonly string[],
): readonly InboxBlock[] {
  let next = 0;
  return blocks.map((block): InboxBlock => {
    if (block.type !== INBOX_BLOCK.IMAGE) return block;
    const attachmentId = attachmentIds[next];
    next += 1;
    // The caller hands one picture per image block; fewer is its contract broken, not an outcome.
    if (attachmentId === undefined) throw new Error("an image block has no picture handed in");
    return { type: INBOX_BLOCK.IMAGE, attachmentId, alt: block.alt };
  });
}

/** The item written under the agent's key: a new row at revision one, or the standing one written again, its revision moved on and opened again. */
const upsertItem = SqlSchema.findOne({
  Request: PostWriteSchema,
  Result: InboxRowSchema,
  execute: (write) => {
    const posted = {
      version: INBOX_WIRE_VERSION,
      title: write.title,
      blocks: write.blocks,
      response: write.response,
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

/** Where a read looks: one plan's items, or one agent's, always the account's own. */
const INBOX_SCOPE = {
  PLAN: "plan",
  AGENT: "agent",
} as const;

const ScopeSchema = Schema.Struct({
  userId: Schema.String,
  scope: Schema.Literals(Object.values(INBOX_SCOPE)),
  id: Schema.String,
});

type InboxScope = typeof ScopeSchema.Type;

/** The rows a scope names: the account's, under the plan or the agent given. */
function inScope(scope: InboxScope) {
  return and(
    eq(inboxItem.userId, scope.userId),
    scope.scope === INBOX_SCOPE.PLAN
      ? eq(inboxItem.planId, scope.id)
      : eq(inboxItem.agentId, scope.id),
  );
}

/** The order every read keeps: the latest changed first, and by id among those changed at one instant, so two reads of the same rows agree. */
const LATEST_FIRST = [desc(inboxItem.updatedAt), desc(inboxItem.id)] as const;

/** Every open item the scope holds, however long ago it last changed; the open bound per agent keeps these few. */
const findOpenItems = SqlSchema.findAll({
  Request: ScopeSchema,
  Result: InboxRowSchema,
  execute: (scope) =>
    db
      .select(INBOX_COLUMNS)
      .from(inboxItem)
      .where(and(inScope(scope), eq(inboxItem.status, INBOX_STATUS.OPEN)))
      .orderBy(...LATEST_FIRST),
});

/** The scope's settled items, the latest changed first, as many as the read carries. */
const findSettledItems = SqlSchema.findAll({
  Request: Schema.Struct({ ...ScopeSchema.fields, limit: Schema.Number }),
  Result: InboxRowSchema,
  execute: ({ limit, ...scope }) =>
    db
      .select(INBOX_COLUMNS)
      .from(inboxItem)
      .where(and(inScope(scope), ne(inboxItem.status, INBOX_STATUS.OPEN)))
      .orderBy(...LATEST_FIRST)
      .limit(limit),
});

/** Where one item stands, without what it says: what a held read compares between looks. */
const StampRowSchema = Schema.Struct({
  id: Schema.String,
  revision: Schema.Number,
  status: Schema.Literals(Object.values(INBOX_STATUS)),
  updatedAt: InstantColumnSchema,
});

const STAMP_COLUMNS = {
  id: inboxItem.id,
  revision: inboxItem.revision,
  status: inboxItem.status,
  updatedAt: inboxItem.updatedAt,
};

const findOpenStamps = SqlSchema.findAll({
  Request: ScopeSchema,
  Result: StampRowSchema,
  execute: (scope) =>
    db
      .select(STAMP_COLUMNS)
      .from(inboxItem)
      .where(and(inScope(scope), eq(inboxItem.status, INBOX_STATUS.OPEN)))
      .orderBy(...LATEST_FIRST),
});

const findSettledStamps = SqlSchema.findAll({
  Request: Schema.Struct({ ...ScopeSchema.fields, limit: Schema.Number }),
  Result: StampRowSchema,
  execute: ({ limit, ...scope }) =>
    db
      .select(STAMP_COLUMNS)
      .from(inboxItem)
      .where(and(inScope(scope), ne(inboxItem.status, INBOX_STATUS.OPEN)))
      .orderBy(...LATEST_FIRST)
      .limit(limit),
});

/**
 * The account's open items on the plans it has not archived: the rows the
 * account's read of what waits names. Note that the plan is joined by its
 * key from each item the account's own index finds, so leaving archived
 * plans out reads no plan the account has no open item on.
 */
function accountWaiting(userId: string) {
  return and(
    eq(inboxItem.userId, userId),
    eq(inboxItem.status, INBOX_STATUS.OPEN),
    isNull(plan.archivedAt),
  );
}

const AccountRequestSchema = Schema.Struct({ userId: Schema.String });

/** One open item as the account's read carries it, with its agent as its row names it now. */
const WaitingRowSchema = Schema.Struct({
  id: Schema.String,
  planId: Schema.String,
  agentId: Schema.String,
  agentTitle: Schema.NullOr(Schema.String),
  agentModel: Schema.String,
  title: Schema.String,
  revision: Schema.Number,
  status: Schema.Literals(Object.values(INBOX_STATUS)),
  postedAt: InstantColumnSchema,
  updatedAt: InstantColumnSchema,
});

const findWaitingItems = SqlSchema.findAll({
  Request: AccountRequestSchema,
  Result: WaitingRowSchema,
  execute: ({ userId }) =>
    db
      .select({
        id: inboxItem.id,
        planId: inboxItem.planId,
        agentId: inboxItem.agentId,
        agentTitle: codingAgent.title,
        agentModel: codingAgent.model,
        title: inboxItem.title,
        revision: inboxItem.revision,
        status: inboxItem.status,
        postedAt: inboxItem.postedAt,
        updatedAt: inboxItem.updatedAt,
      })
      .from(inboxItem)
      .innerJoin(plan, eq(plan.id, inboxItem.planId))
      .innerJoin(codingAgent, eq(codingAgent.id, inboxItem.agentId))
      .where(accountWaiting(userId))
      .orderBy(...LATEST_FIRST),
});

const findWaitingStamps = SqlSchema.findAll({
  Request: AccountRequestSchema,
  Result: StampRowSchema,
  execute: ({ userId }) =>
    db
      .select(STAMP_COLUMNS)
      .from(inboxItem)
      .innerJoin(plan, eq(plan.id, inboxItem.planId))
      .where(accountWaiting(userId))
      .orderBy(...LATEST_FIRST),
});

/** One plan holding items as the account's read lists it: how many, and when the latest changed. */
const PlanItemsRowSchema = Schema.Struct({
  planId: Schema.String,
  items: Schema.Number,
  updatedAt: InstantColumnSchema,
});

/** When a plan's latest item changed, which orders the plans holding items. */
const LATEST_ITEM = max(inboxItem.updatedAt);

/**
 * Every plan of the account's it has not archived that holds an item, open
 * or settled, the plan whose item changed latest first. Note that it is
 * read from the account's own index, as the open items are, the plan joined
 * by its key from each item found.
 */
const findPlansWithItems = SqlSchema.findAll({
  Request: AccountRequestSchema,
  Result: PlanItemsRowSchema,
  execute: ({ userId }) =>
    db
      .select({ planId: inboxItem.planId, items: count(), updatedAt: LATEST_ITEM })
      .from(inboxItem)
      .innerJoin(plan, eq(plan.id, inboxItem.planId))
      .where(and(eq(inboxItem.userId, userId), isNull(plan.archivedAt)))
      .groupBy(inboxItem.planId)
      .orderBy(desc(LATEST_ITEM), desc(inboxItem.planId)),
});

/** The scope's items: every open one, then the latest settled ones up to the limit. */
function scopeItems(
  scope: InboxScope,
  settledLimit: number,
): InboxStoreEffect<readonly InboxItem[]> {
  return Effect.map(
    Effect.all([findOpenItems(scope), findSettledItems({ ...scope, limit: settledLimit })]),
    ([open, settled]) => [...open, ...settled].map((row) => storedItem(row).item),
  );
}

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
 * more open items than the bound, or is no longer the account's. The
 * pictures are the post's image blocks' bytes in the blocks' own order, one
 * each, read by the caller; each is written as an attachment of the item's
 * under an id minted here, and the item's other attachments are deleted.
 * Note that the post's own key is not counted, because writing it again
 * opens no second item.
 */
export function postInboxItem(
  agent: InboxAgent,
  post: InboxPost,
  images: readonly InboxImage[] = [],
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
        const now = yield* DateTime.nowAsDate;
        const attachments = yield* Effect.sync(() =>
          images.map((image) => ({ ...image, id: randomUUID() })),
        );
        const row = yield* upsertItem({
          ...agent,
          key: post.key,
          title: post.title,
          blocks: storedBlocks(
            post.blocks ?? [],
            attachments.map((attachment) => attachment.id),
          ),
          response: post.response,
          needsReply: post.needsReply ?? true,
          now,
        }).pipe(Effect.catchTag("NoSuchElementError", Effect.die));
        yield* Effect.forEach(attachments, (attachment) =>
          insertAttachment({
            id: attachment.id,
            userId: agent.userId,
            planId: agent.planId,
            itemId: row.id,
            contentType: attachment.contentType,
            byteCount: attachment.bytes.byteLength,
            bytes: attachment.bytes,
            now,
          }),
        );
        yield* deleteOtherAttachments({
          itemId: row.id,
          kept: attachments.map((attachment) => attachment.id),
        });
        return Result.succeed(storedItem(row).item);
      }),
    ),
  );
}

/** The account's picture, where it is the item's: its type and its bytes; nothing for one the account does not own or the item does not carry. */
export function readInboxAttachment(
  userId: string,
  itemId: string,
  attachmentId: string,
): InboxStoreEffect<Option.Option<InboxImage>> {
  return findAttachment({ userId, itemId, attachmentId });
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

/**
 * The agent's own items as its tools answer with them: every one still
 * open, then the latest settled ones, few enough that a tool's answer stays
 * a small part of the agent's context. Note that the open items are read
 * apart from the bound, so one the developer has yet to answer is never
 * dropped from what the agent holds.
 */
export function agentInboxItems(
  agent: Pick<InboxAgent, "userId" | "agentId">,
): InboxStoreEffect<readonly InboxItem[]> {
  return scopeItems(
    { userId: agent.userId, scope: INBOX_SCOPE.AGENT, id: agent.agentId },
    INBOX_BOUNDS.MAX_SETTLED_TOLD,
  );
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
  return scopeItems({ userId, scope: INBOX_SCOPE.PLAN, id: planId }, INBOX_BOUNDS.MAX_ITEMS_READ);
}

/** Where each of the plan's items stands, the same items `planInboxItems` reads and none of their words: what a held read compares between looks. */
export function planInboxStamps(
  userId: string,
  planId: string,
): InboxStoreEffect<readonly InboxStamp[]> {
  const scope = { userId, scope: INBOX_SCOPE.PLAN, id: planId };
  return Effect.map(
    Effect.all([
      findOpenStamps(scope),
      findSettledStamps({ ...scope, limit: INBOX_BOUNDS.MAX_ITEMS_READ }),
    ]),
    ([open, settled]) =>
      [...open, ...settled].map((row) => ({ ...row, updatedAt: row.updatedAt.getTime() })),
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

/** One item that waits as the account's read holds it: the entry the wire carries, and where it stands, which a cursor digests. */
type AccountWaitingRow = AccountInboxEntry & Pick<InboxStamp, "status">;

/**
 * Every item that waits on the developer across the account's plans, the
 * latest changed first: open, and on a plan the account has not archived.
 * Note that none is left out for being old, because one left unanswered
 * while many others changed must still be counted; the open bound per
 * agent keeps these few.
 */
export function accountWaitingItems(
  userId: string,
): InboxStoreEffect<readonly AccountWaitingRow[]> {
  return Effect.map(findWaitingItems({ userId }), (rows) =>
    rows.map((row) => ({
      ...row,
      postedAt: row.postedAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    })),
  );
}

/** Where each item `accountWaitingItems` reads stands, the same items and none of their words: what a held read of the account compares between looks. */
export function accountWaitingStamps(userId: string): InboxStoreEffect<readonly InboxStamp[]> {
  return Effect.map(findWaitingStamps({ userId }), (rows) =>
    rows.map((row) => ({ ...row, updatedAt: row.updatedAt.getTime() })),
  );
}

/**
 * Every plan the account has not archived that holds an inbox item,
 * waiting or settled, with how many and when the latest changed, the
 * plan whose item changed latest first: what the desktop's Inbox lists.
 */
export function accountInboxPlans(userId: string): InboxStoreEffect<readonly AccountInboxPlan[]> {
  return Effect.map(findPlansWithItems({ userId }), (rows) =>
    rows.map((row) => ({ ...row, updatedAt: row.updatedAt.getTime() })),
  );
}
