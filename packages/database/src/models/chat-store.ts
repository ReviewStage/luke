import {
  ASK_STATUS,
  type AskStatus,
  CHANNEL_KIND,
  CHAT_BLOCK,
  CHAT_BOUNDS,
  type ChatAsk,
  type ChatBlock,
  type ChatImageType,
  type ChatReadBlock,
  type ChatReply,
  chatAskSchema,
  chatBlockSchema,
  chatImageTypeSchema,
  chatReadBlockSchema,
  chatReplySchema,
  formValueLines,
  GENERAL_CHANNEL,
  MEMBER_KIND,
  PLANNER_HANDLE,
  replyWords,
} from "@luke/features/chat-wire";
import {
  and,
  asc,
  type Column,
  count,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  max,
  ne,
  notExists,
  notInArray,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { DateTime, Effect, Option, Result, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError, queryBuilder } from "../core/query.js";
import { member, organization, user } from "../schemas/auth.js";
import {
  chatAttachment,
  chatChannel,
  chatMember,
  chatMessage,
  chatRead,
  workspaceChat,
} from "../schemas/chat.js";
import { codingAgent } from "../schemas/coding-agent.js";
import { task } from "../schemas/task.js";
import { InstantColumnSchema } from "./columns.js";
import { isWorkspaceMember, taskReachableBy } from "./workspace-store.js";

/**
 * chat-store.ts -- a workspace's chat as the store keeps it: its members and its channels.
 *
 * Every function is an effect over the ambient database, gated on the
 * account acting: a person in the workspace, or the account that started
 * the coding agent or the plan acting, which must be in the workspace too.
 * A workspace that account is not in reads as nothing. A member is minted
 * once under the workspace's lock, the `organization` row held for the
 * transaction, so two mints at once take turns over the handles and
 * ordinals standing and never mint one twice; a channel a name is picked
 * for is made under the same lock. A person's handle is a slug of their
 * name with `-2`, `-3`, … on a clash, and never `luke` or an agent's
 * `agent-N`, which are spoken for. A channel is found or made by what names
 * it, the general one by its name, a plan's by its plan, a DM by its pair,
 * so asking twice answers the same row. A member joins at the workspace's
 * head: its cursor starts at the last place the sequence handed out, so its
 * unread is what is said after it joined, and what came before stays in
 * the history.
 *
 * A message takes the next place in the workspace's chat sequence, minted
 * under the `workspace_chat` row's lock, so the places posts take are
 * contiguous however many land at once and a post rolled back takes none.
 * A person reads every channel of the workspace, every DM included, so
 * the people of a workspace can follow its agents talking; an agent or a
 * planner reads every channel but a DM, and the DMs it is one of. Only a
 * DM's two members post in it. A member's
 * unread is what it may see that someone else posted or changed past its
 * cursor in each channel, the greater of the place it read that channel to
 * and the floor it read every channel to: a read of one channel moves that
 * channel's cursor alone, and a read of every channel moves the floor. The
 * one notice a member is told stands until its cursor in the notice's
 * channel passes it.
 */

/** What a chat store effect answers: an effect over the ambient database. */
export type ChatStoreEffect<A> = Effect.Effect<
  A,
  QueryError | Schema.SchemaError,
  DatabaseServices
>;

/** Why a topic channel was not opened. */
export const CHAT_REFUSAL = {
  /** The account is not in the workspace, or what it names is not of it or not its to post in. */
  NOT_FOUND: "not-found",
  /** A channel of another kind, or an archived one, already stands under the name. */
  NAME_TAKEN: "name-taken",
  /** The workspace keeps as many topic channels open as it may. */
  TOO_MANY_TOPICS: "too-many-topics",
  /** The member posting has left: an archived agent or plan says nothing more. */
  AUTHOR_LEFT: "author-left",
  /** The channel is archived and takes no post. */
  CHANNEL_ARCHIVED: "channel-archived",
  /** The post's client key already names another member's message in the channel, or another message than the ask. */
  KEY_TAKEN: "key-taken",
  /** The ask's key names an ask the author posted in another channel or thread, where it stays. */
  ASK_ELSEWHERE: "ask-elsewhere",
} as const;

export type ChatRefusal = (typeof CHAT_REFUSAL)[keyof typeof CHAT_REFUSAL];

/** Who a member stands for: a person in the workspace, a coding agent on one of its plans, or one of its plans' planner. */
export type ChatMemberSubject =
  | { readonly kind: typeof MEMBER_KIND.HUMAN; readonly userId: string }
  | { readonly kind: typeof MEMBER_KIND.AGENT; readonly agentId: string }
  | { readonly kind: typeof MEMBER_KIND.PLANNER; readonly planId: string };

/** The most messages a window's read past its cursor answers with; the rest are read from the cursor it hands back. */
const MAX_PAST = 200;

/** The UTF-16 code units that open a surrogate pair, which a cut between two characters never follows. */
const HIGH_SURROGATE = { FIRST: 0xd800, LAST: 0xdbff } as const;

/** The orders a read of messages keeps: oldest change first, or newest place first. */
const READ_ORDER = {
  TOUCHED: "touched",
  NEWEST: "newest",
} as const;

type ReadOrder = (typeof READ_ORDER)[keyof typeof READ_ORDER];

/** The longest a person's handle is spelled before a clash's suffix. */
const MAX_HANDLE_STEM_CHARS = 32;

/** The handle a person's name spells nothing of. */
const FALLBACK_HANDLE = "member";

/** The handles no person is minted: every planner's, and the shape of an agent's. */
const SPOKEN_FOR = /^(luke|agent-\d+)$/u;

const ChatMemberRowSchema = Schema.Struct({
  id: Schema.String,
  organizationId: Schema.String,
  kind: Schema.Literals(Object.values(MEMBER_KIND)),
  userId: Schema.NullOr(Schema.String),
  agentId: Schema.NullOr(Schema.String),
  planId: Schema.NullOr(Schema.String),
  handle: Schema.String,
  ordinal: Schema.Number,
  readSeq: Schema.Number,
  noticeSeq: Schema.NullOr(Schema.Number),
  joinedAt: InstantColumnSchema,
  leftAt: Schema.NullOr(InstantColumnSchema),
});

/** One member as the store keeps it. */
export type ChatMemberRow = typeof ChatMemberRowSchema.Type;

const ChatChannelRowSchema = Schema.Struct({
  id: Schema.String,
  organizationId: Schema.String,
  kind: Schema.Literals(Object.values(CHANNEL_KIND)),
  name: Schema.NullOr(Schema.String),
  planId: Schema.NullOr(Schema.String),
  dmAMemberId: Schema.NullOr(Schema.String),
  dmBMemberId: Schema.NullOr(Schema.String),
  createdByMemberId: Schema.NullOr(Schema.String),
  createdAt: InstantColumnSchema,
  archivedAt: Schema.NullOr(InstantColumnSchema),
});

/** One channel as the store keeps it. */
export type ChatChannelRow = typeof ChatChannelRowSchema.Type;

const ChatMessageRowSchema = Schema.Struct({
  id: Schema.String,
  organizationId: Schema.String,
  channelId: Schema.String,
  seq: Schema.Number,
  touchedSeq: Schema.Number,
  parentId: Schema.NullOr(Schema.String),
  authorMemberId: Schema.String,
  blocks: Schema.Array(chatReadBlockSchema),
  mentions: Schema.Array(Schema.String),
  clientKey: Schema.String,
  createdAt: InstantColumnSchema,
  touchedAt: InstantColumnSchema,
  ask: Schema.NullOr(chatAskSchema),
  askKey: Schema.NullOr(Schema.String),
  askRevision: Schema.NullOr(Schema.Number),
  askStatus: Schema.NullOr(Schema.Literals(Object.values(ASK_STATUS))),
  answer: Schema.NullOr(chatReplySchema),
  answerKey: Schema.NullOr(Schema.String),
  answeredByMemberId: Schema.NullOr(Schema.String),
  closedReason: Schema.NullOr(Schema.String),
});

/** One message as the store keeps it. */
export type ChatMessageRow = typeof ChatMessageRowSchema.Type;

/**
 * A post as its poster makes it: the member posting, where it goes, a
 * channel or the message it replies to by its place, which posts in that
 * message's channel and threads under its root, the body, the handles its
 * words mention, and the poster's key for the post.
 */
export interface ChatPost {
  readonly authorMemberId: string;
  readonly to: { readonly channelId: string } | { readonly replyTo: number };
  readonly blocks: readonly ChatBlock[];
  readonly mentions: readonly string[];
  readonly clientKey: string;
}

/** What a post came to: the message, whether it already stood under the key, and the handles mentioned that name no member. */
export interface ChatPosted {
  readonly message: ChatMessageRow;
  readonly repeated: boolean;
  readonly unresolved: readonly string[];
}

/** A read of a member's unread: the messages, oldest change first, and whether more wait past them. */
export interface ChatUnread {
  readonly messages: readonly ChatMessageRow[];
  readonly more: boolean;
}

/** A member's unread as a turn is handed it: the page, whether more waits, and the place a read of it moves the cursor to. */
export interface ChatUnreadPage extends ChatUnread {
  readonly through: number;
}

/** Where a read of unread looks: one channel, or every channel the member may see where none is named; and a page's size. */
export interface ChatUnreadQuery {
  readonly channelId?: string | undefined;
  readonly limit?: number | undefined;
}

/** How many messages wait unread in one channel. */
export interface ChatUnreadCount {
  readonly channelId: string;
  readonly unread: number;
}

/** Where a read of history looks: a channel, a thread by its root's place, and a place to read back from. */
export interface ChatHistoryQuery {
  readonly channelId?: string | undefined;
  readonly thread?: number | undefined;
  readonly before?: number | undefined;
  readonly limit?: number | undefined;
}

/** A window's read past its cursor: what changed past it, oldest first, and the cursor to read on from. */
export interface ChatPast {
  readonly messages: readonly ChatMessageRow[];
  readonly cursor: number;
}

const MEMBER_COLUMNS = {
  id: chatMember.id,
  organizationId: chatMember.organizationId,
  kind: chatMember.kind,
  userId: chatMember.userId,
  agentId: chatMember.agentId,
  planId: chatMember.planId,
  handle: chatMember.handle,
  ordinal: chatMember.ordinal,
  readSeq: chatMember.readSeq,
  noticeSeq: chatMember.noticeSeq,
  joinedAt: chatMember.joinedAt,
  leftAt: chatMember.leftAt,
};

const CHANNEL_COLUMNS = {
  id: chatChannel.id,
  organizationId: chatChannel.organizationId,
  kind: chatChannel.kind,
  name: chatChannel.name,
  planId: chatChannel.planId,
  dmAMemberId: chatChannel.dmAMemberId,
  dmBMemberId: chatChannel.dmBMemberId,
  createdByMemberId: chatChannel.createdByMemberId,
  createdAt: chatChannel.createdAt,
  archivedAt: chatChannel.archivedAt,
};

const MESSAGE_COLUMNS = {
  id: chatMessage.id,
  organizationId: chatMessage.organizationId,
  channelId: chatMessage.channelId,
  seq: chatMessage.seq,
  touchedSeq: chatMessage.touchedSeq,
  parentId: chatMessage.parentId,
  authorMemberId: chatMessage.authorMemberId,
  blocks: chatMessage.blocks,
  mentions: chatMessage.mentions,
  clientKey: chatMessage.clientKey,
  createdAt: chatMessage.createdAt,
  touchedAt: chatMessage.touchedAt,
  ask: chatMessage.ask,
  askKey: chatMessage.askKey,
  askRevision: chatMessage.askRevision,
  askStatus: chatMessage.askStatus,
  answer: chatMessage.answer,
  answerKey: chatMessage.answerKey,
  answeredByMemberId: chatMessage.answeredByMemberId,
  closedReason: chatMessage.closedReason,
};

const OrganizationKeySchema = Schema.Struct({ organizationId: Schema.String });

/** The workspace's row, held for the transaction, which is what serializes its mints and its channel names. */
const lockWorkspace = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ id: Schema.String }),
  execute: (organizationId) =>
    Database.use((db) =>
      db
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.id, organizationId))
        .for("update"),
    ),
});

const SubjectKeySchema = Schema.Struct({
  organizationId: Schema.String,
  kind: Schema.Literals(Object.values(MEMBER_KIND)),
  subjectId: Schema.String,
});

/** The column a subject of each kind is named by. */
const SUBJECT_COLUMN = {
  [MEMBER_KIND.HUMAN]: chatMember.userId,
  [MEMBER_KIND.AGENT]: chatMember.agentId,
  [MEMBER_KIND.PLANNER]: chatMember.planId,
} as const;

const findMemberOfSubject = SqlSchema.findOneOption({
  Request: SubjectKeySchema,
  Result: ChatMemberRowSchema,
  execute: (key) =>
    Database.use((db) =>
      db
        .select(MEMBER_COLUMNS)
        .from(chatMember)
        .where(
          and(
            eq(chatMember.organizationId, key.organizationId),
            eq(SUBJECT_COLUMN[key.kind], key.subjectId),
          ),
        ),
    ),
});

const findMembers = SqlSchema.findAll({
  Request: OrganizationKeySchema,
  Result: ChatMemberRowSchema,
  execute: (key) =>
    Database.use((db) =>
      db
        .select(MEMBER_COLUMNS)
        .from(chatMember)
        .where(eq(chatMember.organizationId, key.organizationId))
        .orderBy(asc(chatMember.joinedAt), asc(chatMember.kind), asc(chatMember.ordinal)),
    ),
});

