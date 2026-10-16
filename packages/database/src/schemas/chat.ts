import {
  type AskStatus,
  CHANNEL_KIND,
  CHAT_BOUNDS,
  type ChannelKind,
  type ChatAsk,
  type ChatBlock,
  type ChatImageType,
  type ChatReply,
  MEMBER_KIND,
  type MemberKind,
} from "@luke/features/chat-wire";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { organization, user } from "./auth.js";
import { codingAgent } from "./coding-agent.js";
import { plan } from "./plan.js";

/** A fixed value spelled into a constraint or an index's condition, which take no parameter. */
const literal = (value: string) => sql.raw(`'${value}'`);

/**
 * chat.ts -- a workspace's chat: its members and its channels.
 *
 * A member is one person, coding agent, or plan's planner of a workspace,
 * minted once and kept: its handle is written as it joins and never moves,
 * so a message names its author the same way for life. A person's handle is
 * a slug of their name, an agent's `agent-N` by its ordinal among the
 * workspace's agents, and every planner's `luke`, which is why the handle is
 * unique among the workspace's people and agents alone and a planner is told
 * apart by its plan. Exactly one of the three ids stands, by kind: a person
 * goes with their account, while an agent or a plan deleted leaves its
 * member standing with no id, so the messages it wrote still name it.
 * `read_seq` is how far through the workspace's chat sequence the member
 * has read in every channel, the floor each channel's own cursor in
 * `chat_read` starts from, and `notice_seq` the sequence of the one notice
 * it was told and has not read past, in the channel `notice_channel_id`
 * names, null when none is outstanding. `left_at` is when an archived agent
 * or plan stopped hearing.
 *
 * A channel is the workspace's general one, a plan's own, a topic one a
 * member opened, or a DM, which names its two members in uuid order so one
 * pair is one channel. A channel's name is unique in its workspace, and a
 * DM has none.
 *
 * A message is a record of its own in a channel, addressed by its place in
 * the workspace's one chat sequence, which `workspace_chat` mints under its
 * row's lock as a conversation mints its rows' places, so one read past a
 * place reads every channel. `touched_seq` is the place the message last
 * changed at, its own place until a change moves it on, so a reader past
 * the message reads it again where it changed. A reply names its thread's
 * root as its parent, never another reply. Its body is the wire's blocks
 * (`@luke/features/chat-wire`), its mentions the members its words named,
 * resolved as it was posted, and its client key the poster's for the post,
 * unique in its channel, so a post repeated after a lost answer lands once.
 *
 * A message may carry an ask under a key of its author's, unique per author,
 * so posting under the key again writes the message again in place: its
 * revision moves on, it opens again, and what it asks replaces what it
 * asked. The ask is the wire's own JSON (`chatAskSchema`). An answer is
 * taken at the revision it names while the ask is open, written beside it
 * with the key the answer was sent under and the member who answered, and
 * posted as that member's reply in the ask's thread; the poster resolves it
 * with why. `touched_at` is when the message last changed, which an inbox
 * item reads as its update. Every row goes with its workspace.
 */
export const chatMember = pgTable(
  "chat_member",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: text("kind").$type<MemberKind>().notNull(),
    /** The person's account, on a person's member. */
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    /** The coding agent, on an agent's member; null once the agent is deleted. */
    agentId: uuid("agent_id").references(() => codingAgent.id, { onDelete: "set null" }),
    /** The plan, on a planner's member; null once the plan is deleted. */
    planId: uuid("plan_id").references(() => plan.id, { onDelete: "set null" }),
    /** The member's handle, without its `@`, minted once. */
    handle: text("handle").notNull(),
    /** The member's place among its workspace's members of its kind, from one: an agent's `N`. */
    ordinal: integer("ordinal").notNull(),
    /** How far through the workspace's chat sequence the member has read in every channel. */
    readSeq: integer("read_seq").notNull().default(0),
    /** The sequence of the notice the member was told and has not read past; null when none is outstanding. */
    noticeSeq: integer("notice_seq"),
    /** The channel of the notice outstanding, which a read of that channel past it lets go of. */
    noticeChannelId: uuid("notice_channel_id").references((): AnyPgColumn => chatChannel.id, {
      onDelete: "set null",
    }),
    joinedAt: timestamptz("joined_at").notNull(),
    /** When the member stopped hearing, an archived agent or plan; null while it hears. */
    leftAt: timestamptz("left_at"),
  },
  (table) => [
    // A handle names one person or agent of the workspace; every planner is `luke`.
    uniqueIndex("chat_member_organization_handle")
      .on(table.organizationId, table.handle)
      .where(sql`${table.kind} <> ${literal(MEMBER_KIND.PLANNER)}`),
    uniqueIndex("chat_member_organization_kind_ordinal").on(
      table.organizationId,
      table.kind,
      table.ordinal,
    ),
    // One member per person per workspace, per agent, and per plan.
    uniqueIndex("chat_member_organization_user")
      .on(table.organizationId, table.userId)
      .where(sql`${table.userId} is not null`),
    uniqueIndex("chat_member_agent").on(table.agentId).where(sql`${table.agentId} is not null`),
    uniqueIndex("chat_member_plan").on(table.planId).where(sql`${table.planId} is not null`),
    check(
      "chat_member_id_of_kind",
      sql`(${table.kind} = ${literal(MEMBER_KIND.HUMAN)}) = (${table.userId} is not null)
        and (${table.agentId} is null or ${table.kind} = ${literal(MEMBER_KIND.AGENT)})
        and (${table.planId} is null or ${table.kind} = ${literal(MEMBER_KIND.PLANNER)})`,
    ),
  ],
);

