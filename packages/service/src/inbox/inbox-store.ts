import { randomUUID } from "node:crypto";
import {
  LIVE_COUNT,
  type LiveStatement,
  liveLatest,
  liveSelection,
  liveStatementOf,
} from "@luke/database/core/live-statement";
import {
  Database,
  type DatabaseServices,
  type QueryError,
  queryBuilder,
} from "@luke/database/core/query";
import { automationReadableBy } from "@luke/database/models/automation-store";
import { InstantColumnSchema } from "@luke/database/models/columns";
import {
  AGENT_WORKSPACE,
  agentReachableBy,
  taskReachableBy,
  workspaceReachableBy,
} from "@luke/database/models/workspace-store";
import { user } from "@luke/database/schemas/auth";
import { automation } from "@luke/database/schemas/automation";
import { codingAgent } from "@luke/database/schemas/coding-agent";
import { inboxItem } from "@luke/database/schemas/inbox";
import { inboxAttachment } from "@luke/database/schemas/inbox-attachment";
import { task } from "@luke/database/schemas/plan";
import type {
  AccountInboxAutomation,
  AccountInboxEntry,
  AccountInboxTask,
  AccountTasklessEntry,
} from "@luke/features/account-inbox-wire";
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
} from "@luke/features/inbox-wire";
import { and, count, desc, eq, isNull, max, ne, notInArray, or, type SQL, sql } from "drizzle-orm";
import { DateTime, Effect, Option, Result, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

/**
 * inbox-store.ts -- the developer's inbox: the items a plan's coding agents post, close, and read, and the developer's answers to them.
 *
 * Every statement names the account beside the plan, the agent, or the
 * item. An item is its agent's, written under the member who started the
 * agent, and the plan's inbox is the workspace's: every member of the
 * plan's workspace reads and answers it, gated on that membership
 * (`workspace-store.ts`), so an item of a workspace the account is not in
 * reads and writes exactly as one that names nothing. An agent posts an item under a key of its own, which is
 * one row per agent and key: posting under a key it used before writes
 * that row again, moves its revision on, and opens it again whether it was
 * answered or closed, so the agent keeps an item current rather than
 * posting it twice. A row keeps the item's blocks and its response as the
 * wire's own JSON under the version of the vocabulary that wrote them,
 * decoded on every read against the wire's closed shapes. An image block
 * is posted by a path and kept by an attachment: the caller reads the
 * file's bytes from the agent's sandbox and hands them in beside the post,
 * and the post writes each as a row of the item's
 * (`@luke/database/schemas/inbox-attachment`) under an id minted here, which the
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

type InboxStoreFailure = QueryError | Schema.SchemaError;

/** What an inbox store operation answers: an effect over the ambient client, composed into whatever called it. */
export type InboxStoreEffect<A> = Effect.Effect<A, InboxStoreFailure, DatabaseServices>;

/** The agent an item belongs to, as every write of the agent's names it: the plan it works on, or none for an agent an automation started with no plan. */
export interface InboxAgent {
  readonly userId: string;
  readonly taskId: string | null;
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
  answeredBy: inboxItem.answeredBy,
  // A scalar read rather than a join, because `returning` projects these too and joins nothing.
  answeredByName: sql<
    string | null
  >`(select "name" from ${user} where ${user.id} = ${inboxItem.answeredBy})`,
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
  answeredBy: Schema.NullOr(Schema.String),
  answeredByName: Schema.NullOr(Schema.String),
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
      ...(row.answeredBy === null || row.answeredByName === null
        ? undefined
        : { answeredBy: { userId: row.answeredBy, name: row.answeredByName } }),
      ...(row.closedReason === null ? undefined : { closedReason: row.closedReason }),
      postedAt: row.postedAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    },
    answerKey: row.answerKey,
  };
}

const AgentKeySchema = Schema.Struct({ userId: Schema.String, agentId: Schema.String });

/** An item row's workspace: its own, or its plan's on a row the backfill has not reached yet. */
const ITEM_WORKSPACE = sql<string>`coalesce(${inboxItem.organizationId}, (select ${task.organizationId} from ${task} where ${task.id} = ${inboxItem.taskId}))`;

/** The condition that the account is a member of the workspace of the item a statement reads, an item of an agent with no plan as much as one on a plan. */
function itemReachableBy(userId: string): SQL {
  return workspaceReachableBy(userId, ITEM_WORKSPACE);
}