const findLastOrdinal = SqlSchema.findOne({
  Request: Schema.Struct({
    organizationId: Schema.String,
    kind: Schema.Literals(Object.values(MEMBER_KIND)),
  }),
  Result: Schema.Struct({ last: Schema.NullOr(Schema.Number) }),
  execute: (key) =>
    Database.use((db) =>
      db
        .select({ last: max(chatMember.ordinal) })
        .from(chatMember)
        .where(
          and(eq(chatMember.organizationId, key.organizationId), eq(chatMember.kind, key.kind)),
        ),
    ),
});

/** Every handle a person or agent of the workspace holds, which a person's mint must step past. */
const findHandles = SqlSchema.findAll({
  Request: OrganizationKeySchema,
  Result: Schema.Struct({ handle: Schema.String }),
  execute: (key) =>
    Database.use((db) =>
      db
        .select({ handle: chatMember.handle })
        .from(chatMember)
        .where(
          and(
            eq(chatMember.organizationId, key.organizationId),
            ne(chatMember.kind, MEMBER_KIND.PLANNER),
          ),
        ),
    ),
});

const findAccountName = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ name: Schema.String }),
  execute: (userId) =>
    Database.use((db) => db.select({ name: user.name }).from(user).where(eq(user.id, userId))),
});

/** The workspace an agent was started in, which it keeps whether or not it works a plan. */
const findAgentWorkspace = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ organizationId: Schema.NullOr(Schema.String) }),
  execute: (agentId) =>
    Database.use((db) =>
      db
        .select({ organizationId: codingAgent.organizationId })
        .from(codingAgent)
        .where(eq(codingAgent.id, agentId)),
    ),
});

/** A plan the account reaches, with its workspace and its name. */
const findReachablePlan = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, planId: Schema.String }),
  Result: Schema.Struct({
    organizationId: Schema.String,
    name: Schema.String,
    archivedAt: Schema.NullOr(InstantColumnSchema),
  }),
  execute: ({ userId, planId }) =>
    Database.use((db) =>
      db
        .select({
          organizationId: task.organizationId,
          name: task.name,
          archivedAt: task.archivedAt,
        })
        .from(task)
        .where(and(eq(task.id, planId), taskReachableBy(userId))),
    ),
});

const findPlanWorkspace = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: OrganizationKeySchema,
  execute: (planId) =>
    Database.use((db) =>
      db.select({ organizationId: task.organizationId }).from(task).where(eq(task.id, planId)),
    ),
});

const insertMember = SqlSchema.findOne({
  Request: Schema.Struct({
    organizationId: Schema.String,
    kind: Schema.Literals(Object.values(MEMBER_KIND)),
    userId: Schema.NullOr(Schema.String),
    agentId: Schema.NullOr(Schema.String),
    planId: Schema.NullOr(Schema.String),
    handle: Schema.String,
    ordinal: Schema.Number,
    now: Schema.Date,
  }),
  Result: ChatMemberRowSchema,
  execute: (row) =>
    Database.use((db) =>
      db
        .insert(chatMember)
        .values({
          organizationId: row.organizationId,
          kind: row.kind,
          userId: row.userId,
          agentId: row.agentId,
          planId: row.planId,
          handle: row.handle,
          ordinal: row.ordinal,
          joinedAt: row.now,
          // A member joins at the workspace's head, so what it has not read starts with what is said after.
          readSeq: sql`coalesce((select ${workspaceChat.nextSeq} - 1 from ${workspaceChat} where ${workspaceChat.organizationId} = ${row.organizationId}), 0)`,
        })
        .returning(MEMBER_COLUMNS),
    ),
});

const findMemberInWorkspace = SqlSchema.findOneOption({
  Request: Schema.Struct({ organizationId: Schema.String, memberId: Schema.String }),
  Result: ChatMemberRowSchema,
  execute: (key) =>
    Database.use((db) =>
      db
        .select(MEMBER_COLUMNS)
        .from(chatMember)
        .where(
          and(eq(chatMember.organizationId, key.organizationId), eq(chatMember.id, key.memberId)),
        ),
    ),
});

/** The member of the workspace, its row held for the transaction, which serializes one member's reads of its cursor. */
const lockMemberInWorkspace = SqlSchema.findOneOption({
  Request: Schema.Struct({ organizationId: Schema.String, memberId: Schema.String }),
  Result: ChatMemberRowSchema,
  execute: (key) =>
    Database.use((db) =>
      db
        .select(MEMBER_COLUMNS)
        .from(chatMember)
        .where(
          and(eq(chatMember.organizationId, key.organizationId), eq(chatMember.id, key.memberId)),
        )
        .for("update"),
    ),
});

const stampLeft = SqlSchema.findAll({
  Request: Schema.Struct({
    organizationId: Schema.String,
    memberId: Schema.String,
    now: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: (key) =>
    Database.use((db) =>
      db
        .update(chatMember)
        .set({ leftAt: key.now })
        .where(
          and(
            eq(chatMember.organizationId, key.organizationId),
            eq(chatMember.id, key.memberId),
            ne(chatMember.kind, MEMBER_KIND.HUMAN),
            isNull(chatMember.leftAt),
          ),
        )
        .returning({ id: chatMember.id }),
    ),
});

const findChannelByName = SqlSchema.findOneOption({
  Request: Schema.Struct({ organizationId: Schema.String, name: Schema.String }),
  Result: ChatChannelRowSchema,
  execute: (key) =>
    Database.use((db) =>
      db
        .select(CHANNEL_COLUMNS)
        .from(chatChannel)
        .where(
          and(eq(chatChannel.organizationId, key.organizationId), eq(chatChannel.name, key.name)),
        ),
    ),
});

const findPlanChannel = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: ChatChannelRowSchema,
  execute: (planId) =>
    Database.use((db) =>
      db
        .select(CHANNEL_COLUMNS)
        .from(chatChannel)
        .where(and(eq(chatChannel.planId, planId), eq(chatChannel.kind, CHANNEL_KIND.PLAN))),
    ),
});

const findDm = SqlSchema.findOneOption({
  Request: Schema.Struct({
    organizationId: Schema.String,
    dmAMemberId: Schema.String,
    dmBMemberId: Schema.String,
  }),
  Result: ChatChannelRowSchema,
  execute: (key) =>
    Database.use((db) =>
      db
        .select(CHANNEL_COLUMNS)
        .from(chatChannel)
        .where(
          and(
            eq(chatChannel.organizationId, key.organizationId),
            eq(chatChannel.kind, CHANNEL_KIND.DM),
            eq(chatChannel.dmAMemberId, key.dmAMemberId),
            eq(chatChannel.dmBMemberId, key.dmBMemberId),
          ),
        ),
    ),
});

const findChannels = SqlSchema.findAll({
  Request: OrganizationKeySchema,
  Result: ChatChannelRowSchema,
  execute: (key) =>
    Database.use((db) =>
      db
        .select(CHANNEL_COLUMNS)
        .from(chatChannel)
        .where(eq(chatChannel.organizationId, key.organizationId))
        .orderBy(asc(chatChannel.createdAt), asc(chatChannel.id)),
    ),
});

const countOpenTopics = SqlSchema.findOne({
  Request: OrganizationKeySchema,
  Result: Schema.Struct({ open: Schema.Number }),
  execute: (key) =>
    Database.use((db) =>
      db
        .select({ open: sql<number>`count(*)::int` })
        .from(chatChannel)
        .where(
          and(
            eq(chatChannel.organizationId, key.organizationId),
            eq(chatChannel.kind, CHANNEL_KIND.TOPIC),
            isNull(chatChannel.archivedAt),
          ),
        ),
    ),
});

const insertChannel = SqlSchema.findAll({
  Request: Schema.Struct({
    organizationId: Schema.String,
    kind: Schema.Literals(Object.values(CHANNEL_KIND)),
    name: Schema.NullOr(Schema.String),
    planId: Schema.NullOr(Schema.String),
    dmAMemberId: Schema.NullOr(Schema.String),
    dmBMemberId: Schema.NullOr(Schema.String),
    createdByMemberId: Schema.NullOr(Schema.String),
    archivedAt: Schema.optionalKey(Schema.NullOr(Schema.Date)),
    now: Schema.Date,
  }),
  Result: ChatChannelRowSchema,
  execute: (row) =>
    Database.use((db) =>
      db
        .insert(chatChannel)
        .values({
          archivedAt: row.archivedAt ?? null,
          organizationId: row.organizationId,
          kind: row.kind,
          name: row.name,
          planId: row.planId,
          dmAMemberId: row.dmAMemberId,
          dmBMemberId: row.dmBMemberId,
          createdByMemberId: row.createdByMemberId,
          createdAt: row.now,
        })
        .onConflictDoNothing()
        .returning(CHANNEL_COLUMNS),
    ),
});

/** The workspace's sequence row, made where its first post finds none. */
const ensureSequence = SqlSchema.void({
  Request: OrganizationKeySchema,
  execute: (key) =>
    Database.use((db) =>
      db.insert(workspaceChat).values({ organizationId: key.organizationId }).onConflictDoNothing(),
    ),
});

/** The workspace's sequence row, held for the transaction, which is what serializes its posts from the read of a post's key to its write. */
const lockSequence = SqlSchema.findOneOption({
  Request: OrganizationKeySchema,
  Result: Schema.Struct({ next: Schema.Number }),
  execute: (key) =>
    Database.use((db) =>
      db
        .select({ next: workspaceChat.nextSeq })
        .from(workspaceChat)
        .where(eq(workspaceChat.organizationId, key.organizationId))
        .for("update"),
    ),
});

/** The next place, taken: the row's lock is held to the transaction's end, so posts take their places in turn. */
const takeSeq = SqlSchema.findOne({
  Request: OrganizationKeySchema,
  Result: Schema.Struct({ next: Schema.Number }),
  execute: (key) =>
    Database.use((db) =>
      db
        .update(workspaceChat)
        .set({ nextSeq: sql`${workspaceChat.nextSeq} + 1` })
        .where(eq(workspaceChat.organizationId, key.organizationId))
        .returning({ next: workspaceChat.nextSeq }),
    ),
});

/** The last place the workspace's sequence handed out; zero before its first post. */
const findHead = SqlSchema.findOneOption({
  Request: OrganizationKeySchema,
  Result: Schema.Struct({ next: Schema.Number }),
  execute: (key) =>
    Database.use((db) =>
      db
        .select({ next: workspaceChat.nextSeq })
        .from(workspaceChat)
        .where(eq(workspaceChat.organizationId, key.organizationId)),
    ),
});

const findMemberByHandle = SqlSchema.findOneOption({
  Request: Schema.Struct({ organizationId: Schema.String, handle: Schema.String }),
  Result: ChatMemberRowSchema,
  execute: (key) =>
    Database.use((db) =>
      db
        .select(MEMBER_COLUMNS)
        .from(chatMember)
        .where(
          and(
            eq(chatMember.organizationId, key.organizationId),
            eq(chatMember.handle, key.handle),
            ne(chatMember.kind, MEMBER_KIND.PLANNER),
          ),
        ),
    ),
});

const findChannelInWorkspace = SqlSchema.findOneOption({
  Request: Schema.Struct({ organizationId: Schema.String, channelId: Schema.String }),
  Result: ChatChannelRowSchema,
  execute: (key) =>
    Database.use((db) =>
      db
        .select(CHANNEL_COLUMNS)
        .from(chatChannel)
        .where(
          and(
            eq(chatChannel.organizationId, key.organizationId),
            eq(chatChannel.id, key.channelId),
          ),
        ),
    ),
});

const findAgentPlan = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ planId: Schema.NullOr(Schema.String) }),
  execute: (agentId) =>
    Database.use((db) =>
      db
        .select({ planId: codingAgent.taskId })
        .from(codingAgent)
        .where(eq(codingAgent.id, agentId)),
    ),
});

const findMessageByKey = SqlSchema.findOneOption({
  Request: Schema.Struct({ channelId: Schema.String, clientKey: Schema.String }),
  Result: ChatMessageRowSchema,
  execute: (key) =>
    Database.use((db) =>
      db
        .select(MESSAGE_COLUMNS)
        .from(chatMessage)
        .where(
          and(eq(chatMessage.channelId, key.channelId), eq(chatMessage.clientKey, key.clientKey)),
        ),
    ),
});

const findMessageBySeq = SqlSchema.findOneOption({
  Request: Schema.Struct({ organizationId: Schema.String, seq: Schema.Number }),
  Result: ChatMessageRowSchema,
  execute: (key) =>
    Database.use((db) =>
      db
        .select(MESSAGE_COLUMNS)
        .from(chatMessage)
        .where(
          and(eq(chatMessage.organizationId, key.organizationId), eq(chatMessage.seq, key.seq)),
        ),
    ),
});

const insertMessage = SqlSchema.findOne({
  Request: Schema.Struct({
    organizationId: Schema.String,
    channelId: Schema.String,
    seq: Schema.Number,
    parentId: Schema.NullOr(Schema.String),
    authorMemberId: Schema.String,
    blocks: Schema.Array(chatBlockSchema),
    mentions: Schema.Array(Schema.String),
    clientKey: Schema.String,
    ask: Schema.NullOr(Schema.Struct({ key: Schema.String, ask: chatAskSchema })),
    now: Schema.Date,
  }),
  Result: ChatMessageRowSchema,
  execute: (row) =>
    Database.use((db) =>
      db
        .insert(chatMessage)
        .values({
          organizationId: row.organizationId,
          channelId: row.channelId,
          seq: row.seq,
          touchedSeq: row.seq,
          parentId: row.parentId,
          authorMemberId: row.authorMemberId,
          blocks: row.blocks,
          mentions: [...row.mentions],
          clientKey: row.clientKey,
          createdAt: row.now,
          touchedAt: row.now,
          ...(row.ask === null
            ? undefined
            : {
                ask: row.ask.ask,
                askKey: row.ask.key,
                askRevision: 1,
                askStatus: ASK_STATUS.OPEN,
              }),
        })
        .returning(MESSAGE_COLUMNS),
    ),
});