export const chatChannel = pgTable(
  "chat_channel",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: text("kind").$type<ChannelKind>().notNull(),
    /** The channel's name, without its `#`; null for a DM. */
    name: text("name"),
    /** The plan, on a plan's channel. */
    planId: uuid("plan_id").references(() => plan.id, { onDelete: "cascade" }),
    /** A DM's member whose id sorts first. */
    dmAMemberId: uuid("dm_a_member_id").references((): AnyPgColumn => chatMember.id, {
      onDelete: "cascade",
    }),
    /** A DM's member whose id sorts second. */
    dmBMemberId: uuid("dm_b_member_id").references((): AnyPgColumn => chatMember.id, {
      onDelete: "cascade",
    }),
    /** The member who opened a topic channel or a DM; null for one the service opened. */
    createdByMemberId: uuid("created_by_member_id").references((): AnyPgColumn => chatMember.id, {
      onDelete: "set null",
    }),
    createdAt: timestamptz("created_at").notNull(),
    /** When the channel was archived, which a plan's archive does to its channel; null while it stands. */
    archivedAt: timestamptz("archived_at"),
  },
  (table) => [
    uniqueIndex("chat_channel_organization_name")
      .on(table.organizationId, table.name)
      .where(sql`${table.name} is not null`),
    uniqueIndex("chat_channel_organization_dm")
      .on(table.organizationId, table.dmAMemberId, table.dmBMemberId)
      .where(sql`${table.kind} = ${literal(CHANNEL_KIND.DM)}`),
    uniqueIndex("chat_channel_plan")
      .on(table.planId)
      .where(sql`${table.kind} = ${literal(CHANNEL_KIND.PLAN)}`),
    // The workspace's channels are read on every look of the window's held read.
    index("chat_channel_organization_created").on(table.organizationId, table.createdAt),
    check(
      "chat_channel_shape_of_kind",
      sql`(${table.kind} = ${literal(CHANNEL_KIND.DM)}) = (${table.name} is null)
        and (${table.kind} = ${literal(CHANNEL_KIND.DM)}) = (${table.dmAMemberId} is not null and ${table.dmBMemberId} is not null)
        and (${table.dmAMemberId} is null or ${table.dmAMemberId} < ${table.dmBMemberId})`,
    ),
  ],
);

/**
 * How far one member has read one channel, past the member's own floor
 * (`chat_member.read_seq`): a member's cursor in a channel is the greater
 * of the two, so reading one channel marks no other read, and a channel
 * the member never read on its own reads from the floor. The row goes with
 * its member and its channel.
 */
export const chatRead = pgTable(
  "chat_read",
  {
    memberId: uuid("member_id")
      .notNull()
      .references(() => chatMember.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => chatChannel.id, { onDelete: "cascade" }),
    /** How far through the workspace's chat sequence the member has read the channel. */
    readSeq: integer("read_seq").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.memberId, table.channelId] }),
    // A channel's readers are let go of when the channel moves to another workspace.
    index("chat_read_channel").on(table.channelId),
  ],
);

/** The next place a workspace's chat sequence hands out, from one; the row is made with the workspace's first post. */
export const workspaceChat = pgTable("workspace_chat", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  nextSeq: integer("next_seq").notNull().default(1),
});