/** The agent's row under its own lock, where the account started it and is still a member of its workspace, which serializes one agent's posts. */
const lockAgent = SqlSchema.findOneOption({
  Request: AgentKeySchema,
  Result: Schema.Struct({ id: Schema.String, organizationId: Schema.String }),
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db
        .select({ id: codingAgent.id, organizationId: AGENT_WORKSPACE })
        .from(codingAgent)
        .where(
          and(
            eq(codingAgent.id, agentId),
            eq(codingAgent.userId, userId),
            agentReachableBy(userId),
          ),
        )
        .for("update"),
    ),
});

/** How many items the agent holds open under a key other than the one given. */
const countOpenBesides = SqlSchema.findOne({
  Request: Schema.Struct({ ...AgentKeySchema.fields, key: Schema.String }),
  Result: Schema.Struct({ open: Schema.Number }),
  execute: ({ userId, agentId, key }) =>
    Database.use((db) =>
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
    ),
});

const PostWriteSchema = Schema.Struct({
  userId: Schema.String,
  taskId: Schema.NullOr(Schema.String),
  organizationId: Schema.String,
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
  taskId: Schema.NullOr(Schema.String),
  organizationId: Schema.String,
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
    Database.use((db) => db.insert(inboxAttachment).values({ ...attachment, createdAt: now })),
});

/** The item's attachments no block of its names any longer, deleted. */
const deleteOtherAttachments = SqlSchema.void({
  Request: Schema.Struct({ itemId: Schema.String, kept: Schema.Array(Schema.String) }),
  execute: ({ itemId, kept }) =>
    Database.use((db) =>
      db
        .delete(inboxAttachment)
        .where(
          kept.length === 0
            ? eq(inboxAttachment.itemId, itemId)
            : and(eq(inboxAttachment.itemId, itemId), notInArray(inboxAttachment.id, [...kept])),
        ),
    ),
});