/** The author's message carrying the ask under the key, under its row's lock. */
const lockAskByKey = SqlSchema.findOneOption({
  Request: Schema.Struct({ authorMemberId: Schema.String, key: Schema.String }),
  Result: ChatMessageRowSchema,
  execute: (key) =>
    Database.use((db) =>
      db
        .select(MESSAGE_COLUMNS)
        .from(chatMessage)
        .where(
          and(eq(chatMessage.authorMemberId, key.authorMemberId), eq(chatMessage.askKey, key.key)),
        )
        .for("update"),
    ),
});

/** The message at the place given carrying an ask, under its row's lock. */
const lockAskBySeq = SqlSchema.findOneOption({
  Request: Schema.Struct({ organizationId: Schema.String, seq: Schema.Number }),
  Result: ChatMessageRowSchema,
  execute: (key) =>
    Database.use((db) =>
      db
        .select(MESSAGE_COLUMNS)
        .from(chatMessage)
        .where(
          and(
            eq(chatMessage.organizationId, key.organizationId),
            eq(chatMessage.seq, key.seq),
            isNotNull(chatMessage.askKey),
          ),
        )
        .for("update"),
    ),
});

/** The ask written again under its key: its body, mentions, and ask replaced, its revision moved on, opened, and moved to the place given. */
const rewriteAsk = SqlSchema.findOne({
  Request: Schema.Struct({
    id: Schema.String,
    blocks: Schema.Array(chatBlockSchema),
    mentions: Schema.Array(Schema.String),
    ask: chatAskSchema,
    seq: Schema.Number,
    now: Schema.Date,
  }),
  Result: ChatMessageRowSchema,
  execute: (row) =>
    Database.use((db) =>
      db
        .update(chatMessage)
        .set({
          blocks: row.blocks,
          mentions: [...row.mentions],
          ask: row.ask,
          askRevision: sql`${chatMessage.askRevision} + 1`,
          askStatus: ASK_STATUS.OPEN,
          answer: null,
          answerKey: null,
          answeredByMemberId: null,
          closedReason: null,
          touchedSeq: row.seq,
          touchedAt: row.now,
        })
        .where(eq(chatMessage.id, row.id))
        .returning(MESSAGE_COLUMNS),
    ),
});

/** The ask moved to where it now stands: answered, opened again, or closed, at the place given. */
const settleAsk = SqlSchema.findOne({
  Request: Schema.Struct({
    id: Schema.String,
    status: Schema.Literals(Object.values(ASK_STATUS)),
    answer: Schema.NullOr(chatReplySchema),
    answerKey: Schema.NullOr(Schema.String),
    answeredByMemberId: Schema.NullOr(Schema.String),
    closedReason: Schema.NullOr(Schema.String),
    bumpRevision: Schema.Boolean,
    seq: Schema.Number,
    now: Schema.Date,
  }),
  Result: ChatMessageRowSchema,
  execute: (row) =>
    Database.use((db) =>
      db
        .update(chatMessage)
        .set({
          askStatus: row.status,
          answer: row.answer,
          answerKey: row.answerKey,
          answeredByMemberId: row.answeredByMemberId,
          closedReason: row.closedReason,
          ...(row.bumpRevision ? { askRevision: sql`${chatMessage.askRevision} + 1` } : undefined),
          touchedSeq: row.seq,
          touchedAt: row.now,
        })
        .where(eq(chatMessage.id, row.id))
        .returning(MESSAGE_COLUMNS),
    ),
});

/** The messages a reader may see that meet the conditions, in the order given, bounded. */
function visibleMessages(
  reader: ChatMemberRow,
  conditions: readonly (SQL | undefined)[],
  order: ReadOrder,
  limit: number,
) {
  return Database.use((db) =>
    db
      .select(MESSAGE_COLUMNS)
      .from(chatMessage)
      .innerJoin(chatChannel, eq(chatChannel.id, chatMessage.channelId))
      .where(
        and(
          eq(chatMessage.organizationId, reader.organizationId),
          visibleTo(reader),
          ...conditions,
        ),
      )
      .orderBy(order === READ_ORDER.TOUCHED ? asc(chatMessage.touchedSeq) : desc(chatMessage.seq))
      .limit(limit),
  );
}

const ChatUnreadCountSchema = Schema.Struct({ channelId: Schema.String, unread: Schema.Number });

/** How many messages wait unread in each channel the reader may see, past its cursor there; a channel with none is left out. */
function countUnread(reader: ChatMemberRow): ChatStoreEffect<readonly ChatUnreadCount[]> {
  return Effect.flatMap(
    Database.use((db) =>
      db
        .select({ channelId: chatMessage.channelId, unread: count() })
        .from(chatMessage)
        .innerJoin(chatChannel, eq(chatChannel.id, chatMessage.channelId))
        .where(
          and(
            eq(chatMessage.organizationId, reader.organizationId),
            visibleTo(reader),
            sql`${chatMessage.touchedSeq} > ${cursorIn(reader.id, reader.readSeq, chatMessage.channelId)}`,
            ne(chatMessage.authorMemberId, reader.id),
          ),
        )
        .groupBy(chatMessage.channelId)
        .orderBy(asc(chatMessage.channelId)),
    ),
    Schema.decodeUnknownEffect(Schema.Array(ChatUnreadCountSchema)),
  );
}

const ReadKeySchema = Schema.Struct({
  readerId: Schema.String,
  organizationId: Schema.String,
});

/** Whether a notice outstanding stands past the place given, which a read to that place leaves standing. */
function noticePast(to: number): SQL {
  return sql`${chatMember.noticeSeq} > ${to}`;
}

/** Moves a member's floor, its cursor in every channel, on to the place given, never back, and lets go of the notice it passed. */
const moveCursor = SqlSchema.void({
  Request: Schema.Struct({ ...ReadKeySchema.fields, to: Schema.Number }),
  execute: (key) =>
    Database.use((db) =>
      db
        .update(chatMember)
        .set({
          readSeq: sql`greatest(${chatMember.readSeq}, ${key.to})`,
          noticeSeq: sql`case when ${noticePast(key.to)} then ${chatMember.noticeSeq} end`,
          noticeChannelId: sql`case when ${noticePast(key.to)} then ${chatMember.noticeChannelId} end`,
        })
        .where(
          and(eq(chatMember.id, key.readerId), eq(chatMember.organizationId, key.organizationId)),
        ),
    ),
});

/** Moves a member's cursor in one channel on to the place given, never back, and lets go of the notice in that channel it passed. */
const moveChannelCursor = SqlSchema.void({
  Request: Schema.Struct({ ...ReadKeySchema.fields, channelId: Schema.String, to: Schema.Number }),
  execute: (key) =>
    Effect.andThen(
      Database.use((db) =>
        db
          .insert(chatRead)
          .values({ memberId: key.readerId, channelId: key.channelId, readSeq: key.to })
          .onConflictDoUpdate({
            target: [chatRead.memberId, chatRead.channelId],
            set: { readSeq: sql`greatest(${chatRead.readSeq}, excluded.read_seq)` },
          }),
      ),
      Database.use((db) =>
        db
          .update(chatMember)
          .set({ noticeSeq: null, noticeChannelId: null })
          .where(
            and(
              eq(chatMember.id, key.readerId),
              eq(chatMember.organizationId, key.organizationId),
              eq(chatMember.noticeChannelId, key.channelId),
              sql`${chatMember.noticeSeq} <= ${key.to}`,
            ),
          ),
      ),
    ),
});

/** The member's cursor in a channel a statement names: the place it read that channel to, or its floor where that is further. */
function cursorIn(readerId: string, floor: Column | number, channelId: Column | string): SQL {
  return sql`greatest(${floor}, coalesce((select ${chatRead.readSeq} from ${chatRead} where ${chatRead.memberId} = ${readerId} and ${chatRead.channelId} = ${channelId}), 0))`;
}

/**
 * Stamps the notice told where none is outstanding: none stands, or the
 * member's cursor in its channel has passed it; and where the member has
 * not read the told channel past it already.
 */
const claimNotice = SqlSchema.findAll({
  Request: Schema.Struct({ ...ReadKeySchema.fields, channelId: Schema.String, seq: Schema.Number }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: (key) =>
    Database.use((db) =>
      db
        .update(chatMember)
        .set({ noticeSeq: key.seq, noticeChannelId: key.channelId })
        .where(
          and(
            eq(chatMember.id, key.readerId),
            eq(chatMember.organizationId, key.organizationId),
            // A notice of something the member has read already is no notice at all.
            sql`${key.seq} > ${cursorIn(key.readerId, chatMember.readSeq, key.channelId)}`,
            or(
              isNull(chatMember.noticeSeq),
              sql`${chatMember.noticeSeq} <= ${cursorIn(key.readerId, chatMember.readSeq, chatMember.noticeChannelId)}`,
            ),
          ),
        )
        .returning({ id: chatMember.id }),
    ),
});

/** A name spelled as a slug: lowercase letters and digits, a hyphen between runs of them, bounded. */
function slugOf(name: string, maximumChars: number): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, maximumChars)
    .replace(/-+$/u, "");
}

/** The first of a stem and its `-2`, `-3`, … the predicate does not refuse. */
function firstFree(stem: string, taken: (candidate: string) => boolean): string {
  if (!taken(stem)) return stem;
  let suffix = 2;
  while (taken(`${stem}-${suffix}`)) suffix += 1;
  return `${stem}-${suffix}`;
}

/** A person's handle stem: a slug of their name opening on a letter. */
function personStem(name: string): string {
  const stem = slugOf(name, MAX_HANDLE_STEM_CHARS).replace(/^[^a-z]+/u, "");
  return stem === "" ? FALLBACK_HANDLE : stem;
}

/** The workspace a subject belongs to, where it is the one named; nothing for one of another workspace or none. */
function subjectInWorkspace(
  organizationId: string,
  subject: ChatMemberSubject,
): ChatStoreEffect<boolean> {
  switch (subject.kind) {
    case MEMBER_KIND.HUMAN:
      return isWorkspaceMember(subject.userId, organizationId);
    case MEMBER_KIND.AGENT:
      return Effect.map(findAgentWorkspace(subject.agentId), (found) =>
        Option.exists(found, (row) => row.organizationId === organizationId),
      );
    case MEMBER_KIND.PLANNER:
      return Effect.map(findPlanWorkspace(subject.planId), (found) =>
        Option.exists(found, (row) => row.organizationId === organizationId),
      );
  }
}

/** The id a subject is named by in its kind's column. */
function subjectId(subject: ChatMemberSubject): string {
  switch (subject.kind) {
    case MEMBER_KIND.HUMAN:
      return subject.userId;
    case MEMBER_KIND.AGENT:
      return subject.agentId;
    case MEMBER_KIND.PLANNER:
      return subject.planId;
  }
}

/** The handle a new member of the kind is minted, its ordinal given; a person's steps past every handle held and spoken for. */
function mintHandle(
  organizationId: string,
  subject: ChatMemberSubject,
  ordinal: number,
): ChatStoreEffect<string> {
  return Effect.gen(function* () {
    if (subject.kind === MEMBER_KIND.AGENT) return `agent-${ordinal}`;
    if (subject.kind === MEMBER_KIND.PLANNER) return PLANNER_HANDLE;
    const account = yield* findAccountName(subject.userId);
    const held = new Set((yield* findHandles({ organizationId })).map((row) => row.handle));
    const stem = personStem(Option.match(account, { onNone: () => "", onSome: (row) => row.name }));
    return firstFree(stem, (candidate) => held.has(candidate) || SPOKEN_FOR.test(candidate));
  });
}

/**
 * Whether the account may act as the member: a person's member is that
 * person's alone, while an agent's or a planner's is acted as by the
 * service on its behalf, which names it from the agent or plan it runs.
 */
function actsAs(userId: string, member: ChatMemberRow): boolean {
  return member.kind !== MEMBER_KIND.HUMAN || member.userId === userId;
}

/** The workspace's general channel, by its name and its kind. */
function generalOf(organizationId: string): ChatStoreEffect<Option.Option<ChatChannelRow>> {
  return Effect.map(
    findChannelByName({ organizationId, name: GENERAL_CHANNEL }),
    Option.filter((row) => row.kind === CHANNEL_KIND.GENERAL),
  );
}

/** The account's gate on a workspace: whether it is in it, with the workspace's lock taken where it is. */
function lockedFor(userId: string, organizationId: string): ChatStoreEffect<boolean> {
  return Effect.gen(function* () {
    if (!(yield* isWorkspaceMember(userId, organizationId))) return false;
    return Option.isSome(yield* lockWorkspace(organizationId));
  });
}

/**
 * The condition that the reader may see the channel a statement reads:
 * every channel for a person; any but a DM, and a DM it is one of, for an
 * agent or a planner.
 */
function visibleTo(reader: ChatMemberRow): SQL {
  if (reader.kind === MEMBER_KIND.HUMAN) return sql`true`;
  return (
    or(
      ne(chatChannel.kind, CHANNEL_KIND.DM),
      eq(chatChannel.dmAMemberId, reader.id),
      eq(chatChannel.dmBMemberId, reader.id),
    ) ?? sql`false`
  );
}

/** Whether the author may post in the channel: any but a DM, and a DM it is one of. */
function postsIn(author: ChatMemberRow, channel: ChatChannelRow): boolean {
  if (channel.kind !== CHANNEL_KIND.DM) return true;
  return channel.dmAMemberId === author.id || channel.dmBMemberId === author.id;
}

/** Whether the reader may see the channel, which must be of its workspace: as `visibleTo` reads it. */
function seesChannel(reader: ChatMemberRow, channelId: string): ChatStoreEffect<boolean> {
  return Effect.map(
    findChannelInWorkspace({ organizationId: reader.organizationId, channelId }),
    Option.match({
      onNone: () => false,
      onSome: (channel) => reader.kind === MEMBER_KIND.HUMAN || postsIn(reader, channel),
    }),
  );
}