export const chatMessage = pgTable(
  "chat_message",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => chatChannel.id, { onDelete: "cascade" }),
    /** The message's place in the workspace's chat sequence. */
    seq: integer("seq").notNull(),
    /** The place the message last changed at: its own until a change moves it on. */
    touchedSeq: integer("touched_seq").notNull(),
    /** The thread's root, on a reply; null on a root. */
    parentId: uuid("parent_id").references((): AnyPgColumn => chatMessage.id, {
      onDelete: "cascade",
    }),
    authorMemberId: uuid("author_member_id")
      .notNull()
      .references(() => chatMember.id, { onDelete: "cascade" }),
    /** The body, as the wire's blocks. */
    blocks: jsonb("blocks").$type<readonly ChatBlock[]>().notNull(),
    /** The members the words named, as they were resolved when it was posted. */
    mentions: uuid("mentions").array().notNull().default(sql`'{}'::uuid[]`),
    /** The poster's key for the post, unique in its channel. */
    clientKey: text("client_key").notNull(),
    createdAt: timestamptz("created_at").notNull(),
    /** When the message last changed: when it was posted until a change moves it on. */
    touchedAt: timestamptz("touched_at").notNull().defaultNow(),
    /** The ask the message carries; null on a message that asks nothing. */
    ask: jsonb("ask").$type<ChatAsk>(),
    /** The author's key for the ask; null with no ask. */
    askKey: text("ask_key"),
    /** Moved on by every change of the author's, which an answer names so it answers the ask it was shown. */
    askRevision: integer("ask_revision"),
    askStatus: text("ask_status").$type<AskStatus>(),
    /** The answer; null until one is taken. */
    answer: jsonb("answer").$type<ChatReply>(),
    /** The key the answer was sent under; null until one is taken. */
    answerKey: text("answer_key"),
    /** The member who answered; null until one is taken. */
    answeredByMemberId: uuid("answered_by_member_id").references((): AnyPgColumn => chatMember.id, {
      onDelete: "set null",
    }),
    /** Why the author resolved the ask; null until it does. */
    closedReason: text("closed_reason"),
  },
  (table) => [
    uniqueIndex("chat_message_organization_seq").on(table.organizationId, table.seq),
    uniqueIndex("chat_message_channel_client_key").on(table.channelId, table.clientKey),
    // A channel's history, read back from a place.
    index("chat_message_channel_seq").on(table.channelId, table.seq),
    // A thread's replies, in order.
    index("chat_message_parent_seq")
      .on(table.parentId, table.seq)
      .where(sql`${table.parentId} is not null`),
    // What changed past a reader's cursor.
    index("chat_message_organization_touched").on(table.organizationId, table.touchedSeq),
    // One ask per key per author: a post under a key it used is that ask's write.
    uniqueIndex("chat_message_author_ask_key")
      .on(table.authorMemberId, table.askKey)
      .where(sql`${table.askKey} is not null`),
    // What waits across a workspace is read on every look of a held read.
    index("chat_message_organization_ask_status")
      .on(table.organizationId, table.askStatus)
      .where(sql`${table.askKey} is not null`),
    check(
      "chat_message_ask_whole",
      sql`(${table.askKey} is null) = (${table.ask} is null)
        and (${table.askKey} is null) = (${table.askRevision} is null)
        and (${table.askKey} is null) = (${table.askStatus} is null)`,
    ),
  ],
);

/** A column of raw bytes, read and written as they stand. */
const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "bytea",
});

/**
 * One picture of a chat message's: the bytes of an image block, kept beside
 * the message it belongs to, as an inbox item's are (`inbox-attachment.ts`).
 * An agent posts an image by the path of a file in its sandbox; the service
 * reads the file and keeps it here, so the message's block names a row of
 * this table rather than anything the agent wrote, and a reader fetches it
 * under the account. The bytes stand in the row, bounded by a check on the
 * column at the image bound, and the media type is what the service sniffed
 * them to be. The row goes with its message and its workspace.
 */
export const chatAttachment = pgTable(
  "chat_attachment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    messageId: uuid("message_id")
      .notNull()
      .references(() => chatMessage.id, { onDelete: "cascade" }),
    /** The media type the bytes were sniffed to be, which they are served under. */
    contentType: text("content_type").$type<ChatImageType>().notNull(),
    /** How many bytes the picture is, read off the row without the bytes. */
    byteCount: integer("byte_count").notNull(),
    bytes: bytea("bytes").notNull(),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    // A message's attachments are read and deleted by the message.
    index("chat_attachment_message").on(table.messageId),
    check(
      "chat_attachment_bytes_bound",
      sql`octet_length(${table.bytes}) <= ${sql.raw(String(CHAT_BOUNDS.MAX_IMAGE_BYTES))}`,
    ),
  ],
);
