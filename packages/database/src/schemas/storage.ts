import type { RunModelUsage, RunUsage } from "@repo/features/turn-run";
import {
  MESSAGE_ROLE,
  type MessageRole,
  type StoredMessageMetadata,
  TURN_STATUS,
  type TurnOrigin,
  type TurnStatus,
} from "@repo/wire";
import type { StoredUIMessage } from "@repo/wire/ui-messages";
import { type SQL, type SQLWrapper, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  CONVERSATION_KIND,
  type ConversationRuntime,
  type MessageSender,
} from "../storage-vocabulary.js";
import { createdAt, timestamptz } from "./_helpers.js";
import { user } from "./auth.js";

type ConversationKind = (typeof CONVERSATION_KIND)[keyof typeof CONVERSATION_KIND];

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").$type<ConversationKind>().notNull(),
    title: text("title"),
    parentConversationId: uuid("parent_conversation_id").references(
      (): AnyPgColumn => conversations.id,
      { onDelete: "cascade" },
    ),
    runtimeSessionId: text("runtime_session_id"),
    createdAt: createdAt(),
    lastActivityAt: timestamptz("last_activity_at").notNull().defaultNow(),
    deletedAt: timestamptz("deleted_at"),
    nextMessageSeq: bigint("next_message_seq", { mode: "number" }).notNull().default(1),
    journalRevision: bigint("journal_revision", { mode: "number" }).notNull().default(0),
    label: text("label"),
    expectsCompletion: boolean("expects_completion").notNull().default(true),
    runtime: text("runtime").$type<ConversationRuntime>(),
    nativeSession: text("native_session"),
    nativeSequence: bigint("native_sequence", { mode: "number" }),
    nativeProjection: jsonb("native_projection"),
    rewoundRevision: bigint("rewound_revision", { mode: "number" }),
    nativeRewind: text("native_rewind"),
    nativeHanded: jsonb("native_handed"),
    dispatchClaim: uuid("dispatch_claim"),
    dispatchClaimedAt: timestamptz("dispatch_claimed_at"),
    dispatchLine: uuid("dispatch_line"),
  },
  (table) => [
    uniqueIndex("conversations_standing_main")
      .on(table.userId)
      .where(
        sql`${table.kind} = ${sql.raw(`'${CONVERSATION_KIND.MAIN}'`)} and ${table.deletedAt} is null`,
      ),
    index("conversations_deleted_at")
      .on(table.deletedAt)
      .where(sql`${table.deletedAt} is not null`),
    index("conversations_user_kind").on(table.userId, table.kind),
    index("conversations_runtime_session")
      .on(table.runtimeSessionId)
      .where(sql`${table.runtimeSessionId} is not null`),
    index("conversations_parent")
      .on(table.parentConversationId)
      .where(sql`${table.parentConversationId} is not null`),
  ],
);

export function turnlessUserLine(table: {
  readonly role: SQLWrapper;
  readonly turnId: SQLWrapper;
}): SQL {
  return sql`(${table.role} = ${sql.raw(`'${MESSAGE_ROLE.USER}'`)} and ${table.turnId} is null)`;
}

export function standingLine(table: {
  readonly withdrawnAt: SQLWrapper;
  readonly turnId: SQLWrapper;
}): SQL {
  return sql`(${table.withdrawnAt} is null or ${table.turnId} is not null)`;
}

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    seq: bigint("seq", { mode: "number" }).notNull(),
    turnId: uuid("turn_id").references((): AnyPgColumn => turns.id),
    clientId: text("client_id").notNull(),
    role: text("role").$type<MessageRole>().notNull(),
    parts: jsonb("parts").$type<StoredUIMessage["parts"]>().notNull(),
    metadata: jsonb("metadata").$type<StoredMessageMetadata>(),
    createdAt: createdAt(),
    finishedAt: timestamptz("finished_at"),
    revision: bigint("revision", { mode: "number" }),
    placedAt: timestamptz("placed_at").notNull(),
    sender: text("sender").$type<MessageSender>(),
    senderUserId: text("sender_user_id").references(() => user.id, { onDelete: "set null" }),
    senderName: text("sender_name"),
    senderModel: text("sender_model"),
    senderAgentId: uuid("sender_agent_id"),
    senderAutomationId: uuid("sender_automation_id"),
    takenAfterStep: integer("taken_after_step"),
    withdrawnAt: timestamptz("withdrawn_at"),
  },
  (table) => [
    unique("messages_conversation_client").on(table.conversationId, table.clientId),
    unique("messages_conversation_seq").on(table.conversationId, table.seq),
    index("messages_conversation_revision")
      .on(table.conversationId, table.revision)
      .where(sql`${table.revision} is not null`),
    index("messages_awaiting_line")
      .on(table.conversationId, table.seq)
      .where(turnlessUserLine(table)),
    index("messages_turn").on(table.turnId).where(sql`${table.turnId} is not null`),
    index("messages_withdrawn").on(table.withdrawnAt).where(sql`${table.withdrawnAt} is not null`),
  ],
);

export interface StoredTurnUsage extends RunUsage {
  readonly byModel?: readonly RunModelUsage[];
}

export const turns = pgTable(
  "turns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    origin: text("origin").$type<TurnOrigin>().notNull(),
    status: text("status").$type<TurnStatus>().notNull(),
    model: text("model"),
    reasoningEffort: text("reasoning_effort"),
    promptHash: text("prompt_hash"),
    toolSetHash: text("tool_set_hash"),
    responseIds: text("response_ids").array(),
    usage: jsonb("usage").$type<StoredTurnUsage>(),
    eveTurnId: text("eve_turn_id"),
    queuedAt: timestamptz("queued_at").notNull().defaultNow(),
    startedAt: timestamptz("started_at"),
    settledAt: timestamptz("settled_at"),
    failure: text("failure"),
    failureDetail: text("failure_detail"),
    cancelRequestedAt: timestamptz("cancel_requested_at"),
    cancelRequestKey: text("cancel_request_key"),
    cancelRequestedBy: uuid("cancel_requested_by"),
    fastRefused: boolean("fast_refused").notNull().default(false),
    descriptionNotesTaken: integer("description_notes_taken").notNull().default(0),
  },
  (table) => [
    index("turns_by_user").on(table.userId),
    index("turns_conversation_queued").on(
      table.conversationId,
      table.queuedAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    index("turns_running_started")
      .on(table.startedAt, table.id)
      .where(sql`${table.status} = ${sql.raw(`'${TURN_STATUS.RUNNING}'`)}`),
  ],
);

export const dispatchWaiters = pgTable(
  "dispatch_waiters",
  {
    place: bigint("place", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    seenAt: timestamptz("seen_at").notNull().defaultNow(),
  },
  (table) => [index("dispatch_waiters_conversation_place").on(table.conversationId, table.place)],
);