/** A page's size as asked, held between one and the bound a read answers with. */
function boundedPage(limit: number): number {
  return Math.min(Math.max(Math.floor(limit), 1), CHAT_BOUNDS.MAX_READ);
}

/** The last place the workspace's sequence handed out; zero before its first post. */
function headOf(organizationId: string): ChatStoreEffect<number> {
  return Effect.map(findHead({ organizationId }), (row) =>
    Option.match(row, { onNone: () => 0, onSome: ({ next }) => next - 1 }),
  );
}

/** The plan a message's `@luke` names: its channel's plan, else its author's; none for an agent that works no plan outside a plan's channel. */
function planOfContext(
  channel: ChatChannelRow,
  author: ChatMemberRow,
): ChatStoreEffect<Option.Option<string>> {
  if (channel.planId !== null) return Effect.succeed(Option.some(channel.planId));
  if (author.planId !== null) return Effect.succeed(Option.some(author.planId));
  if (author.agentId === null) return Effect.succeed(Option.none());
  // An agent that works no plan names no planner, so its `@luke` answers to no one.
  return Effect.map(
    findAgentPlan(author.agentId),
    Option.flatMap((row) => Option.fromNullishOr(row.planId)),
  );
}

/** The member a handle names in the workspace: `luke` the plan's planner, minted where it is not yet, any other a person or agent standing under it. */
function namedMember(
  userId: string,
  organizationId: string,
  handle: string,
  planId: Option.Option<string>,
): ChatStoreEffect<Option.Option<ChatMemberRow>> {
  if (handle !== PLANNER_HANDLE) return findMemberByHandle({ organizationId, handle });
  if (Option.isNone(planId)) return Effect.succeed(Option.none());
  return ensureMember(userId, organizationId, { kind: MEMBER_KIND.PLANNER, planId: planId.value });
}

/** The reader as a member of the workspace; nothing where the account is not in it or no such member is. */
function readerIn(
  userId: string,
  organizationId: string,
  readerId: string,
): ChatStoreEffect<Option.Option<ChatMemberRow>> {
  return Effect.gen(function* () {
    if (!(yield* isWorkspaceMember(userId, organizationId))) return Option.none();
    return yield* findMemberInWorkspace({ organizationId, memberId: readerId });
  });
}

/** Runs the effect in one transaction on the ambient client. */
function transaction<A>(body: ChatStoreEffect<A>): ChatStoreEffect<A> {
  return Effect.flatMap(SqlClient.SqlClient, (client) => client.withTransaction(body));
}

/** A channel the insert just made, or the one a racing insert made first under the same name, pair, or plan. */
function madeOrStanding(
  made: readonly ChatChannelRow[],
  standing: ChatStoreEffect<Option.Option<ChatChannelRow>>,
): ChatStoreEffect<Option.Option<ChatChannelRow>> {
  const [row] = made;
  return row === undefined ? standing : Effect.succeed(Option.some(row));
}

/**
 * The workspace's member for the subject, minted the first time it is asked
 * for under the workspace's lock: its ordinal the next of its kind, and its
 * handle as above. Nothing where the account is not in the workspace or the
 * subject is not of it: a person not in it, or an agent or a plan of
 * another workspace.
 */
export function ensureMember(
  userId: string,
  organizationId: string,
  subject: ChatMemberSubject,
): ChatStoreEffect<Option.Option<ChatMemberRow>> {
  return transaction(
    Effect.gen(function* () {
      if (!(yield* lockedFor(userId, organizationId))) return Option.none();
      const key = { organizationId, kind: subject.kind, subjectId: subjectId(subject) };
      // A person is asked of again each time, because one who left the workspace keeps a row for the messages they wrote.
      const standing = yield* findMemberOfSubject(key);
      if (Option.isSome(standing) && subject.kind !== MEMBER_KIND.HUMAN) return standing;
      if (!(yield* subjectInWorkspace(organizationId, subject))) return Option.none();
      if (Option.isSome(standing)) return standing;
      const { last } = yield* findLastOrdinal({ organizationId, kind: subject.kind }).pipe(
        Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
      );
      const ordinal = (last ?? 0) + 1;
      const handle = yield* mintHandle(organizationId, subject, ordinal);
      const now = yield* DateTime.nowAsDate;
      const row = yield* insertMember({
        organizationId,
        kind: subject.kind,
        userId: subject.kind === MEMBER_KIND.HUMAN ? subject.userId : null,
        agentId: subject.kind === MEMBER_KIND.AGENT ? subject.agentId : null,
        planId: subject.kind === MEMBER_KIND.PLANNER ? subject.planId : null,
        handle,
        ordinal,
        now,
      }).pipe(Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)));
      return Option.some(row);
    }),
  );
}

/** Every member of the workspace, the ones who left among them, in the order they joined; none where the account is not in it. */
export function roster(
  userId: string,
  organizationId: string,
): ChatStoreEffect<readonly ChatMemberRow[]> {
  return Effect.gen(function* () {
    if (!(yield* isWorkspaceMember(userId, organizationId))) return [];
    return yield* findMembers({ organizationId });
  });
}

/** Every channel of the workspace, the archived ones among them, in the order they were made; none where the account is not in it. */
export function channelsOf(
  userId: string,
  organizationId: string,
): ChatStoreEffect<readonly ChatChannelRow[]> {
  return Effect.gen(function* () {
    if (!(yield* isWorkspaceMember(userId, organizationId))) return [];
    return yield* findChannels({ organizationId });
  });
}

/** The workspace's general channel, made the first time it is asked for; nothing where the account is not in it. */
export function ensureGeneral(
  userId: string,
  organizationId: string,
): ChatStoreEffect<Option.Option<ChatChannelRow>> {
  return Effect.gen(function* () {
    if (!(yield* isWorkspaceMember(userId, organizationId))) return Option.none();
    const standing = yield* generalOf(organizationId);
    if (Option.isSome(standing)) return standing;
    const now = yield* DateTime.nowAsDate;
    const made = yield* insertChannel({
      organizationId,
      kind: CHANNEL_KIND.GENERAL,
      name: GENERAL_CHANNEL,
      planId: null,
      dmAMemberId: null,
      dmBMemberId: null,
      createdByMemberId: null,
      now,
    });
    return yield* madeOrStanding(made, generalOf(organizationId));
  });
}

/**
 * The plan's own channel, made the first time it is asked for under the
 * workspace's lock and named from the plan, `-2` and on where a channel
 * holds the name already, and `plan` where the name spells nothing; nothing
 * where the account does not reach the plan.
 */
export function ensurePlanChannel(
  userId: string,
  planId: string,
): ChatStoreEffect<Option.Option<ChatChannelRow>> {
  return transaction(
    Effect.gen(function* () {
      const reached = yield* findReachablePlan({ userId, planId });
      if (Option.isNone(reached)) return Option.none();
      const standing = yield* findPlanChannel(planId);
      if (Option.isSome(standing)) return standing;
      const { organizationId } = reached.value;
      yield* lockWorkspace(organizationId);
      const again = yield* findPlanChannel(planId);
      if (Option.isSome(again)) return again;
      const held = new Set(
        (yield* findChannels({ organizationId })).flatMap((row) =>
          row.name === null ? [] : [row.name],
        ),
      );
      const stem = slugOf(reached.value.name, CHAT_BOUNDS.MAX_KEY_CHARS - 4) || "plan";
      const name = firstFree(
        stem,
        (candidate) => held.has(candidate) || candidate === GENERAL_CHANNEL,
      );
      const now = yield* DateTime.nowAsDate;
      const made = yield* insertChannel({
        organizationId,
        kind: CHANNEL_KIND.PLAN,
        name,
        planId,
        dmAMemberId: null,
        dmBMemberId: null,
        createdByMemberId: null,
        // An archived plan's channel is made archived with it, as its archive would have left it.
        archivedAt: reached.value.archivedAt,
        now,
      });
      return yield* madeOrStanding(made, findPlanChannel(planId));
    }),
  );
}

/**
 * A topic channel under the name, opened by the member given: the one
 * standing where an open topic channel holds the name, else made, unless
 * the workspace keeps as many open as it may. A name a channel of another
 * kind or an archived one holds is refused, as is a workspace the account
 * is not in or a member not of it. The name is held to the channel-name
 * grammar by the caller's wire.
 */
export function openTopicChannel(
  userId: string,
  organizationId: string,
  name: string,
  openedBy: string,
): ChatStoreEffect<Result.Result<ChatChannelRow, ChatRefusal>> {
  return transaction(
    Effect.gen(function* () {
      if (!(yield* lockedFor(userId, organizationId))) return Result.fail(CHAT_REFUSAL.NOT_FOUND);
      const opener = yield* findMemberInWorkspace({ organizationId, memberId: openedBy });
      if (Option.isNone(opener) || !actsAs(userId, opener.value)) {
        return Result.fail(CHAT_REFUSAL.NOT_FOUND);
      }
      // Note that the general channel's name is never a topic's, made yet or not, because ensureGeneral finds it by name.
      if (name === GENERAL_CHANNEL) return Result.fail(CHAT_REFUSAL.NAME_TAKEN);
      const standing = yield* findChannelByName({ organizationId, name });
      if (Option.isSome(standing)) {
        const open =
          standing.value.kind === CHANNEL_KIND.TOPIC && standing.value.archivedAt === null;
        return open ? Result.succeed(standing.value) : Result.fail(CHAT_REFUSAL.NAME_TAKEN);
      }
      const { open } = yield* countOpenTopics({ organizationId }).pipe(
        // An aggregate that returned no row is the database breaking its own contract, not an outcome.
        Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
      );
      if (open >= CHAT_BOUNDS.MAX_TOPIC_CHANNELS) return Result.fail(CHAT_REFUSAL.TOO_MANY_TOPICS);
      const now = yield* DateTime.nowAsDate;
      const [made] = yield* insertChannel({
        organizationId,
        kind: CHANNEL_KIND.TOPIC,
        name,
        planId: null,
        dmAMemberId: null,
        dmBMemberId: null,
        createdByMemberId: openedBy,
        now,
      });
      return made === undefined ? Result.fail(CHAT_REFUSAL.NAME_TAKEN) : Result.succeed(made);
    }),
  );
}

/**
 * The DM between two members of the workspace, made the first time it is
 * asked for, by the first member; one pair is one channel whichever of the
 * two asks. Nothing where the account is not in the workspace, either
 * member is not of it, or the two are one.
 */
export function findOrMakeDm(
  userId: string,
  organizationId: string,
  fromMemberId: string,
  toMemberId: string,
): ChatStoreEffect<Option.Option<ChatChannelRow>> {
  return Effect.gen(function* () {
    if (fromMemberId === toMemberId) return Option.none();
    if (!(yield* isWorkspaceMember(userId, organizationId))) return Option.none();
    const from = yield* findMemberInWorkspace({ organizationId, memberId: fromMemberId });
    if (Option.isNone(from) || !actsAs(userId, from.value)) return Option.none();
    const to = yield* findMemberInWorkspace({ organizationId, memberId: toMemberId });
    // A member that left hears nothing more, so no DM is opened with it on either side.
    if (Option.isNone(to) || from.value.leftAt !== null || to.value.leftAt !== null) {
      return Option.none();
    }
    // Note that the pair is stored in uuid order, because that is what makes one pair one row.
    const [dmAMemberId, dmBMemberId] = [fromMemberId, toMemberId].toSorted();
    if (dmAMemberId === undefined || dmBMemberId === undefined) return Option.none();
    const pair = { organizationId, dmAMemberId, dmBMemberId };
    const standing = yield* findDm(pair);
    if (Option.isSome(standing)) return standing;
    const now = yield* DateTime.nowAsDate;
    const made = yield* insertChannel({
      ...pair,
      kind: CHANNEL_KIND.DM,
      name: null,
      planId: null,
      createdByMemberId: fromMemberId,
      now,
    });
    return yield* madeOrStanding(made, findDm(pair));
  });
}

const stampPlanChannelArchive = SqlSchema.void({
  Request: Schema.Struct({ planId: Schema.String, archivedAt: Schema.NullOr(Schema.Date) }),
  execute: ({ planId, archivedAt }) =>
    Database.use((db) =>
      db
        .update(chatChannel)
        .set({ archivedAt })
        .where(and(eq(chatChannel.planId, planId), eq(chatChannel.kind, CHANNEL_KIND.PLAN))),
    ),
});

/**
 * Archives a plan's channel as its plan is archived, or opens it again as
 * its plan is brought back: what the plan's own archive calls, under the
 * plan's lock, so an archived plan's channel takes no post until the plan
 * returns. Nothing where the plan has no channel.
 */
export function followPlanArchive(planId: string, archivedAt: Date | null): ChatStoreEffect<void> {
  return stampPlanChannelArchive({ planId, archivedAt });
}

/**
 * Stamps the member as having left, an archived agent or plan, once: it
 * stays on the roster and in every message it wrote, and hears nothing
 * more. A person is never stamped: their membership is the workspace's
 * own. Answers whether this call stamped it, which a second does not.
 */
export function leave(
  userId: string,
  organizationId: string,
  memberId: string,
): ChatStoreEffect<boolean> {
  return Effect.gen(function* () {
    if (!(yield* isWorkspaceMember(userId, organizationId))) return false;
    const now = yield* DateTime.nowAsDate;
    const stamped = yield* stampLeft({ organizationId, memberId, now });
    return stamped.length > 0;
  });
}

