import { randomUUID } from "node:crypto";
import { Database, type DatabaseServices, type QueryError } from "@luke/database/core/query";
import { automationReadableBy } from "@luke/database/models/automation-store";
import {
  answerAsk,
  attachMessageImages,
  ensureGeneral,
  ensureMember,
  ensurePlanChannel,
  postAsk,
  readAttachment,
  resolveAsk,
  withdrawAnswer,
} from "@luke/database/models/chat-store";
import { InstantColumnSchema } from "@luke/database/models/columns";
import {
  AGENT_WORKSPACE,
  agentReachableBy,
  planReachableBy,
  workspaceReachableBy,
} from "@luke/database/models/workspace-store";
import { user } from "@luke/database/schemas/auth";
import { automation } from "@luke/database/schemas/automation";
import { chatChannel, chatMember, chatMessage } from "@luke/database/schemas/chat";
import { codingAgent } from "@luke/database/schemas/coding-agent";
import { plan } from "@luke/database/schemas/plan";
import type {
  AccountInboxAutomation,
  AccountInboxEntry,
  AccountInboxPlan,
  AccountPlanlessEntry,
} from "@luke/features/account-inbox-wire";
import { CHANNEL_KIND, CHAT_BLOCK, chatAskSchema, MEMBER_KIND } from "@luke/features/chat-wire";
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
  inboxReplySchema,
} from "@luke/features/inbox-wire";
import { and, count, desc, eq, isNotNull, isNull, max, ne, or, type SQL, sql } from "drizzle-orm";
import { Effect, Option, Result, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

/**
 * inbox-store.ts -- the developer's inbox: the items a plan's coding agents post, close, and read, and the developer's answers to them.
 *
 * An item is an ask a coding agent posted in its plan's chat channel
 * (`@luke/database/models/chat-store`), so the Inbox and Chat are one
 * record read two ways: the item's id is the message's, its key, revision,
 * status, answer, and reason the ask's, its title and whether the agent
 * needs to hear back the ask's own, its blocks the message's body, posted
 * when the message was, and updated when the message last changed. Every
 * read names the account beside the plan, the agent, or the item, and the
 * plan's inbox is the workspace's: every member of the plan's workspace
 * reads and answers it, gated on that membership (`workspace-store.ts`),
 * so an item of a workspace the account is not in reads and writes exactly
 * as one that names nothing. An agent posts an item under a key of its
 * own: posting under a key it used before writes that ask again, moves its
 * revision on, and opens it again whether it was answered or closed. An
 * image block is posted by a path and kept by an attachment of the
 * message's, under an id minted here, which the block kept names in the
 * path's place; the message's attachments its new blocks no longer name go
 * with the same write. A post counts the agent's open items against the
 * bound under a lock on the agent's own row, so two posts of one step
 * cannot both slip under it. An answer is the answering member's reply in
 * the ask's thread, taken only by the revision it names and only while the
 * item is open, so an answer to an item the agent has since changed is
 * refused rather than taken for what it now asks. What waits across the
 * account, every open item on a plan it has not archived, is read on its
 * own index. Every function is an effect over the ambient `SqlClient` and
 * names no database of its own.
 */

type InboxStoreFailure = QueryError | Schema.SchemaError;

/** What an inbox store operation answers: an effect over the ambient client, composed into whatever called it. */
export type InboxStoreEffect<A> = Effect.Effect<A, InboxStoreFailure, DatabaseServices>;

/** The agent an item belongs to, as every write of the agent's names it. */
export interface InboxAgent {
  readonly userId: string;
  readonly planId: string | null;
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

/** The columns every item read projects, so a row decodes one way whatever wrote it. */
const ITEM_COLUMNS = {
  id: chatMessage.id,
  organizationId: chatMessage.organizationId,
  seq: chatMessage.seq,
  agentId: chatMember.agentId,
  key: chatMessage.askKey,
  revision: chatMessage.askRevision,
  ask: chatMessage.ask,
  blocks: chatMessage.blocks,
  status: chatMessage.askStatus,
  answer: chatMessage.answer,
  answerKey: chatMessage.answerKey,
  // Scalar reads rather than joins, because the author's member is already joined and the answerer is another.
  answeredBy: sql<
    string | null
  >`(select "answerer"."user_id" from "chat_member" as "answerer" where "answerer"."id" = ${chatMessage.answeredByMemberId})`,
  answeredByName: sql<
    string | null
  >`(select ${user.name} from "chat_member" as "answerer" join ${user} on ${user.id} = "answerer"."user_id" where "answerer"."id" = ${chatMessage.answeredByMemberId})`,
  closedReason: chatMessage.closedReason,
  postedAt: chatMessage.createdAt,
  updatedAt: chatMessage.touchedAt,
};

const ItemRowSchema = Schema.Struct({
  id: Schema.String,
  organizationId: Schema.String,
  seq: Schema.Number,
  agentId: Schema.String,
  key: Schema.String,
  revision: Schema.Number,
  ask: chatAskSchema,
  blocks: Schema.Array(inboxBlockSchema),
  status: Schema.Literals(Object.values(INBOX_STATUS)),
  answer: Schema.NullOr(inboxReplySchema),
  answerKey: Schema.NullOr(Schema.String),
  answeredBy: Schema.NullOr(Schema.String),
  answeredByName: Schema.NullOr(Schema.String),
  closedReason: Schema.NullOr(Schema.String),
  postedAt: InstantColumnSchema,
  updatedAt: InstantColumnSchema,
});

type ItemRow = typeof ItemRowSchema.Type;

/** A title for an ask that names none: its first words, on one line, within the title's bound. */
function titleOf(row: Pick<ItemRow, "ask" | "blocks">): string {
  if (row.ask.title !== undefined) return row.ask.title;
  const words = row.blocks.find((block) => block.type === CHAT_BLOCK.MARKDOWN);
  const text = words !== undefined && "text" in words ? words.text : "";
  return text.replace(/\s+/gu, " ").trim().slice(0, INBOX_BOUNDS.MAX_TITLE_CHARS);
}

/** A row as the wire carries the item, each absent field left out rather than null. */
function storedItem(row: ItemRow): StoredInboxItem {
  return {
    item: {
      id: row.id,
      agentId: row.agentId,
      key: row.key,
      revision: row.revision,
      version: INBOX_WIRE_VERSION,
      title: titleOf(row),
      blocks: row.blocks,
      response: row.ask.response,
      needsReply: row.ask.needsReply ?? true,
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

/**
 * The condition that the message a statement reads is an inbox item: an ask
 * an agent's member posted in its plan's channel, or, for an agent with no
 * plan, in its workspace's general channel.
 */
const IS_ITEM = and(
  isNotNull(chatMessage.askKey),
  isNotNull(chatMember.agentId),
  or(
    and(eq(chatChannel.kind, CHANNEL_KIND.PLAN), eq(chatChannel.planId, codingAgent.planId)),
    and(eq(chatChannel.kind, CHANNEL_KIND.GENERAL), isNull(codingAgent.planId)),
  ),
);

/** The condition that the account is a member of the workspace of the item a statement reads, an item of an agent with no plan as much as one on a plan. */
function itemReachableBy(userId: string): SQL {
  return workspaceReachableBy(userId, chatMessage.organizationId);
}

/** The order every read keeps: the latest changed first, and by id among those changed at one place, so two reads of the same rows agree. */
const LATEST_FIRST = [desc(chatMessage.touchedSeq), desc(chatMessage.id)] as const;

/** Where a read looks: one plan's items, any member's agents' alike; one agent's own, under the member who started it; one agent's, as any member of its workspace reads them; or one item. */
const INBOX_SCOPE = {
  PLAN: "plan",
  AGENT: "agent",
  AGENT_OF_WORKSPACE: "agent-of-workspace",
  ITEM: "item",
} as const;

/** Which of a scope's items a read takes: the open ones, the settled ones, or either. */
const ITEM_RUN = {
  OPEN: "open",
  SETTLED: "settled",
  ANY: "any",
} as const;

/** The condition a run of items puts on their status. */
function inRun(run: (typeof ITEM_RUN)[keyof typeof ITEM_RUN]): SQL | undefined {
  switch (run) {
    case ITEM_RUN.OPEN:
      return eq(chatMessage.askStatus, INBOX_STATUS.OPEN);
    case ITEM_RUN.SETTLED:
      return ne(chatMessage.askStatus, INBOX_STATUS.OPEN);
    case ITEM_RUN.ANY:
      return undefined;
  }
}

const ScopeSchema = Schema.Struct({
  userId: Schema.String,
  scope: Schema.Literals(Object.values(INBOX_SCOPE)),
  id: Schema.String,
});

type InboxScope = typeof ScopeSchema.Type;

/** The items a scope names: the plan's, the agent's, or the item's, where the account is a member of their workspace; or the agent's, under the account that started it. */
function inScope(scope: InboxScope): SQL | undefined {
  switch (scope.scope) {
    case INBOX_SCOPE.PLAN:
      return and(eq(chatChannel.planId, scope.id), planReachableBy(scope.userId));
    case INBOX_SCOPE.AGENT_OF_WORKSPACE:
      return and(eq(chatMember.agentId, scope.id), itemReachableBy(scope.userId));
    case INBOX_SCOPE.ITEM:
      return and(eq(chatMessage.id, scope.id), itemReachableBy(scope.userId));
    case INBOX_SCOPE.AGENT:
      return and(
        eq(chatMember.agentId, scope.id),
        eq(codingAgent.userId, scope.userId),
        itemReachableBy(scope.userId),
      );
  }
}

/** The items of a scope in the run named, the latest changed first, as many as the limit where one is given. */
const findItems = SqlSchema.findAll({
  Request: Schema.Struct({
    ...ScopeSchema.fields,
    run: Schema.Literals(Object.values(ITEM_RUN)),
    limit: Schema.NullOr(Schema.Number),
  }),
  Result: ItemRowSchema,
  execute: ({ run, limit, ...scope }) =>
    Database.use((db) => {
      const read = db
        .select(ITEM_COLUMNS)
        .from(chatMessage)
        .innerJoin(chatMember, eq(chatMember.id, chatMessage.authorMemberId))
        .innerJoin(chatChannel, eq(chatChannel.id, chatMessage.channelId))
        .innerJoin(codingAgent, eq(codingAgent.id, chatMember.agentId))
        .leftJoin(plan, eq(plan.id, chatChannel.planId))
        .where(and(IS_ITEM, inScope(scope), inRun(run)))
        .orderBy(...LATEST_FIRST);
      return limit === null ? read : read.limit(limit);
    }),
});

/** The scope's items: every open one, then the latest settled ones up to the limit. */
function scopeItems(
  scope: InboxScope,
  settledLimit: number,
): InboxStoreEffect<readonly InboxItem[]> {
  return Effect.map(
    Effect.all([
      findItems({ ...scope, run: ITEM_RUN.OPEN, limit: null }),
      findItems({ ...scope, run: ITEM_RUN.SETTLED, limit: settledLimit }),
    ]),
    ([open, settled]) => [...open, ...settled].map((row) => storedItem(row).item),
  );
}

/** The item under its id, where the account reaches its plan, as its row. */
function itemRow(userId: string, itemId: string): InboxStoreEffect<Option.Option<ItemRow>> {
  return Effect.map(
    findItems({ userId, scope: INBOX_SCOPE.ITEM, id: itemId, run: ITEM_RUN.ANY, limit: 1 }),
    (rows) => Option.fromNullishOr(rows[0]),
  );
}

/** The agent's row under its own lock, where the account started it and is still a member of its workspace, with that workspace; which serializes one agent's posts. */
const lockAgent = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String }),
  Result: Schema.Struct({ organizationId: Schema.String }),
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db
        .select({ organizationId: AGENT_WORKSPACE })
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

/** How many items the member holds open in the channel its items stand in under a key other than the one given; an ask it posted elsewhere in chat is no item. */
const countOpenBesides = SqlSchema.findOne({
  Request: Schema.Struct({ memberId: Schema.String, channelId: Schema.String, key: Schema.String }),
  Result: Schema.Struct({ open: Schema.Number }),
  execute: ({ memberId, channelId, key }) =>
    Database.use((db) =>
      db
        .select({ open: sql<number>`count(*)::int` })
        .from(chatMessage)
        .where(
          and(
            eq(chatMessage.authorMemberId, memberId),
            eq(chatMessage.channelId, channelId),
            eq(chatMessage.askStatus, INBOX_STATUS.OPEN),
            ne(chatMessage.askKey, key),
          ),
        ),
    ),
});

/** The agent's item under the key, with its member and workspace, where the account started the agent and still reaches its plan; an ask under the key posted elsewhere in chat is no item. */
const findItemByKey = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String, key: Schema.String }),
  Result: Schema.Struct({ memberId: Schema.String, organizationId: Schema.String }),
  execute: ({ userId, agentId, key }) =>
    Database.use((db) =>
      db
        .select({ memberId: chatMember.id, organizationId: chatMember.organizationId })
        .from(chatMessage)
        .innerJoin(chatMember, eq(chatMember.id, chatMessage.authorMemberId))
        .innerJoin(chatChannel, eq(chatChannel.id, chatMessage.channelId))
        .innerJoin(codingAgent, eq(codingAgent.id, chatMember.agentId))
        .where(
          and(
            IS_ITEM,
            inScope({ userId, scope: INBOX_SCOPE.AGENT, id: agentId }),
            eq(chatMessage.askKey, key),
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

/**
 * The open items on the plans of the account's workspaces it has not
 * archived, whichever member's agent posted each: the rows the account's
 * read of what waits names.
 */
function accountWaiting(userId: string): SQL | undefined {
  return and(
    IS_ITEM,
    planReachableBy(userId),
    eq(chatMessage.askStatus, INBOX_STATUS.OPEN),
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
  ask: chatAskSchema,
  blocks: Schema.Array(inboxBlockSchema),
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
          id: chatMessage.id,
          planId: plan.id,
          agentId: codingAgent.id,
          agentTitle: codingAgent.title,
          agentModel: codingAgent.model,
          ask: chatMessage.ask,
          blocks: chatMessage.blocks,
          revision: chatMessage.askRevision,
          status: chatMessage.askStatus,
          postedAt: chatMessage.createdAt,
          updatedAt: chatMessage.touchedAt,
        })
        .from(chatMessage)
        .innerJoin(chatMember, eq(chatMember.id, chatMessage.authorMemberId))
        .innerJoin(chatChannel, eq(chatChannel.id, chatMessage.channelId))
        .innerJoin(plan, eq(plan.id, chatChannel.planId))
        .innerJoin(codingAgent, eq(codingAgent.id, chatMember.agentId))
        .where(accountWaiting(userId))
        .orderBy(...LATEST_FIRST),
    ),
});

/** One plan holding items as the account's read lists it: how many, and when the latest changed. */
const PlanItemsRowSchema = Schema.Struct({
  planId: Schema.String,
  items: Schema.Number,
  updatedAt: InstantColumnSchema,
});

/** When a plan's latest item changed, which orders the plans holding items. */
const LATEST_ITEM = max(chatMessage.touchedAt);

/**
 * Every plan of the account's workspaces it has not archived that holds an
 * item, open or settled, whichever member's agent posted it, the plan whose
 * item changed latest first.
 */
const findPlansWithItems = SqlSchema.findAll({
  Request: AccountRequestSchema,
  Result: PlanItemsRowSchema,
  execute: ({ userId }) =>
    Database.use((db) =>
      db
        .select({ planId: plan.id, items: count(), updatedAt: LATEST_ITEM })
        .from(chatMessage)
        .innerJoin(chatMember, eq(chatMember.id, chatMessage.authorMemberId))
        .innerJoin(chatChannel, eq(chatChannel.id, chatMessage.channelId))
        .innerJoin(plan, eq(plan.id, chatChannel.planId))
        .innerJoin(codingAgent, eq(codingAgent.id, chatMember.agentId))
        .where(and(IS_ITEM, planReachableBy(userId), isNull(plan.archivedAt)))
        .groupBy(plan.id)
        .orderBy(desc(LATEST_ITEM), desc(plan.id)),
    ),
});

/** The open items of agents with no plan in the account's workspaces, whichever member's agent posted each: what the account's read names beside the plans' items. */
function planlessWaiting(userId: string): SQL | undefined {
  return and(
    IS_ITEM,
    isNull(codingAgent.planId),
    itemReachableBy(userId),
    eq(chatMessage.askStatus, INBOX_STATUS.OPEN),
  );
}

/** One open item of an agent with no plan as the account's read carries it, with its automation and repository where a plan's item names its plan. */
const PlanlessRowSchema = Schema.Struct({
  id: Schema.String,
  agentId: Schema.String,
  agentTitle: Schema.NullOr(Schema.String),
  agentModel: Schema.String,
  automationId: Schema.NullOr(Schema.String),
  automationName: Schema.NullOr(Schema.String),
  repository: Schema.String,
  ask: chatAskSchema,
  blocks: Schema.Array(inboxBlockSchema),
  revision: Schema.Number,
  status: Schema.Literals(Object.values(INBOX_STATUS)),
  postedAt: InstantColumnSchema,
  updatedAt: InstantColumnSchema,
});

const findPlanlessWaitingItems = SqlSchema.findAll({
  Request: AccountRequestSchema,
  Result: PlanlessRowSchema,
  execute: ({ userId }) =>
    Database.use((db) =>
      db
        .select({
          id: chatMessage.id,
          agentId: codingAgent.id,
          agentTitle: codingAgent.title,
          agentModel: codingAgent.model,
          automationId: automation.id,
          automationName: automation.name,
          repository: codingAgent.repository,
          ask: chatMessage.ask,
          blocks: chatMessage.blocks,
          revision: chatMessage.askRevision,
          status: chatMessage.askStatus,
          postedAt: chatMessage.createdAt,
          updatedAt: chatMessage.touchedAt,
        })
        .from(chatMessage)
        .innerJoin(chatMember, eq(chatMember.id, chatMessage.authorMemberId))
        .innerJoin(chatChannel, eq(chatChannel.id, chatMessage.channelId))
        .innerJoin(codingAgent, eq(codingAgent.id, chatMember.agentId))
        // The automation, its id as its name, is told only to an account that may read the automation itself.
        .leftJoin(
          automation,
          and(eq(automation.id, codingAgent.automationId), automationReadableBy(userId)),
        )
        .where(planlessWaiting(userId))
        .orderBy(...LATEST_FIRST),
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
 * account's workspaces, open or settled, the automation whose item changed
 * latest first, as the plans are listed; one the account may not read is
 * listed as none, beside the agents no standing automation names.
 */
const findAutomationsWithItems = SqlSchema.findAll({
  Request: AccountRequestSchema,
  Result: AutomationItemsRowSchema,
  execute: ({ userId }) =>
    Database.use((db) =>
      db
        .select({ automationId: automation.id, items: count(), updatedAt: LATEST_ITEM })
        .from(chatMessage)
        .innerJoin(chatMember, eq(chatMember.id, chatMessage.authorMemberId))
        .innerJoin(chatChannel, eq(chatChannel.id, chatMessage.channelId))
        .innerJoin(codingAgent, eq(codingAgent.id, chatMember.agentId))
        // An automation the account may not read groups with the agents no standing automation names.
        .leftJoin(
          automation,
          and(eq(automation.id, codingAgent.automationId), automationReadableBy(userId)),
        )
        .where(and(IS_ITEM, isNull(codingAgent.planId), itemReachableBy(userId)))
        .groupBy(automation.id)
        .orderBy(desc(LATEST_ITEM), desc(automation.id)),
    ),
});

/** Runs the effect in one transaction on the ambient client. */
function transaction<A>(body: InboxStoreEffect<A>): InboxStoreEffect<A> {
  return Effect.flatMap(SqlClient.SqlClient, (client) => client.withTransaction(body));
}

/** The account's own member in the item's workspace, minted the first time it answers there. */
function personIn(userId: string, organizationId: string) {
  return ensureMember(userId, organizationId, { kind: MEMBER_KIND.HUMAN, userId });
}

/** The item as it now stands, read again after a write, which it is the account's to read. */
function reread(userId: string, itemId: string): InboxStoreEffect<Option.Option<InboxItem>> {
  return Effect.map(
    itemRow(userId, itemId),
    Option.map((row) => storedItem(row).item),
  );
}

/**
 * The agent's post written: a new item under its key, or the one standing
 * under it written again and opened; refused where the agent would hold
 * more open items than the bound, or is no longer the account's. The
 * pictures are the post's image blocks' bytes in the blocks' own order, one
 * each, read by the caller; each is kept as an attachment of the item's
 * under an id minted here, and the item's other attachments are deleted.
 * Note that the post's own key is not counted, because writing it again
 * opens no second item.
 */
export function postInboxItem(
  agent: InboxAgent,
  post: InboxPost,
  images: readonly InboxImage[] = [],
): InboxStoreEffect<Result.Result<InboxItem, InboxPostRefusal>> {
  return transaction(
    Effect.gen(function* () {
      const { userId } = agent;
      const locked = yield* lockAgent(agent);
      if (Option.isNone(locked)) return Result.fail(INBOX_POST_REFUSAL.NO_AGENT);
      const { organizationId } = locked.value;
      const member = yield* ensureMember(userId, organizationId, {
        kind: MEMBER_KIND.AGENT,
        agentId: agent.agentId,
      });
      // An agent with no plan keeps its items in its workspace's general channel.
      const channel =
        agent.planId === null
          ? yield* ensureGeneral(userId, organizationId)
          : yield* ensurePlanChannel(userId, agent.planId);
      if (Option.isNone(member) || Option.isNone(channel)) {
        return Result.fail(INBOX_POST_REFUSAL.NO_AGENT);
      }
      const { open } = yield* countOpenBesides({
        memberId: member.value.id,
        channelId: channel.value.id,
        key: post.key,
      }).pipe(
        // A count that returned no row is the database breaking its own contract, not an outcome.
        Effect.catchTag("NoSuchElementError", Effect.die),
      );
      if (open >= INBOX_BOUNDS.MAX_OPEN_PER_AGENT) {
        return Result.fail(INBOX_POST_REFUSAL.TOO_MANY_OPEN);
      }
      const attachments = yield* Effect.sync(() =>
        images.map((image) => ({ ...image, id: randomUUID() })),
      );
      const clientKey = yield* Effect.sync(() => randomUUID());
      const posted = yield* postAsk(userId, organizationId, {
        authorMemberId: member.value.id,
        to: { channelId: channel.value.id },
        blocks: storedBlocks(
          post.blocks ?? [],
          attachments.map((attachment) => attachment.id),
        ),
        mentions: [],
        clientKey,
        key: post.key,
        ask: { title: post.title, response: post.response, needsReply: post.needsReply ?? true },
      });
      // An agent that left, or whose key names an ask it posted elsewhere in chat, posts no item.
      if (Result.isFailure(posted)) return Result.fail(INBOX_POST_REFUSAL.NO_AGENT);
      const { message } = posted.success;
      yield* attachMessageImages(userId, organizationId, member.value.id, message.id, attachments);
      const item = yield* reread(userId, message.id);
      return Option.match(item, {
        onNone: () => Result.fail(INBOX_POST_REFUSAL.NO_AGENT),
        onSome: (stands) => Result.succeed(stands),
      });
    }),
  );
}

/** The picture, where it is the item's: its type and its bytes; nothing where the account reaches no such item or the item carries no such picture. */
export function readInboxAttachment(
  userId: string,
  itemId: string,
  attachmentId: string,
): InboxStoreEffect<Option.Option<InboxImage>> {
  return Effect.gen(function* () {
    const row = yield* itemRow(userId, itemId);
    if (Option.isNone(row)) return Option.none();
    return yield* readAttachment(userId, row.value.organizationId, itemId, attachmentId);
  });
}

/** The agent's item under the key closed with why; nothing where it has none under the key. */
export function closeInboxItem(
  agent: Pick<InboxAgent, "userId" | "agentId">,
  key: string,
  reason: string,
): InboxStoreEffect<Option.Option<InboxItem>> {
  return Effect.gen(function* () {
    const found = yield* findItemByKey({ ...agent, key });
    if (Option.isNone(found)) return Option.none();
    const { memberId, organizationId } = found.value;
    const closed = yield* resolveAsk(agent.userId, organizationId, memberId, key, reason);
    if (Option.isNone(closed)) return Option.none();
    return yield* reread(agent.userId, closed.value.id);
  });
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
export function planInboxStamps(
  userId: string,
  planId: string,
): InboxStoreEffect<readonly InboxStamp[]> {
  return scopeStamps({ userId, scope: INBOX_SCOPE.PLAN, id: planId });
}

/** Where the scope's items stand: every open one, then the latest settled, as `scopeItems` reads them. */
function scopeStamps(scope: InboxScope): InboxStoreEffect<readonly InboxStamp[]> {
  return Effect.map(scopeItems(scope, INBOX_BOUNDS.MAX_ITEMS_READ), (items) =>
    items.map(({ id, revision, status, updatedAt }) => ({ id, revision, status, updatedAt })),
  );
}

/** The item, with the key its answer was taken under; nothing for one of a workspace the account is not in. */
export function readInboxItem(
  userId: string,
  itemId: string,
): InboxStoreEffect<Option.Option<StoredInboxItem>> {
  return Effect.map(itemRow(userId, itemId), Option.map(storedItem));
}

/** The answer taken under the key withdrawn, the item open again, where it still stands and is the account's own; nothing where it does not. */
export function withdrawInboxAnswer(
  userId: string,
  itemId: string,
  answerKey: string,
): InboxStoreEffect<Option.Option<InboxItem>> {
  return transaction(
    Effect.gen(function* () {
      const row = yield* itemRow(userId, itemId);
      if (Option.isNone(row)) return Option.none();
      const person = yield* personIn(userId, row.value.organizationId);
      if (Option.isNone(person)) return Option.none();
      const reopened = yield* withdrawAnswer(
        userId,
        row.value.organizationId,
        person.value.id,
        row.value.seq,
        answerKey,
      );
      if (Option.isNone(reopened)) return Option.none();
      return yield* reread(userId, itemId);
    }),
  );
}

/** The developer's answer taken on the item at the revision named, under the key the client sent it with, as their reply in its thread; nothing where the item is no longer open at that revision. */
export function answerInboxItem(
  userId: string,
  itemId: string,
  revision: number,
  answer: InboxReply,
  answerKey: string,
): InboxStoreEffect<Option.Option<InboxItem>> {
  return transaction(
    Effect.gen(function* () {
      const row = yield* itemRow(userId, itemId);
      if (Option.isNone(row)) return Option.none();
      const person = yield* personIn(userId, row.value.organizationId);
      if (Option.isNone(person)) return Option.none();
      const answered = yield* answerAsk(userId, row.value.organizationId, {
        answererMemberId: person.value.id,
        seq: row.value.seq,
        revision,
        reply: answer,
        clientKey: answerKey,
      });
      if (Result.isFailure(answered) || !answered.success.taken) return Option.none();
      return yield* reread(userId, itemId);
    }),
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
    rows.map(({ ask, blocks, ...row }) => ({
      ...row,
      title: titleOf({ ask, blocks }),
      postedAt: row.postedAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    })),
  );
}

/** One open item of an agent with no plan as the account's read carries it, and where it stands. */
type AccountPlanlessRow = AccountPlanlessEntry & Pick<InboxStamp, "status">;

/**
 * Every item that waits on the developer from an agent with no plan in the
 * account's workspaces, the latest changed first, with the automation and
 * repository that stand in a plan's place; none is left out for being old,
 * as `accountWaitingItems` leaves none out.
 */
export function accountPlanlessItems(
  userId: string,
): InboxStoreEffect<readonly AccountPlanlessRow[]> {
  return Effect.map(findPlanlessWaitingItems({ userId }), (rows) =>
    rows.map(({ ask, blocks, ...row }) => ({
      ...row,
      title: titleOf({ ask, blocks }),
      postedAt: row.postedAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    })),
  );
}

/** Where each item `accountWaitingItems` and `accountPlanlessItems` read stands, the same items and none of their words: what a held read of the account compares between looks. */
export function accountWaitingStamps(userId: string): InboxStoreEffect<readonly InboxStamp[]> {
  return Effect.map(
    Effect.all([accountWaitingItems(userId), accountPlanlessItems(userId)]),
    ([planned, planless]) =>
      [...planned, ...planless]
        .toSorted((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? 1 : -1))
        .map(({ id, revision, status, updatedAt }) => ({ id, revision, status, updatedAt })),
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

/** Every automation whose runs' agents with no plan hold an item, waiting or settled, listed as `accountInboxPlans` lists the plans. */
export function accountInboxAutomations(
  userId: string,
): InboxStoreEffect<readonly AccountInboxAutomation[]> {
  return Effect.map(findAutomationsWithItems({ userId }), (rows) =>
    rows.map((row) => ({ ...row, updatedAt: row.updatedAt.getTime() })),
  );
}