/** The attachment, where it is the item's and the account reaches the item's plan: its type and its bytes. */
const findAttachment = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    itemId: Schema.String,
    attachmentId: Schema.String,
  }),
  Result: Schema.Struct({ contentType: inboxImageTypeSchema, bytes: Schema.Uint8Array }),
  execute: ({ userId, itemId, attachmentId }) =>
    Database.use((db) =>
      db
        .select({ contentType: inboxAttachment.contentType, bytes: inboxAttachment.bytes })
        .from(inboxAttachment)
        .innerJoin(inboxItem, eq(inboxItem.id, inboxAttachment.itemId))
        .where(
          and(
            eq(inboxAttachment.itemId, itemId),
            eq(inboxAttachment.id, attachmentId),
            itemReachableBy(userId),
          ),
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
      answeredBy: null,
      closedReason: null,
      updatedAt: write.now,
    };
    return Database.use((db) =>
      db
        .insert(inboxItem)
        .values({
          userId: write.userId,
          taskId: write.taskId,
          organizationId: write.organizationId,
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
        .returning(INBOX_COLUMNS),
    );
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
    Database.use((db) =>
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
    ),
});

/** Where a read looks: one plan's items, any member's agents' alike; one agent's own, under the member who started it; or one agent's, as any member of its workspace reads them. */
const INBOX_SCOPE = {
  TASK: "plan",
  AGENT: "agent",
  AGENT_OF_WORKSPACE: "agent-of-workspace",
} as const;

const ScopeSchema = Schema.Struct({
  userId: Schema.String,
  scope: Schema.Literals(Object.values(INBOX_SCOPE)),
  id: Schema.String,
});

type InboxScope = typeof ScopeSchema.Type;

/** The rows a scope names: the plan's or the agent's where the account is a member of their workspace, or the agent's under the account that started it. */
function inScope(scope: InboxScope) {
  switch (scope.scope) {
    case INBOX_SCOPE.TASK:
      return and(eq(inboxItem.taskId, scope.id), itemReachableBy(scope.userId));
    case INBOX_SCOPE.AGENT_OF_WORKSPACE:
      return and(eq(inboxItem.agentId, scope.id), itemReachableBy(scope.userId));
    case INBOX_SCOPE.AGENT:
      return and(eq(inboxItem.agentId, scope.id), eq(inboxItem.userId, scope.userId));
  }
}

/** The order every read keeps: the latest changed first, and by id among those changed at one instant, so two reads of the same rows agree. */
const LATEST_FIRST = [desc(inboxItem.updatedAt), desc(inboxItem.id)] as const;

/** Every open item the scope holds, however long ago it last changed; the open bound per agent keeps these few. */
const findOpenItems = SqlSchema.findAll({
  Request: ScopeSchema,
  Result: InboxRowSchema,
  execute: (scope) =>
    Database.use((db) =>
      db
        .select(INBOX_COLUMNS)
        .from(inboxItem)
        .where(and(inScope(scope), eq(inboxItem.status, INBOX_STATUS.OPEN)))
        .orderBy(...LATEST_FIRST),
    ),
});

/** The scope's settled items, the latest changed first, as many as the read carries. */
const findSettledItems = SqlSchema.findAll({
  Request: Schema.Struct({ ...ScopeSchema.fields, limit: Schema.Number }),
  Result: InboxRowSchema,
  execute: ({ limit, ...scope }) =>
    Database.use((db) =>
      db
        .select(INBOX_COLUMNS)
        .from(inboxItem)
        .where(and(inScope(scope), ne(inboxItem.status, INBOX_STATUS.OPEN)))
        .orderBy(...LATEST_FIRST)
        .limit(limit),
    ),
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
    Database.use((db) =>
      db
        .select(STAMP_COLUMNS)
        .from(inboxItem)
        .where(and(inScope(scope), eq(inboxItem.status, INBOX_STATUS.OPEN)))
        .orderBy(...LATEST_FIRST),
    ),
});

const findSettledStamps = SqlSchema.findAll({
  Request: Schema.Struct({ ...ScopeSchema.fields, limit: Schema.Number }),
  Result: StampRowSchema,
  execute: ({ limit, ...scope }) =>
    Database.use((db) =>
      db
        .select(STAMP_COLUMNS)
        .from(inboxItem)
        .where(and(inScope(scope), ne(inboxItem.status, INBOX_STATUS.OPEN)))
        .orderBy(...LATEST_FIRST)
        .limit(limit),
    ),
});

/**
 * The open items on the plans of the account's workspaces it has not
 * archived, whichever member's agent posted each: the rows the account's
 * read of what waits names.
 */
function accountWaiting(userId: string) {
  return and(
    taskReachableBy(userId),
    eq(inboxItem.status, INBOX_STATUS.OPEN),
    isNull(task.archivedAt),
  );
}

/** The open items of agents with no plan in the account's workspaces, whichever member's agent posted each: what the account's read names beside the plans' items. */
function tasklessWaiting(userId: string) {
  return and(
    isNull(inboxItem.taskId),
    itemReachableBy(userId),
    eq(inboxItem.status, INBOX_STATUS.OPEN),
  );
}

const AccountRequestSchema = Schema.Struct({ userId: Schema.String });

/** One open item as the account's read carries it, with its agent as its row names it now. */
const WaitingRowSchema = Schema.Struct({
  id: Schema.String,
  taskId: Schema.String,
  agentId: Schema.String,
  agentTitle: Schema.NullOr(Schema.String),
  agentModel: Schema.String,
  startedBy: Schema.String,
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
    Database.use((db) =>
      db
        .select({
          id: inboxItem.id,
          taskId: inboxItem.taskId,
          agentId: inboxItem.agentId,
          agentTitle: codingAgent.title,
          agentModel: codingAgent.model,
          startedBy: codingAgent.userId,
          title: inboxItem.title,
          revision: inboxItem.revision,
          status: inboxItem.status,
          postedAt: inboxItem.postedAt,
          updatedAt: inboxItem.updatedAt,
        })
        .from(inboxItem)
        .innerJoin(task, eq(task.id, inboxItem.taskId))
        .innerJoin(codingAgent, eq(codingAgent.id, inboxItem.agentId))
        .where(accountWaiting(userId))
        .orderBy(...LATEST_FIRST),
    ),
});

/** One open item of an agent with no plan as the account's read carries it, with its automation and repository where a plan's item names its plan. */
const TasklessRowSchema = Schema.Struct({
  id: Schema.String,
  agentId: Schema.String,
  agentTitle: Schema.NullOr(Schema.String),
  agentModel: Schema.String,
  startedBy: Schema.String,
  automationId: Schema.NullOr(Schema.String),
  automationName: Schema.NullOr(Schema.String),
  repository: Schema.String,
  workspaceId: Schema.NullOr(Schema.String),
  title: Schema.String,
  revision: Schema.Number,
  status: Schema.Literals(Object.values(INBOX_STATUS)),
  postedAt: InstantColumnSchema,
  updatedAt: InstantColumnSchema,
});

const findTasklessWaitingItems = SqlSchema.findAll({
  Request: AccountRequestSchema,
  Result: TasklessRowSchema,
  execute: ({ userId }) =>
    Database.use((db) =>
      db
        .select({
          id: inboxItem.id,
          agentId: inboxItem.agentId,
          agentTitle: codingAgent.title,
          agentModel: codingAgent.model,
          startedBy: codingAgent.userId,
          automationId: automation.id,
          automationName: automation.name,
          repository: codingAgent.repository,
          workspaceId: codingAgent.organizationId,
          title: inboxItem.title,
          revision: inboxItem.revision,
          status: inboxItem.status,
          postedAt: inboxItem.postedAt,
          updatedAt: inboxItem.updatedAt,
        })
        .from(inboxItem)
        .innerJoin(codingAgent, eq(codingAgent.id, inboxItem.agentId))
        // The automation, its id as its name, is told only to an account that may read the automation itself.
        .leftJoin(
          automation,
          and(eq(automation.id, codingAgent.automationId), automationReadableBy(userId)),
        )
        .where(tasklessWaiting(userId))
        .orderBy(...LATEST_FIRST),
    ),
});

/** Where every item the account's read names stands, a plan's or an agent's with no plan. Note that the plan is joined on the left, because an item with no plan has none to join. */
const findWaitingStamps = SqlSchema.findAll({
  Request: AccountRequestSchema,
  Result: StampRowSchema,
  execute: ({ userId }) =>
    Database.use((db) =>
      db
        .select(STAMP_COLUMNS)
        .from(inboxItem)
        .leftJoin(task, eq(task.id, inboxItem.taskId))
        .where(or(accountWaiting(userId), tasklessWaiting(userId)))
        .orderBy(...LATEST_FIRST),
    ),
});

/** One plan holding items as the account's read lists it: how many, and when the latest changed. */
const TaskItemsRowSchema = Schema.Struct({
  taskId: Schema.String,
  items: Schema.Number,
  updatedAt: InstantColumnSchema,
});

/** When a plan's latest item changed, which orders the plans holding items. */
const LATEST_ITEM = max(inboxItem.updatedAt);

/**
 * Every plan of the account's workspaces it has not archived that holds an
 * item, open or settled, whichever member's agent posted it, the plan whose
 * item changed latest first.
 */
const findTasksWithItems = SqlSchema.findAll({
  Request: AccountRequestSchema,
  Result: TaskItemsRowSchema,
  execute: ({ userId }) =>
    Database.use((db) =>
      db
        .select({ taskId: inboxItem.taskId, items: count(), updatedAt: LATEST_ITEM })
        .from(inboxItem)
        .innerJoin(task, eq(task.id, inboxItem.taskId))
        .where(and(taskReachableBy(userId), isNull(task.archivedAt)))
        .groupBy(inboxItem.taskId)
        .orderBy(desc(LATEST_ITEM), desc(inboxItem.taskId)),
    ),
});

/** One automation holding items of its runs' agents with no plan, as the account's read lists it; null for the agents no standing automation names. */
const AutomationItemsRowSchema = Schema.Struct({
  automationId: Schema.NullOr(Schema.String),
  items: Schema.Number,
  updatedAt: InstantColumnSchema,
});

/**
 * Every automation whose runs' agents with no plan hold an item in the
 * account's workspaces, open or settled, whichever member's agent posted
 * it, the automation whose item changed latest first, as the plans are
 * listed; one the account may not read is listed as none, beside the
 * agents no standing automation names.
 */
const findAutomationsWithItems = SqlSchema.findAll({
  Request: AccountRequestSchema,
  Result: AutomationItemsRowSchema,
  execute: ({ userId }) =>
    Database.use((db) =>
      db
        .select({ automationId: automation.id, items: count(), updatedAt: LATEST_ITEM })
        .from(inboxItem)
        .innerJoin(codingAgent, eq(codingAgent.id, inboxItem.agentId))
        // An automation the account may not read groups with the agents no standing automation names.
        .leftJoin(
          automation,
          and(eq(automation.id, codingAgent.automationId), automationReadableBy(userId)),
        )
        .where(and(isNull(inboxItem.taskId), itemReachableBy(userId)))
        .groupBy(automation.id)
        .orderBy(desc(LATEST_ITEM), desc(automation.id)),
    ),
});

/** The statements the account's read is subscribed to live: each part of its answer as a row of the wire's own shape. */
export interface AccountInboxLiveStatements {
  readonly items: LiveStatement;
  readonly planless: LiveStatement;
  readonly plans: LiveStatement;
  readonly automations: LiveStatement;
}

/**
 * What waits on the developer across the account, written for Neon Realtime:
 * the same rows, joins, and rule of who may read them as `accountWaitingItems`,
 * `accountTasklessItems`, `accountInboxTasks`, and `accountInboxAutomations`,
 * each column under the key `account-inbox-wire.ts` reads it by and each
 * instant in epoch milliseconds, so a row decodes as the held read's entry
 * does. The order is the reader's to keep, since Realtime keeps none.
 * None where a statement names a value Realtime cannot carry.
 */
export function accountInboxLiveStatements(
  userId: string,
): Option.Option<AccountInboxLiveStatements> {
  const items = queryBuilder
    .select(
      liveSelection(
        {
          id: inboxItem.id,
          planId: inboxItem.taskId,
          agentId: inboxItem.agentId,
          agentTitle: codingAgent.title,
          agentModel: codingAgent.model,
          startedBy: codingAgent.userId,
          title: inboxItem.title,
          revision: inboxItem.revision,
        },
        { postedAt: inboxItem.postedAt, updatedAt: inboxItem.updatedAt },
      ),
    )
    .from(inboxItem)
    .innerJoin(task, eq(task.id, inboxItem.taskId))
    .innerJoin(codingAgent, eq(codingAgent.id, inboxItem.agentId))
    .where(accountWaiting(userId));
  const planless = queryBuilder
    .select(
      liveSelection(
        {
          id: inboxItem.id,
          agentId: inboxItem.agentId,
          agentTitle: codingAgent.title,
          agentModel: codingAgent.model,
          startedBy: codingAgent.userId,
          automationId: automation.id,
          automationName: automation.name,
          repository: codingAgent.repository,
          workspaceId: codingAgent.organizationId,
          title: inboxItem.title,
          revision: inboxItem.revision,
        },
        { postedAt: inboxItem.postedAt, updatedAt: inboxItem.updatedAt },
      ),
    )
    .from(inboxItem)
    .innerJoin(codingAgent, eq(codingAgent.id, inboxItem.agentId))
    .leftJoin(
      automation,
      and(eq(automation.id, codingAgent.automationId), automationReadableBy(userId)),
    )
    .where(tasklessWaiting(userId));
  const plans = queryBuilder
    .select({
      ...liveSelection({ planId: inboxItem.taskId }),
      items: LIVE_COUNT.as("items"),
      updatedAt: liveLatest(inboxItem.updatedAt).as("updatedAt"),
    })
    .from(inboxItem)
    .innerJoin(task, eq(task.id, inboxItem.taskId))
    .where(and(taskReachableBy(userId), isNull(task.archivedAt)))
    .groupBy(inboxItem.taskId);
  const automations = queryBuilder
    .select({
      ...liveSelection({ automationId: automation.id }),
      items: LIVE_COUNT.as("items"),
      updatedAt: liveLatest(inboxItem.updatedAt).as("updatedAt"),
    })
    .from(inboxItem)
    .innerJoin(codingAgent, eq(codingAgent.id, inboxItem.agentId))
    .leftJoin(
      automation,
      and(eq(automation.id, codingAgent.automationId), automationReadableBy(userId)),
    )
    .where(and(isNull(inboxItem.taskId), itemReachableBy(userId)))
    .groupBy(automation.id);
  return Option.all({
    items: liveStatementOf(items),
    planless: liveStatementOf(planless),
    plans: liveStatementOf(plans),
    automations: liveStatementOf(automations),
  });
}

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
    Database.use((db) =>
      db
        .select(INBOX_COLUMNS)
        .from(inboxItem)
        .where(and(eq(inboxItem.id, itemId), itemReachableBy(userId))),
    ),
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
    Database.use((db) =>
      db
        .update(inboxItem)
        .set({
          status: INBOX_STATUS.ANSWERED,
          answer,
          answerKey,
          answeredBy: userId,
          updatedAt: now,
        })
        .where(
          and(
            eq(inboxItem.id, itemId),
            itemReachableBy(userId),
            eq(inboxItem.revision, revision),
            eq(inboxItem.status, INBOX_STATUS.OPEN),
          ),
        )
        .returning(INBOX_COLUMNS),
    ),
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
          organizationId: locked.value.organizationId,
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
            taskId: agent.taskId,
            organizationId: locked.value.organizationId,
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

/** The picture, where it is the item's: its type and its bytes; nothing where the account reaches no such item or the item carries no such picture. */
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
export function taskInboxItems(
  userId: string,
  taskId: string,
): InboxStoreEffect<readonly InboxItem[]> {
  return scopeItems({ userId, scope: INBOX_SCOPE.TASK, id: taskId }, INBOX_BOUNDS.MAX_ITEMS_READ);
}

/** One agent's items as any member of its workspace reads them, an agent with no plan as much as one on a plan: every open one, then the latest settled. */
export function memberAgentInboxItems(
  userId: string,
  agentId: string,
): InboxStoreEffect<readonly InboxItem[]> {
  return scopeItems(
    { userId, scope: INBOX_SCOPE.AGENT_OF_WORKSPACE, id: agentId },
    INBOX_BOUNDS.MAX_ITEMS_READ,
  );
}

/** Where each of the agent's items stands, the same items `memberAgentInboxItems` reads and none of their words: what a held read compares between looks. */
export function memberAgentInboxStamps(
  userId: string,
  agentId: string,
): InboxStoreEffect<readonly InboxStamp[]> {
  return scopeStamps({ userId, scope: INBOX_SCOPE.AGENT_OF_WORKSPACE, id: agentId });
}

/** Where each of the plan's items stands, the same items `planInboxItems` reads and none of their words: what a held read compares between looks. */
export function taskInboxStamps(
  userId: string,
  taskId: string,
): InboxStoreEffect<readonly InboxStamp[]> {
  return scopeStamps({ userId, scope: INBOX_SCOPE.TASK, id: taskId });
}

/** Where the scope's items stand: every open one, then the latest settled, as `scopeItems` reads them. */
function scopeStamps(scope: InboxScope): InboxStoreEffect<readonly InboxStamp[]> {
  return Effect.map(
    Effect.all([
      findOpenStamps(scope),
      findSettledStamps({ ...scope, limit: INBOX_BOUNDS.MAX_ITEMS_READ }),
    ]),
    ([open, settled]) =>
      [...open, ...settled].map((row) => ({ ...row, updatedAt: row.updatedAt.getTime() })),
  );
}

/** The item, with the key its answer was taken under; nothing for one of a workspace the account is not in. */
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
    Database.use((db) =>
      db
        .update(inboxItem)
        .set({
          status: INBOX_STATUS.OPEN,
          answer: null,
          answerKey: null,
          answeredBy: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(inboxItem.id, itemId),
            itemReachableBy(userId),
            eq(inboxItem.answerKey, answerKey),
            eq(inboxItem.status, INBOX_STATUS.ANSWERED),
          ),
        )
        .returning(INBOX_COLUMNS),
    ),
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
    rows.map(({ taskId, ...row }) => ({
      ...row,
      planId: taskId,
      postedAt: row.postedAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    })),
  );
}