/** The member a handle names in the workspace, `luke` the planner of the plan given; nothing where the account is not in it or no member answers to it. */
export function memberNamed(
  userId: string,
  organizationId: string,
  handle: string,
  planId?: string,
): ChatStoreEffect<Option.Option<ChatMemberRow>> {
  return Effect.gen(function* () {
    if (!(yield* isWorkspaceMember(userId, organizationId))) return Option.none();
    return yield* namedMember(userId, organizationId, handle, Option.fromNullishOr(planId));
  });
}

/** The channel under a name in the workspace; nothing where the account is not in it or no channel holds the name. */
export function channelNamed(
  userId: string,
  organizationId: string,
  name: string,
): ChatStoreEffect<Option.Option<ChatChannelRow>> {
  return Effect.gen(function* () {
    if (!(yield* isWorkspaceMember(userId, organizationId))) return Option.none();
    return yield* findChannelByName({ organizationId, name });
  });
}

/** Where a post lands once its author, channel, thread, and mentions are read: what a post and an ask write. */
interface PlacedPost {
  readonly author: ChatMemberRow;
  readonly channelId: string;
  readonly parentId: string | null;
  readonly mentions: readonly string[];
  readonly unresolved: readonly string[];
}

/**
 * A post read against the workspace: its author the account may act as and
 * who has not left, its channel, the thread root where it replies, which
 * names the channel, and its mentions resolved. Refused as `postMessage`
 * says.
 */
function placePost(
  userId: string,
  organizationId: string,
  post: ChatPost,
): ChatStoreEffect<Result.Result<PlacedPost, ChatRefusal>> {
  return Effect.gen(function* () {
    const author = yield* readerIn(userId, organizationId, post.authorMemberId);
    if (Option.isNone(author) || !actsAs(userId, author.value)) {
      return Result.fail(CHAT_REFUSAL.NOT_FOUND);
    }
    if (author.value.leftAt !== null) return Result.fail(CHAT_REFUSAL.AUTHOR_LEFT);
    const parent =
      "replyTo" in post.to
        ? yield* findMessageBySeq({ organizationId, seq: post.to.replyTo })
        : Option.none();
    if ("replyTo" in post.to && Option.isNone(parent)) return Result.fail(CHAT_REFUSAL.NOT_FOUND);
    const channelId = Option.match(parent, {
      onNone: () => ("channelId" in post.to ? post.to.channelId : ""),
      onSome: (row) => row.channelId,
    });
    const channel = yield* findChannelInWorkspace({ organizationId, channelId });
    if (Option.isNone(channel)) return Result.fail(CHAT_REFUSAL.NOT_FOUND);
    if (!postsIn(author.value, channel.value)) return Result.fail(CHAT_REFUSAL.NOT_FOUND);
    if (channel.value.archivedAt !== null) return Result.fail(CHAT_REFUSAL.CHANNEL_ARCHIVED);
    // Mentions are resolved before the sequence is locked, because minting a planner takes the workspace's lock.
    const planId = yield* planOfContext(channel.value, author.value);
    const named = yield* Effect.forEach(post.mentions, (handle) =>
      Effect.map(namedMember(userId, organizationId, handle, planId), (found) => ({
        handle,
        found,
      })),
    );
    return Result.succeed({
      author: author.value,
      channelId,
      parentId: Option.match(parent, {
        onNone: () => null,
        onSome: (row) => row.parentId ?? row.id,
      }),
      mentions: [
        ...new Set(named.flatMap(({ found }) => Option.toArray(found).map((row) => row.id))),
      ],
      unresolved: named.filter(({ found }) => Option.isNone(found)).map(({ handle }) => handle),
    });
  });
}

/**
 * The workspace's sequence row, made where it is not yet and held for the
 * transaction. Note that every write that also locks a message takes this
 * first, because two writers taking the two locks in turn the other way
 * round would each wait on the other.
 */
function holdSequence(organizationId: string): ChatStoreEffect<void> {
  return Effect.gen(function* () {
    yield* ensureSequence({ organizationId });
    yield* lockSequence({ organizationId });
  });
}

/**
 * The message already standing under the post's key in its channel, read
 * under the sequence's lock, so two sends of one post racing land once:
 * the author's own is the post repeated, another member's refuses the key.
 * A channel no longer of the workspace by then, moved with its plan, takes
 * no post.
 */
function standingUnder(
  organizationId: string,
  placed: PlacedPost,
  clientKey: string,
): ChatStoreEffect<Result.Result<Option.Option<ChatMessageRow>, ChatRefusal>> {
  return Effect.gen(function* () {
    yield* holdSequence(organizationId);
    // Note that the channel is read again under the lock, because a plan's move may have taken it to another workspace meanwhile.
    if (
      Option.isNone(yield* findChannelInWorkspace({ organizationId, channelId: placed.channelId }))
    ) {
      return Result.fail(CHAT_REFUSAL.NOT_FOUND);
    }
    const standing = yield* findMessageByKey({ channelId: placed.channelId, clientKey });
    if (Option.isSome(standing) && standing.value.authorMemberId !== placed.author.id) {
      return Result.fail(CHAT_REFUSAL.KEY_TAKEN);
    }
    return Result.succeed(standing);
  });
}

/** The next place in the workspace's chat sequence, taken under its row's lock. */
function nextSeq(organizationId: string): ChatStoreEffect<number> {
  return Effect.gen(function* () {
    yield* ensureSequence({ organizationId });
    const { next } = yield* takeSeq({ organizationId }).pipe(
      Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
    );
    return next - 1;
  });
}

/** A placed post written at the next place, carrying the ask given. */
function writePlaced(
  organizationId: string,
  placed: PlacedPost,
  post: ChatPost,
  ask: { readonly key: string; readonly ask: ChatAsk } | null,
): ChatStoreEffect<ChatMessageRow> {
  return Effect.gen(function* () {
    const seq = yield* nextSeq(organizationId);
    const now = yield* DateTime.nowAsDate;
    return yield* insertMessage({
      organizationId,
      channelId: placed.channelId,
      seq,
      parentId: placed.parentId,
      authorMemberId: placed.author.id,
      blocks: post.blocks,
      mentions: placed.mentions,
      clientKey: post.clientKey,
      ask,
      now,
    }).pipe(Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)));
  });
}

/**
 * An answer as its thread reads it: what was answered, the form's values,
 * and the note, as Markdown, cut into as many blocks as its length takes,
 * since a form filled to its bounds runs past one block's, each cut between
 * two characters.
 */
function answerBlocks(reply: ChatReply): readonly ChatBlock[] {
  const values = reply.values === undefined ? "" : formValueLines(reply.values);
  const note = reply.note?.trim() ?? "";
  const text = [replyWords(reply), values, note].filter((part) => part !== "").join("\n\n");
  const blocks: ChatBlock[] = [];
  let at = 0;
  while (at < text.length && blocks.length < CHAT_BOUNDS.MAX_BLOCKS) {
    let end = Math.min(at + CHAT_BOUNDS.MAX_MARKDOWN_CHARS, text.length);
    // Note that a cut never falls inside a surrogate pair, because half of one is no character Postgres keeps.
    const before = text.charCodeAt(end - 1);
    if (end < text.length && before >= HIGH_SURROGATE.FIRST && before <= HIGH_SURROGATE.LAST) {
      end -= 1;
    }
    blocks.push({ type: CHAT_BLOCK.MARKDOWN, text: text.slice(at, end) });
    at = end;
  }
  return blocks;
}

/**
 * Posts a message as a member of the workspace: in the channel named, or
 * as a reply in the thread of the message named by its place, under that
 * thread's root and in its channel. The mentions are resolved to members as
 * it lands, `luke` to the planner of the channel's plan or the author's,
 * and the handles that name no one are answered. A post repeated under its
 * key in its channel answers the message it made. Refused where the author
 * or the channel is not of the workspace, the author is another person
 * than the account, the channel is a DM the author is not one of, where
 * the author has left, or where the channel is archived; nothing written.
 */
export function postMessage(
  userId: string,
  organizationId: string,
  post: ChatPost,
): ChatStoreEffect<Result.Result<ChatPosted, ChatRefusal>> {
  return transaction(
    Effect.gen(function* () {
      const placed = yield* placePost(userId, organizationId, post);
      if (Result.isFailure(placed)) return Result.fail(placed.failure);
      const standing = yield* standingUnder(organizationId, placed.success, post.clientKey);
      if (Result.isFailure(standing)) return Result.fail(standing.failure);
      if (Option.isSome(standing.success)) {
        return Result.succeed({ message: standing.success.value, repeated: true, unresolved: [] });
      }
      const { unresolved } = placed.success;
      const message = yield* writePlaced(organizationId, placed.success, post, null);
      return Result.succeed({ message, repeated: false, unresolved });
    }),
  );
}

/**
 * Posts an ask under the author's key, as `postMessage` posts a message: a
 * new message at revision one where the author has no ask under the key,
 * else the one standing written again in place, its revision moved on,
 * opened again whether it was answered or resolved, and moved to the next
 * place so a reader past it reads it again. An ask stays where it was
 * first posted, so one posted again to another channel or thread is
 * refused, as is a client key another message holds. Answers the message
 * and whether it was made now.
 */
export function postAsk(
  userId: string,
  organizationId: string,
  post: ChatPost & { readonly key: string; readonly ask: ChatAsk },
): ChatStoreEffect<Result.Result<ChatPosted & { readonly created: boolean }, ChatRefusal>> {
  return transaction(
    Effect.gen(function* () {
      const placed = yield* placePost(userId, organizationId, post);
      if (Result.isFailure(placed)) return Result.fail(placed.failure);
      const { author, unresolved } = placed.success;
      const standing = yield* standingUnder(organizationId, placed.success, post.clientKey);
      if (Result.isFailure(standing)) return Result.fail(standing.failure);
      if (Option.isSome(standing.success)) {
        // A key a plain message or another ask holds is no repeat of this ask.
        if (standing.success.value.askKey !== post.key) return Result.fail(CHAT_REFUSAL.KEY_TAKEN);
        return Result.succeed({
          message: standing.success.value,
          repeated: true,
          unresolved: [],
          created: false,
        });
      }
      const asked = yield* lockAskByKey({ authorMemberId: author.id, key: post.key });
      const elsewhere = Option.exists(
        asked,
        (row) =>
          row.channelId !== placed.success.channelId || row.parentId !== placed.success.parentId,
      );
      if (elsewhere) return Result.fail(CHAT_REFUSAL.ASK_ELSEWHERE);
      if (Option.isNone(asked)) {
        const message = yield* writePlaced(organizationId, placed.success, post, {
          key: post.key,
          ask: post.ask,
        });
        return Result.succeed({ message, repeated: false, unresolved, created: true });
      }
      const seq = yield* nextSeq(organizationId);
      const now = yield* DateTime.nowAsDate;
      const message = yield* rewriteAsk({
        id: asked.value.id,
        blocks: post.blocks,
        mentions: placed.success.mentions,
        ask: post.ask,
        seq,
        now,
      }).pipe(Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)));
      return Result.succeed({ message, repeated: false, unresolved, created: false });
    }),
  );
}

/** What an answer came to: the ask as it then stands, the reply that carries the answer in its thread, and whether the answer was taken. */
export interface ChatAnswered {
  readonly ask: ChatMessageRow;
  readonly reply: Option.Option<ChatMessageRow>;
  readonly taken: boolean;
}

/** An answer as a member gives it: the ask by its place, the revision it answers, the answer, and the key the answer is sent under. */
export interface ChatAnswer {
  readonly answererMemberId: string;
  readonly seq: number;
  readonly revision: number;
  readonly reply: ChatReply;
  readonly clientKey: string;
}

/**
 * Takes a member's answer on the ask at the place named, where it is open
 * at the revision named: the answer is written on the ask with its key and
 * its answerer, and posted as the answerer's reply in the ask's thread, at
 * the place the ask moves to. An answer sent again under the key it was
 * taken by finds it taken, and one withdrawn and sent again takes its
 * reply again; one at a revision the author has moved past, or
 * on an ask no longer open, is not taken, and the ask is answered as it
 * stands. Refused where the ask or the answerer is not of the workspace,
 * the answerer is another person, has left, or may not post in the ask's
 * channel. The answer is held to what the ask asks by the caller's wire.
 */
export function answerAsk(
  userId: string,
  organizationId: string,
  answer: ChatAnswer,
): ChatStoreEffect<Result.Result<ChatAnswered, ChatRefusal>> {
  return transaction(
    Effect.gen(function* () {
      yield* holdSequence(organizationId);
      const asked = yield* lockAskBySeq({ organizationId, seq: answer.seq });
      if (Option.isNone(asked)) return Result.fail(CHAT_REFUSAL.NOT_FOUND);
      const ask = asked.value;
      const post = {
        authorMemberId: answer.answererMemberId,
        to: { replyTo: ask.seq },
        blocks: answerBlocks(answer.reply),
        mentions: [],
        clientKey: answer.clientKey,
      };
      const placed = yield* placePost(userId, organizationId, post);
      if (Result.isFailure(placed)) return Result.fail(placed.failure);
      const standing = yield* standingUnder(organizationId, placed.success, answer.clientKey);
      if (Result.isFailure(standing)) return Result.fail(standing.failure);
      if (ask.answerKey === answer.clientKey) {
        // A key another member answered under is theirs, however it is sent again.
        if (ask.answeredByMemberId !== answer.answererMemberId) {
          return Result.fail(CHAT_REFUSAL.KEY_TAKEN);
        }
        return Result.succeed({ ask, reply: standing.success, taken: true });
      }
      if (ask.askRevision !== answer.revision || ask.askStatus !== ASK_STATUS.OPEN) {
        return Result.succeed({ ask, reply: Option.none(), taken: false });
      }
      // A key a message outside this ask's thread holds is no answer of this ask's.
      if (Option.exists(standing.success, (row) => row.parentId !== placed.success.parentId)) {
        return Result.fail(CHAT_REFUSAL.KEY_TAKEN);
      }
      // A key's reply says one answer, so another answer sent under it is refused rather than shown as the old.
      if (
        Option.exists(
          standing.success,
          (row) => JSON.stringify(row.blocks) !== JSON.stringify(post.blocks),
        )
      ) {
        return Result.fail(CHAT_REFUSAL.KEY_TAKEN);
      }
      // An answer withdrawn and sent again under its key takes again the reply it left in the thread.
      const reply = Option.isSome(standing.success)
        ? standing.success.value
        : yield* writePlaced(organizationId, placed.success, post, null);
      const touched = Option.isSome(standing.success) ? yield* nextSeq(organizationId) : reply.seq;
      const now = yield* DateTime.nowAsDate;
      const settled = yield* settleAsk({
        id: ask.id,
        status: ASK_STATUS.ANSWERED,
        answer: answer.reply,
        answerKey: answer.clientKey,
        answeredByMemberId: answer.answererMemberId,
        closedReason: null,
        bumpRevision: false,
        seq: touched,
        now,
      }).pipe(Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)));
      return Result.succeed({ ask: settled, reply: Option.some(reply), taken: true });
    }),
  );
}

/**
 * Takes back the answer the member gave under the key on the ask at the
 * place named, opening it again at the next place; its reply stays in the
 * thread as what was said. Nothing where that answer no longer stands, is
 * another member's, or the account may not act as the member.
 */
export function withdrawAnswer(
  userId: string,
  organizationId: string,
  answererMemberId: string,
  seq: number,
  answerKey: string,
): ChatStoreEffect<Option.Option<ChatMessageRow>> {
  return transaction(
    Effect.gen(function* () {
      const answerer = yield* readerIn(userId, organizationId, answererMemberId);
      if (Option.isNone(answerer) || !actsAs(userId, answerer.value)) return Option.none();
      yield* holdSequence(organizationId);
      const asked = yield* lockAskBySeq({ organizationId, seq });
      const answered = Option.filter(
        asked,
        (row) =>
          row.answerKey === answerKey &&
          row.answeredByMemberId === answererMemberId &&
          row.askStatus === ASK_STATUS.ANSWERED,
      );
      if (Option.isNone(answered)) return Option.none();
      const touched = yield* nextSeq(organizationId);
      const now = yield* DateTime.nowAsDate;
      const reopened = yield* settleAsk({
        id: answered.value.id,
        status: ASK_STATUS.OPEN,
        answer: null,
        answerKey: null,
        answeredByMemberId: null,
        closedReason: null,
        bumpRevision: false,
        seq: touched,
        now,
      }).pipe(Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)));
      return Option.some(reopened);
    }),
  );
}

/**
 * Resolves the author's ask under the key with why, its revision moved on
 * and moved to the next place; nothing where the author has no ask under
 * the key, or is not a member the account may act as.
 */
export function resolveAsk(
  userId: string,
  organizationId: string,
  authorMemberId: string,
  key: string,
  reason: string,
): ChatStoreEffect<Option.Option<ChatMessageRow>> {
  return transaction(
    Effect.gen(function* () {
      const author = yield* readerIn(userId, organizationId, authorMemberId);
      if (Option.isNone(author) || !actsAs(userId, author.value)) return Option.none();
      // A member that left takes nothing back, as it posts nothing.
      if (author.value.leftAt !== null) return Option.none();
      yield* holdSequence(organizationId);
      const asked = yield* lockAskByKey({ authorMemberId, key });
      if (Option.isNone(asked)) return Option.none();
      const touched = yield* nextSeq(organizationId);
      const now = yield* DateTime.nowAsDate;
      const closed = yield* settleAsk({
        id: asked.value.id,
        status: ASK_STATUS.CLOSED,
        answer: asked.value.answer,
        answerKey: asked.value.answerKey,
        answeredByMemberId: asked.value.answeredByMemberId,
        closedReason: reason,
        bumpRevision: true,
        seq: touched,
        now,
      }).pipe(Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)));
      return Option.some(closed);
    }),
  );
}

/**
 * The reader's unread page: what it may see that someone else posted or
 * changed past its cursor in each channel, in one channel where the query
 * names one, oldest change first, a page of between one and the bound, and
 * the place reading it moves the cursor to, past the page, or the
 * workspace's head where nothing more waits.
 */
function unreadPage(
  reader: ChatMemberRow,
  query: ChatUnreadQuery,
): ChatStoreEffect<ChatUnreadPage> {
  return Effect.gen(function* () {
    const { channelId } = query;
    const head = yield* headOf(reader.organizationId);
    const page = boundedPage(query.limit ?? CHAT_BOUNDS.MAX_READ);
    // One past the page is read, so a page that is the last says so.
    const rows = yield* visibleMessages(
      reader,
      [
        channelId === undefined ? undefined : eq(chatMessage.channelId, channelId),
        sql`${chatMessage.touchedSeq} > ${cursorIn(reader.id, reader.readSeq, chatMessage.channelId)}`,
        ne(chatMessage.authorMemberId, reader.id),
      ],
      READ_ORDER.TOUCHED,
      page + 1,
    );
    const read = yield* Schema.decodeUnknownEffect(Schema.Array(ChatMessageRowSchema))(rows);
    const more = read.length > page;
    const messages = read.slice(0, page);
    const through = more ? (messages.at(-1)?.touchedSeq ?? reader.readSeq) : head;
    return { messages, more, through };
  });
}

/**
 * What a member has not read: what it may see that someone else posted or
 * changed past its cursor in each channel, in one channel where the query
 * names one, oldest change first, a page of between one and the bound. The
 * cursor moves past what is answered, to the workspace's head where nothing
 * more waits, and lets go of a notice it passes: the channel's cursor for a
 * read of one channel, the floor for a read of every channel, which has
 * read every channel to there. Nothing where the account is not in the
 * workspace, the member is not of it, or the channel is not one it may see.
 */
export function unreadFor(
  userId: string,
  organizationId: string,
  readerId: string,
  query: ChatUnreadQuery = {},
): ChatStoreEffect<Option.Option<ChatUnread>> {
  return transaction(
    Effect.gen(function* () {
      if (!(yield* isWorkspaceMember(userId, organizationId))) return Option.none();
      // Note that the reader's row is held while it reads, because two reads at once must not both take the same page.
      const reader = yield* lockMemberInWorkspace({ organizationId, memberId: readerId });
      if (Option.isNone(reader)) return Option.none();
      const { channelId } = query;
      if (channelId !== undefined && !(yield* seesChannel(reader.value, channelId))) {
        return Option.none();
      }
      const { messages, more, through: to } = yield* unreadPage(reader.value, query);
      yield* channelId === undefined
        ? moveCursor({ readerId, organizationId, to })
        : moveChannelCursor({ readerId, organizationId, channelId, to });
      return Option.some({ messages, more });
    }),
  );
}

/**
 * What a member has not read in every channel it may see, as `unreadFor`
 * reads it, moving nothing: the page and the place its read would move the
 * floor cursor to, which `readThrough` moves it to once the reader has
 * taken the page in. Nothing where the account is not in the workspace or
 * the member is not of it.
 */
export function peekUnread(
  userId: string,
  organizationId: string,
  readerId: string,
  limit: number = CHAT_BOUNDS.MAX_READ,
): ChatStoreEffect<Option.Option<ChatUnreadPage>> {
  return Effect.gen(function* () {
    const reader = yield* readerIn(userId, organizationId, readerId);
    if (Option.isNone(reader)) return Option.none();
    return Option.some(yield* unreadPage(reader.value, { limit }));
  });
}

/**
 * Moves a member's floor cursor on to the place given, never back, letting
 * go of a notice it passes: a page `peekUnread` answered, taken in, as a
 * read of every channel would have moved it. Answers whether the account
 * and the member were found.
 */
export function readThrough(
  userId: string,
  organizationId: string,
  readerId: string,
  through: number,
): ChatStoreEffect<boolean> {
  return Effect.gen(function* () {
    const reader = yield* readerIn(userId, organizationId, readerId);
    if (Option.isNone(reader)) return false;
    yield* moveCursor({ readerId, organizationId, to: through });
    return true;
  });
}

/**
 * Marks the channel read to the place given, never past the workspace's
 * head and never back, letting go of a notice in it the place passes: what
 * a window does when the developer has read a channel on screen. Answers
 * whether the reader may see the channel; false where the account is not
 * in the workspace, the member is not of it, or the channel is not one it
 * may see.
 */
export function readTo(
  userId: string,
  organizationId: string,
  readerId: string,
  channelId: string,
  seq: number,
): ChatStoreEffect<boolean> {
  return transaction(
    Effect.gen(function* () {
      const reader = yield* readerIn(userId, organizationId, readerId);
      if (Option.isNone(reader) || !(yield* seesChannel(reader.value, channelId))) return false;
      const to = Math.min(Math.floor(seq), yield* headOf(organizationId));
      yield* moveChannelCursor({ readerId, organizationId, channelId, to });
      return true;
    }),
  );
}

/**
 * How many messages wait unread in each channel the member may see, past
 * its cursor there, others' posts and changes alone; a channel with none
 * is left out. Moves no cursor. Nothing where the account is not in the
 * workspace or the member is not of it.
 */
export function unreadCounts(
  userId: string,
  organizationId: string,
  readerId: string,
): ChatStoreEffect<Option.Option<readonly ChatUnreadCount[]>> {
  return Effect.gen(function* () {
    const reader = yield* readerIn(userId, organizationId, readerId);
    if (Option.isNone(reader)) return Option.none();
    return Option.some(yield* countUnread(reader.value));
  });
}

/**
 * What a member may see of the workspace's history, newest last: a channel
 * or a thread, its root and its replies, before a place, a page of between
 * one and the bound.
 * Moves no cursor. Nothing where the account is not in the workspace or the
 * member is not of it.
 */
export function history(
  userId: string,
  organizationId: string,
  readerId: string,
  query: ChatHistoryQuery,
): ChatStoreEffect<Option.Option<readonly ChatMessageRow[]>> {
  return Effect.gen(function* () {
    const reader = yield* readerIn(userId, organizationId, readerId);
    if (Option.isNone(reader)) return Option.none();
    const root =
      query.thread === undefined
        ? Option.none()
        : yield* findMessageBySeq({ organizationId, seq: query.thread });
    if (query.thread !== undefined && Option.isNone(root)) return Option.some([]);
    const rows = yield* visibleMessages(
      reader.value,
      [
        query.channelId === undefined ? undefined : eq(chatMessage.channelId, query.channelId),
        Option.match(root, {
          onNone: () => undefined,
          onSome: (row) => or(eq(chatMessage.id, row.id), eq(chatMessage.parentId, row.id)),
        }),
        query.before === undefined ? undefined : lt(chatMessage.seq, query.before),
      ],
      READ_ORDER.NEWEST,
      boundedPage(query.limit ?? CHAT_BOUNDS.MAX_READ),
    );
    const messages = yield* Schema.decodeUnknownEffect(Schema.Array(ChatMessageRowSchema))(rows);
    return Option.some(messages.toReversed());
  });
}

/**
 * Stamps a notice told to a member of a message in the channel at the
 * place given, where none is outstanding: no notice stands, or its cursor
 * in that notice's channel has passed it. Answers whether this call stamped it, which a second before the
 * member reads does not.
 */
export function markNoticed(
  userId: string,
  organizationId: string,
  memberId: string,
  channelId: string,
  seq: number,
): ChatStoreEffect<boolean> {
  return Effect.gen(function* () {
    if (!(yield* isWorkspaceMember(userId, organizationId))) return false;
    const claimed = yield* claimNotice({ readerId: memberId, organizationId, channelId, seq });
    return claimed.length > 0;
  });
}

/**
 * What a window reads past its cursor: every message the reader may see
 * that was posted or changed past it, oldest change first, at most a page,
 * and the cursor to read on from, the workspace's head where nothing more
 * waits. Moves no member's cursor. Nothing where the account is not in the
 * workspace or the reader is not of it.
 */
export function chatPast(
  userId: string,
  organizationId: string,
  readerId: string,
  after: number,
): ChatStoreEffect<Option.Option<ChatPast>> {
  return Effect.gen(function* () {
    const reader = yield* readerIn(userId, organizationId, readerId);
    if (Option.isNone(reader)) return Option.none();
    const head = yield* headOf(organizationId);
    const rows = yield* visibleMessages(
      reader.value,
      [gt(chatMessage.touchedSeq, after)],
      READ_ORDER.TOUCHED,
      MAX_PAST,
    );
    const messages = yield* Schema.decodeUnknownEffect(Schema.Array(ChatMessageRowSchema))(rows);
    const cursor =
      messages.length === MAX_PAST ? (messages.at(-1)?.touchedSeq ?? head) : Math.max(head, after);
    return Option.some({ messages, cursor });
  });
}

/** Whose asks a read lists: one author's, or one channel's. */
export type ChatAskScope = { readonly authorMemberId: string } | { readonly channelId: string };

/** One ask that waits on a person, with the plan of the channel it was asked in, where it was asked in a plan's channel. */
export interface WaitingAsk {
  readonly message: ChatMessageRow;
  readonly planId: string | null;
}

/** Where an ask that waits stands, without what it says: what a held read compares between looks. */
export interface WaitingStamp {
  readonly id: string;
  readonly revision: number;
  readonly status: AskStatus;
  readonly touchedSeq: number;
}

/**
 * The order what waits is read in: the latest changed first, by the instant
 * across workspaces and by the sequence within one where two changes share
 * an instant.
 */
const WAITING_ORDER = [
  desc(chatMessage.touchedAt),
  desc(chatMessage.touchedSeq),
  desc(chatMessage.id),
] as const;

/** A column a subquery compares a member's id with. */
type MemberColumn = typeof chatMessage.authorMemberId | typeof chatChannel.dmAMemberId;