/** One open item of an agent with no plan as the account's read carries it, and where it stands. */
type AccountTasklessRow = AccountTasklessEntry & Pick<InboxStamp, "status">;

/**
 * Every item that waits on the developer from an agent with no plan in the
 * account's workspaces, the latest changed first, with the automation and
 * repository that stand in a plan's place; none is left out for being old,
 * as `accountWaitingItems` leaves none out.
 */
export function accountTasklessItems(
  userId: string,
): InboxStoreEffect<readonly AccountTasklessRow[]> {
  return Effect.map(findTasklessWaitingItems({ userId }), (rows) =>
    rows.map(({ workspaceId, ...row }) => ({
      ...row,
      ...(workspaceId === null ? undefined : { workspaceId }),
      postedAt: row.postedAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    })),
  );
}

/** Where each item `accountWaitingItems` and `accountPlanlessItems` read stands, the same items and none of their words: what a held read of the account compares between looks. */
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
export function accountInboxTasks(userId: string): InboxStoreEffect<readonly AccountInboxTask[]> {
  return Effect.map(findTasksWithItems({ userId }), (rows) =>
    rows.map(({ taskId, ...row }) => ({
      ...row,
      planId: taskId,
      updatedAt: row.updatedAt.getTime(),
    })),
  );
}

/** Every automation whose runs' agents with no plan hold an item, waiting or settled, listed as `accountInboxPlans` lists the plans. */
export function accountInboxAutomations(
  userId: string,
): InboxStoreEffect<readonly AccountInboxAutomation[]> {
  return Effect.map(findAutomationsWithItems({ userId }), (rows) =>
    rows.map((row) => ({ ...row, updatedAt: row.updatedAt.getTime() })),
  );
}