/** The order every ask read keeps: the latest changed first, and by id among those changed at one place. */
const LATEST_CHANGED = [desc(chatMessage.touchedSeq), desc(chatMessage.id)] as const;

const AskScopeSchema = Schema.Struct({
  organizationId: Schema.String,
  authorMemberId: Schema.NullOr(Schema.String),
  channelId: Schema.NullOr(Schema.String),
  open: Schema.Boolean,
  limit: Schema.NullOr(Schema.Number),
});

const findAsks = SqlSchema.findAll({
  Request: AskScopeSchema,
  Result: ChatMessageRowSchema,
  execute: (scope) =>
    Database.use((db) => {
      const read = db
        .select(MESSAGE_COLUMNS)
        .from(chatMessage)
        .where(
          and(
            eq(chatMessage.organizationId, scope.organizationId),
            isNotNull(chatMessage.askKey),
            scope.open
              ? eq(chatMessage.askStatus, ASK_STATUS.OPEN)
              : ne(chatMessage.askStatus, ASK_STATUS.OPEN),
            scope.authorMemberId === null
              ? undefined
              : eq(chatMessage.authorMemberId, scope.authorMemberId),
            scope.channelId === null ? undefined : eq(chatMessage.channelId, scope.channelId),
          ),
        )
        .orderBy(...LATEST_CHANGED);
      return scope.limit === null ? read : read.limit(scope.limit);
    }),
});

/**
 * The open asks that wait on the account across its workspaces: asked by
 * someone else, in a channel neither archived nor of an archived plan, and
 * in a DM only where the account is one of its two.
 */
function waitingOnAccount(userId: string): SQL | undefined {
  const own = (memberId: MemberColumn) =>
    queryBuilder
      .select({ id: chatMember.id })
      .from(chatMember)
      .where(and(eq(chatMember.id, memberId), eq(chatMember.userId, userId)));
  return and(
    eq(chatMessage.askStatus, ASK_STATUS.OPEN),
    exists(
      queryBuilder
        .select({ id: member.id })
        .from(member)
        .where(
          and(eq(member.organizationId, chatMessage.organizationId), eq(member.userId, userId)),
        ),
    ),
    notExists(own(chatMessage.authorMemberId)),
    isNull(chatChannel.archivedAt),
    isNull(task.archivedAt),
    or(
      ne(chatChannel.kind, CHANNEL_KIND.DM),
      exists(own(chatChannel.dmAMemberId)),
      exists(own(chatChannel.dmBMemberId)),
    ),
  );
}

const findWaiting = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String }),
  Result: Schema.Struct({ ...ChatMessageRowSchema.fields, planId: Schema.NullOr(Schema.String) }),
  execute: ({ userId }) =>
    Database.use((db) =>
      db
        .select({ ...MESSAGE_COLUMNS, planId: chatChannel.planId })
        .from(chatMessage)
        .innerJoin(chatChannel, eq(chatChannel.id, chatMessage.channelId))
        .leftJoin(task, eq(task.id, chatChannel.planId))
        .where(waitingOnAccount(userId))
        .orderBy(...WAITING_ORDER),
    ),
});

const findWaitingStamps = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String }),
  Result: Schema.Struct({
    id: Schema.String,
    revision: Schema.Number,
    status: Schema.Literals(Object.values(ASK_STATUS)),
    touchedSeq: Schema.Number,
  }),
  execute: ({ userId }) =>
    Database.use((db) =>
      db
        .select({
          id: chatMessage.id,
          revision: chatMessage.askRevision,
          status: chatMessage.askStatus,
          touchedSeq: chatMessage.touchedSeq,
        })
        .from(chatMessage)
        .innerJoin(chatChannel, eq(chatChannel.id, chatMessage.channelId))
        .leftJoin(task, eq(task.id, chatChannel.planId))
        .where(waitingOnAccount(userId))
        .orderBy(...WAITING_ORDER),
    ),
});

/**
 * The asks of an author or a channel, as a list of what is asked reads them:
 * every one still open, then the latest settled ones up to the limit, each
 * run the latest changed first. Note that the open asks are read apart from
 * the limit, because one left unanswered while many others changed must
 * still stand where it is looked for. None where the account is not in the
 * workspace.
 */
export function openAsksOf(
  userId: string,
  organizationId: string,
  scope: ChatAskScope,
  settledLimit = 0,
): ChatStoreEffect<readonly ChatMessageRow[]> {
  return Effect.gen(function* () {
    if (!(yield* isWorkspaceMember(userId, organizationId))) return [];
    const of = {
      organizationId,
      authorMemberId: "authorMemberId" in scope ? scope.authorMemberId : null,
      channelId: "channelId" in scope ? scope.channelId : null,
    };
    const open = yield* findAsks({ ...of, open: true, limit: null });
    if (settledLimit === 0) return open;
    const settled = yield* findAsks({ ...of, open: false, limit: settledLimit });
    return [...open, ...settled];
  });
}

/** Every ask that waits on the account across its workspaces, as `waitingOnAccount` reads them, the latest changed first. */
export function waitingOn(userId: string): ChatStoreEffect<readonly WaitingAsk[]> {
  return Effect.map(findWaiting({ userId }), (rows) =>
    rows.map(({ planId, ...message }) => ({ message, planId })),
  );
}

/** Where each ask `waitingOn` reads stands, the same asks and none of their words. */
export function waitingStamps(userId: string): ChatStoreEffect<readonly WaitingStamp[]> {
  return findWaitingStamps({ userId });
}

/** One picture as a post hands it in and a read answers it: the type its bytes were sniffed to be, and the bytes. */
export interface ChatImage {
  readonly contentType: ChatImageType;
  readonly bytes: Uint8Array;
}

/** One picture handed in under the id the message's image block names. */
export interface ChatImageWrite extends ChatImage {
  readonly id: string;
}

const insertAttachment = SqlSchema.void({
  Request: Schema.Struct({
    id: Schema.String,
    organizationId: Schema.String,
    messageId: Schema.String,
    contentType: chatImageTypeSchema,
    byteCount: Schema.Number,
    bytes: Schema.Uint8Array,
    now: Schema.Date,
  }),
  execute: ({ now, ...attachment }) =>
    // A picture already kept under its id stays as it was kept.
    Database.use((db) =>
      db
        .insert(chatAttachment)
        .values({ ...attachment, createdAt: now })
        .onConflictDoNothing(),
    ),
});

/** The message's attachments no id named any longer, deleted. */
const deleteOtherAttachments = SqlSchema.void({
  Request: Schema.Struct({ messageId: Schema.String, kept: Schema.Array(Schema.String) }),
  execute: ({ messageId, kept }) =>
    Database.use((db) =>
      db
        .delete(chatAttachment)
        .where(
          kept.length === 0
            ? eq(chatAttachment.messageId, messageId)
            : and(
                eq(chatAttachment.messageId, messageId),
                notInArray(chatAttachment.id, [...kept]),
              ),
        ),
    ),
});

const findAttachment = SqlSchema.findOneOption({
  Request: Schema.Struct({
    organizationId: Schema.String,
    messageId: Schema.String,
    attachmentId: Schema.String,
  }),
  Result: Schema.Struct({ contentType: chatImageTypeSchema, bytes: Schema.Uint8Array }),
  execute: (key) =>
    Database.use((db) =>
      db
        .select({ contentType: chatAttachment.contentType, bytes: chatAttachment.bytes })
        .from(chatAttachment)
        .where(
          and(
            eq(chatAttachment.organizationId, key.organizationId),
            eq(chatAttachment.messageId, key.messageId),
            eq(chatAttachment.id, key.attachmentId),
          ),
        ),
    ),
});

/** The message under its row's lock, with its author and the blocks that name its pictures. */
const lockMessageInWorkspace = SqlSchema.findOneOption({
  Request: Schema.Struct({ organizationId: Schema.String, messageId: Schema.String }),
  Result: Schema.Struct({
    authorMemberId: Schema.String,
    blocks: Schema.Array(chatReadBlockSchema),
  }),
  execute: (key) =>
    Database.use((db) =>
      db
        .select({ authorMemberId: chatMessage.authorMemberId, blocks: chatMessage.blocks })
        .from(chatMessage)
        .where(
          and(
            eq(chatMessage.organizationId, key.organizationId),
            eq(chatMessage.id, key.messageId),
          ),
        )
        .for("update"),
    ),
});

/** The attachment ids a message's image blocks name. */
function namedPictures(blocks: readonly ChatReadBlock[]): ReadonlySet<string> {
  return new Set(
    blocks.flatMap((block) =>
      block.type === CHAT_BLOCK.IMAGE && "attachmentId" in block ? [block.attachmentId] : [],
    ),
  );
}

/**
 * Keeps the pictures of a message, under the ids its image blocks name,
 * and deletes the ones it had that none of them names, so a picture an
 * ask dropped when it was posted again is dropped from the store. The
 * caller reads each picture's bytes from the poster's sandbox and mints
 * the id its block names. Written under the message's lock, so two writes
 * of one message's pictures take turns. Answers whether the message is the
 * author's, which the account acts as, in the workspace, and names every
 * picture handed in; nothing is written where it is not.
 */
export function attachMessageImages(
  userId: string,
  organizationId: string,
  authorMemberId: string,
  messageId: string,
  images: readonly ChatImageWrite[],
): ChatStoreEffect<boolean> {
  return transaction(
    Effect.gen(function* () {
      const author = yield* readerIn(userId, organizationId, authorMemberId);
      if (Option.isNone(author) || !actsAs(userId, author.value)) return false;
      const message = yield* lockMessageInWorkspace({ organizationId, messageId });
      if (Option.isNone(message) || message.value.authorMemberId !== authorMemberId) return false;
      const named = namedPictures(message.value.blocks);
      if (!images.every((image) => named.has(image.id))) return false;
      const now = yield* DateTime.nowAsDate;
      yield* deleteOtherAttachments({ messageId, kept: images.map((image) => image.id) });
      yield* Effect.forEach(images, (image) =>
        insertAttachment({
          id: image.id,
          organizationId,
          messageId,
          contentType: image.contentType,
          byteCount: image.bytes.byteLength,
          bytes: image.bytes,
          now,
        }),
      );
      return true;
    }),
  );
}

/** The picture, where it is the message's: its type and its bytes; nothing where the account is not in the workspace or the message carries no such picture. */
export function readAttachment(
  userId: string,
  organizationId: string,
  messageId: string,
  attachmentId: string,
): ChatStoreEffect<Option.Option<ChatImage>> {
  return Effect.gen(function* () {
    if (!(yield* isWorkspaceMember(userId, organizationId))) return Option.none();
    return yield* findAttachment({ organizationId, messageId, attachmentId });
  });
}

const findThreadAuthors = SqlSchema.findAll({
  Request: Schema.Struct({
    organizationId: Schema.String,
    rootId: Schema.String,
    beforeSeq: Schema.Number,
  }),
  Result: Schema.Struct({ authorMemberId: Schema.String }),
  execute: (key) =>
    Database.use((db) =>
      db
        .select({ authorMemberId: chatMessage.authorMemberId })
        .from(chatMessage)
        .where(
          and(
            eq(chatMessage.organizationId, key.organizationId),
            or(eq(chatMessage.id, key.rootId), eq(chatMessage.parentId, key.rootId)),
            lt(chatMessage.seq, key.beforeSeq),
          ),
        )
        .orderBy(asc(chatMessage.seq)),
    ),
});

/** Lets go of the notice stamped at the place given, where it still stands: one that could not be handed over is no notice outstanding. */
const dropNotice = SqlSchema.void({
  Request: Schema.Struct({ ...ReadKeySchema.fields, seq: Schema.Number }),
  execute: (key) =>
    Database.use((db) =>
      db
        .update(chatMember)
        .set({ noticeSeq: null, noticeChannelId: null })
        .where(
          and(
            eq(chatMember.id, key.readerId),
            eq(chatMember.organizationId, key.organizationId),
            eq(chatMember.noticeSeq, key.seq),
          ),
        ),
    ),
});

/** The channel under its id in the workspace; nothing where the account is not in it or no such channel is. */
export function channelOf(
  userId: string,
  organizationId: string,
  channelId: string,
): ChatStoreEffect<Option.Option<ChatChannelRow>> {
  return Effect.gen(function* () {
    if (!(yield* isWorkspaceMember(userId, organizationId))) return Option.none();
    return yield* findChannelInWorkspace({ organizationId, channelId });
  });
}

/**
 * Who has spoken in a thread before the place given: its root's author,
 * then each replier, each once, in the order they first spoke; none where
 * the account is not in the workspace.
 */
export function threadAuthors(
  userId: string,
  organizationId: string,
  rootId: string,
  beforeSeq: number,
): ChatStoreEffect<readonly string[]> {
  return Effect.gen(function* () {
    if (!(yield* isWorkspaceMember(userId, organizationId))) return [];
    const rows = yield* findThreadAuthors({ organizationId, rootId, beforeSeq });
    return [...new Set(rows.map((row) => row.authorMemberId))];
  });
}

/** Lets go of a notice stamped at the place given that could not be handed over, so the next one is told; nothing where another stands. */
export function releaseNotice(
  userId: string,
  organizationId: string,
  memberId: string,
  seq: number,
): ChatStoreEffect<void> {
  return Effect.gen(function* () {
    if (!(yield* isWorkspaceMember(userId, organizationId))) return;
    yield* dropNotice({ readerId: memberId, organizationId, seq });
  });
}

const findChannelMessages = SqlSchema.findAll({
  Request: Schema.Struct({ channelId: Schema.String }),
  Result: ChatMessageRowSchema,
  execute: ({ channelId }) =>
    Database.use((db) =>
      db
        .select(MESSAGE_COLUMNS)
        .from(chatMessage)
        .where(eq(chatMessage.channelId, channelId))
        .orderBy(asc(chatMessage.seq)),
    ),
});

/** The members a plan's move takes along: its planner, and the agents of the plan, in the workspace it leaves. */
const findPlanMembers = SqlSchema.findAll({
  Request: Schema.Struct({ planId: Schema.String, organizationId: Schema.String }),
  Result: ChatMemberRowSchema,
  execute: ({ planId, organizationId }) =>
    Database.use((db) =>
      db
        .select(MEMBER_COLUMNS)
        .from(chatMember)
        .where(
          and(
            eq(chatMember.organizationId, organizationId),
            or(
              eq(chatMember.planId, planId),
              inArray(
                chatMember.agentId,
                queryBuilder
                  .select({ id: codingAgent.id })
                  .from(codingAgent)
                  .where(eq(codingAgent.taskId, planId)),
              ),
            ),
          ),
        ),
    ),
});

const findMembersByIds = SqlSchema.findAll({
  Request: Schema.Struct({ ids: Schema.Array(Schema.String) }),
  Result: ChatMemberRowSchema,
  execute: ({ ids }) =>
    Database.use((db) =>
      db
        .select(MEMBER_COLUMNS)
        .from(chatMember)
        .where(inArray(chatMember.id, [...ids])),
    ),
});

/** A member the move leaves behind: no longer the agent's or the plan's, and stamped as having left the workspace it stays in. */
const releaseMember = SqlSchema.void({
  Request: Schema.Struct({ memberId: Schema.String, now: Schema.Date }),
  execute: ({ memberId, now }) =>
    Database.use((db) =>
      db
        .update(chatMember)
        .set({ agentId: null, planId: null, leftAt: now })
        .where(eq(chatMember.id, memberId)),
    ),
});

/** A person minted into a workspace they are not in, for the messages they wrote that moved there: on its roster as having left. */
const stampPersonLeft = SqlSchema.void({
  Request: Schema.Struct({ memberId: Schema.String, now: Schema.Date }),
  execute: ({ memberId, now }) =>
    Database.use((db) =>
      db.update(chatMember).set({ leftAt: now }).where(eq(chatMember.id, memberId)),
    ),
});

const moveChannel = SqlSchema.void({
  Request: Schema.Struct({
    channelId: Schema.String,
    organizationId: Schema.String,
    name: Schema.String,
  }),
  execute: (row) =>
    Database.use((db) =>
      db
        .update(chatChannel)
        .set({ organizationId: row.organizationId, name: row.name })
        .where(eq(chatChannel.id, row.channelId)),
    ),
});

const moveMessage = SqlSchema.void({
  Request: Schema.Struct({
    id: Schema.String,
    organizationId: Schema.String,
    seq: Schema.Number,
    touchedSeq: Schema.Number,
    authorMemberId: Schema.String,
    mentions: Schema.Array(Schema.String),
    answeredByMemberId: Schema.NullOr(Schema.String),
  }),
  execute: (row) =>
    Database.use((db) =>
      db
        .update(chatMessage)
        .set({
          organizationId: row.organizationId,
          seq: row.seq,
          touchedSeq: row.touchedSeq,
          authorMemberId: row.authorMemberId,
          mentions: [...row.mentions],
          answeredByMemberId: row.answeredByMemberId,
        })
        .where(eq(chatMessage.id, row.id)),
    ),
});

const moveAttachments = SqlSchema.void({
  Request: Schema.Struct({ channelId: Schema.String, organizationId: Schema.String }),
  execute: ({ channelId, organizationId }) =>
    Database.use((db) =>
      db
        .update(chatAttachment)
        .set({ organizationId })
        .where(
          inArray(
            chatAttachment.messageId,
            queryBuilder
              .select({ id: chatMessage.id })
              .from(chatMessage)
              .where(eq(chatMessage.channelId, channelId)),
          ),
        ),
    ),
});

const advanceSequence = SqlSchema.void({
  Request: Schema.Struct({ organizationId: Schema.String, by: Schema.Number }),
  execute: ({ organizationId, by }) =>
    Database.use((db) =>
      db
        .update(workspaceChat)
        .set({ nextSeq: sql`${workspaceChat.nextSeq} + ${by}` })
        .where(eq(workspaceChat.organizationId, organizationId)),
    ),
});

/**
 * The member a moved message's author or mention becomes in the workspace
 * the plan moved to: the plan's planner and its agents minted there again,
 * a person their member there, minted as having left where they are not
 * in it; and anyone else, an agent of another plan or one since deleted,
 * minted there as a former member of its kind that has left, so no moved
 * message still names a member of the workspace the plan left, whose
 * deletion would otherwise take the message with it.
 */
function memberAcross(
  member: ChatMemberRow,
  ofPlan: boolean,
  planId: string,
  organizationId: string,
): ChatStoreEffect<Option.Option<ChatMemberRow>> {
  return Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    if (member.kind === MEMBER_KIND.HUMAN && member.userId !== null) {
      const subject = { kind: MEMBER_KIND.HUMAN, userId: member.userId } as const;
      const key = { organizationId, kind: MEMBER_KIND.HUMAN, subjectId: member.userId };
      const standing = yield* findMemberOfSubject(key);
      if (Option.isSome(standing)) return standing;
      const minted = yield* mint(organizationId, subject);
      if (!(yield* isWorkspaceMember(member.userId, organizationId))) {
        yield* stampPersonLeft({ memberId: minted.id, now });
      }
      return Option.some(minted);
    }
    const subject = !ofPlan
      ? undefined
      : member.kind === MEMBER_KIND.PLANNER
        ? ({ kind: MEMBER_KIND.PLANNER, planId } as const)
        : member.agentId === null
          ? undefined
          : ({ kind: MEMBER_KIND.AGENT, agentId: member.agentId } as const);
    if (subject === undefined) return Option.some(yield* mintFormer(organizationId, member, now));
    yield* releaseMember({ memberId: member.id, now });
    return Option.some(yield* mint(organizationId, subject));
  });
}

/** A former agent or planner minted in the workspace as having left, naming no agent or plan, for the moved messages that name it. */
function mintFormer(
  organizationId: string,
  member: ChatMemberRow,
  now: Date,
): ChatStoreEffect<ChatMemberRow> {
  return Effect.gen(function* () {
    yield* lockWorkspace(organizationId);
    const { last } = yield* findLastOrdinal({ organizationId, kind: member.kind }).pipe(
      Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
    );
    const ordinal = (last ?? 0) + 1;
    const minted = yield* insertMember({
      organizationId,
      kind: member.kind,
      userId: null,
      agentId: null,
      planId: null,
      handle: member.kind === MEMBER_KIND.PLANNER ? PLANNER_HANDLE : `agent-${ordinal}`,
      ordinal,
      now,
    }).pipe(Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)));
    yield* stampPersonLeft({ memberId: minted.id, now });
    return { ...minted, leftAt: now };
  });
}

/** A member minted in the workspace for the subject, as `ensureMember` mints one, with no account's gate: the move is the plan's own, already gated. */
function mint(organizationId: string, subject: ChatMemberSubject): ChatStoreEffect<ChatMemberRow> {
  return Effect.gen(function* () {
    yield* lockWorkspace(organizationId);
    const { last } = yield* findLastOrdinal({ organizationId, kind: subject.kind }).pipe(
      Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
    );
    const ordinal = (last ?? 0) + 1;
    const handle = yield* mintHandle(organizationId, subject, ordinal);
    const now = yield* DateTime.nowAsDate;
    return yield* insertMember({
      organizationId,
      kind: subject.kind,
      userId: subject.kind === MEMBER_KIND.HUMAN ? subject.userId : null,
      agentId: subject.kind === MEMBER_KIND.AGENT ? subject.agentId : null,
      planId: subject.kind === MEMBER_KIND.PLANNER ? subject.planId : null,
      handle,
      ordinal,
      now,
    }).pipe(Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)));
  });
}

/** Lets go of every member's cursor in the channel and every notice outstanding in it. */
const forgetChannelReads = SqlSchema.void({
  Request: Schema.Struct({ channelId: Schema.String }),
  execute: ({ channelId }) =>
    Effect.andThen(
      Database.use((db) => db.delete(chatRead).where(eq(chatRead.channelId, channelId))),
      Database.use((db) =>
        db
          .update(chatMember)
          .set({ noticeSeq: null, noticeChannelId: null })
          .where(eq(chatMember.noticeChannelId, channelId)),
      ),
    ),
});

/**
 * Moves a plan's chat to the workspace the plan moved to, as the plan's own
 * move already gated: its channel, named apart where the new workspace holds
 * its name, and every message, ask, and picture in it, at the end of the new
 * workspace's sequence, their order kept, each message's last change after
 * every place its messages took. The plan's planner and its agents are
 * minted again there, and their members in the workspace the plan left let
 * go of them and are stamped as having left; every author, mention, and
 * answerer of a moved message is the member they are in the new workspace.
 * Every cursor in the channel and every notice outstanding in it are let
 * go of, since their places are the old sequence's. DMs, threads, and posts elsewhere stay where they were. Nothing where the
 * plan has no channel or it stands in that workspace already.
 */
export function movePlanChat(planId: string, organizationId: string): ChatStoreEffect<void> {
  return transaction(
    Effect.gen(function* () {
      const channel = yield* findPlanChannel(planId);
      if (Option.isNone(channel) || channel.value.organizationId === organizationId) return;
      const from = channel.value.organizationId;
      // Note that both workspaces are locked before both sequences, each pair in one order, because a post that mints a planner takes a workspace's lock before its sequence's, and two moves the other way at once would each wait on the other.
      const pair = [from, organizationId].toSorted();
      for (const held of pair) yield* lockWorkspace(held);
      for (const held of pair) yield* holdSequence(held);
      const messages = yield* findChannelMessages({ channelId: channel.value.id });
      const named = new Set(
        messages.flatMap((row) => [
          row.authorMemberId,
          ...row.mentions,
          ...(row.answeredByMemberId === null ? [] : [row.answeredByMemberId]),
        ]),
      );
      const ours = yield* findPlanMembers({ planId, organizationId: from });
      const others = yield* findMembersByIds({
        ids: [...named].filter((id) => !ours.some((row) => row.id === id)),
      });
      const across = new Map<string, string>();
      for (const [member, ofPlan] of [
        ...ours.map((row) => [row, true] as const),
        ...others.map((row) => [row, false] as const),
      ]) {
        const moved = yield* memberAcross(member, ofPlan, planId, organizationId);
        if (Option.isSome(moved)) across.set(member.id, moved.value.id);
      }
      const held = new Set(
        (yield* findChannels({ organizationId })).flatMap((row) =>
          row.name === null ? [] : [row.name],
        ),
      );
      const name = firstFree(
        channel.value.name ?? "plan",
        (candidate) => held.has(candidate) || candidate === GENERAL_CHANNEL,
      );
      yield* moveChannel({ channelId: channel.value.id, organizationId, name });
      // Places read in the sequence the channel left mean nothing in the one it joins.
      yield* forgetChannelReads({ channelId: channel.value.id });
      const head = (yield* headOf(organizationId)) + 1;
      const byTouch = messages.toSorted((a, b) => a.touchedSeq - b.touchedSeq);
      for (const [at, row] of messages.entries()) {
        const touched = byTouch.findIndex((each) => each.id === row.id);
        yield* moveMessage({
          id: row.id,
          organizationId,
          seq: head + at,
          touchedSeq: head + messages.length + touched,
          authorMemberId: across.get(row.authorMemberId) ?? row.authorMemberId,
          mentions: row.mentions.flatMap((id) => {
            const moved = across.get(id);
            return moved === undefined ? [] : [moved];
          }),
          answeredByMemberId:
            row.answeredByMemberId === null ? null : (across.get(row.answeredByMemberId) ?? null),
        });
      }
      yield* moveAttachments({ channelId: channel.value.id, organizationId });
      yield* advanceSequence({ organizationId, by: 2 * messages.length });
    }),
  );
}

const findSeqsOf = SqlSchema.findAll({
  Request: Schema.Struct({ organizationId: Schema.String, ids: Schema.Array(Schema.String) }),
  Result: Schema.Struct({ id: Schema.String, seq: Schema.Number }),
  execute: (key) =>
    Database.use((db) =>
      db
        .select({ id: chatMessage.id, seq: chatMessage.seq })
        .from(chatMessage)
        .where(
          and(
            eq(chatMessage.organizationId, key.organizationId),
            inArray(chatMessage.id, [...key.ids]),
          ),
        ),
    ),
});

/**
 * The places of the messages named by id in the workspace, by id: what a
 * reader names a thread's root by, where a reply carries its root's id.
 * Empty where the account is not in it or nothing is named.
 */
export function seqsOf(
  userId: string,
  organizationId: string,
  ids: readonly string[],
): ChatStoreEffect<ReadonlyMap<string, number>> {
  return Effect.gen(function* () {
    if (ids.length === 0 || !(yield* isWorkspaceMember(userId, organizationId))) return new Map();
    const rows = yield* findSeqsOf({ organizationId, ids });
    return new Map(rows.map((row) => [row.id, row.seq]));
  });
}

/**
 * The workspace a coding agent was started in, as its own row names it,
 * which is what seats a planless agent; nothing where the agent names none
 * or the account is not in it.
 */
export function agentWorkspace(
  userId: string,
  agentId: string,
): ChatStoreEffect<Option.Option<string>> {
  return Effect.gen(function* () {
    const found = yield* findAgentWorkspace(agentId);
    const organizationId = Option.flatMap(found, (row) => Option.fromNullishOr(row.organizationId));
    if (Option.isNone(organizationId)) return Option.none();
    return (yield* isWorkspaceMember(userId, organizationId.value))
      ? organizationId
      : Option.none();
  });
}
