import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema.js";

/**
 * The hosted conversation, one directory per account, mirroring the tables
 * the desktop's SQLite store keeps under Luke's application data. Every row
 * is keyed by the user it belongs to and cascades away with the user row, so
 * deleting an account is still one statement.
 *
 * Two lifetimes are kept apart here as they are there. A conversation
 * session — the brain's generation — is replaced by Start fresh or Clear, and
 * its checkpoints, cursors, inbox, runs, and receipts cascade with it. The
 * conversation's lines and its retained transcript answer to the
 * conversation instead: each names the session that stood when it was
 * written, for attribution alone, and the column is not a foreign key, so
 * replacing a generation erases no line. Clear is the one thing that reaches
 * both, and on the hosted tier it is a hard delete: the lines, the
 * transcript, and the boundaries go, with no recovery archive behind them.
 *
 * Indexable columns — ids, keys, sequences, instants, states, fixed
 * vocabulary words — stand clear. Everything user-derived (checkpoint items,
 * inbox entries, a run's question and reply, an action's arguments and
 * output, a line's payload, a transcript event's payload) is a `sealed_*`
 * column holding the payload envelope of `server/hosted/encryption.ts`, and
 * nothing reads it back but the store that sealed it.
 *
 * Instants are epoch milliseconds in `bigint` columns rather than
 * `timestamp`, because the storage contracts carry numbers and a round trip
 * through a timestamp type would be a second clock to keep in step.
 */

export const conversation = pgTable(
  "conversation",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The conversation's stable address (`agent:<agentId>:main`, a thread, an observed session). */
    sessionKey: text("session_key").notNull(),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    lastActivityAt: bigint("last_activity_at", { mode: "number" }).notNull(),
    /** The next line sequence to hand out; counted up and never reused, however many lines a Clear let go of. */
    nextLineSequence: bigint("next_line_sequence", { mode: "number" }).notNull().default(1),
    nextTranscriptSequence: bigint("next_transcript_sequence", { mode: "number" })
      .notNull()
      .default(1),
    /** The Clear cutoff before which no line may stand; only ever raised, and outliving the generation that raised it. */
    clearedAt: bigint("cleared_at", { mode: "number" }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.sessionKey] })],
);

export const conversationSession = pgTable(
  "conversation_session",
  {
    userId: text("user_id").notNull(),
    /** The generation's id, minted by the brain at its birth. */
    sessionId: text("session_id").notNull(),
    sessionKey: text("session_key").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
    resetClearedAt: bigint("reset_cleared_at", { mode: "number" }),
    resetGenerationId: text("reset_generation_id"),
    /** Whose shape the checkpoint items are; absent on a generation never checkpointed into. */
    checkpointFormat: text("checkpoint_format"),
    compactionCount: integer("compaction_count").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.sessionId] }),
    uniqueIndex("conversation_session_one_standing").on(table.userId, table.sessionKey),
    foreignKey({
      columns: [table.userId, table.sessionKey],
      foreignColumns: [conversation.userId, conversation.sessionKey],
      name: "conversation_session_conversation_fk",
    }).onDelete("cascade"),
  ],
);

export const runtimeCheckpoint = pgTable(
  "runtime_checkpoint",
  {
    userId: text("user_id").notNull(),
    sessionId: text("session_id").notNull(),
    sequence: integer("sequence").notNull(),
    /** One Responses input item. Sealed. */
    sealedItem: text("sealed_item").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.sessionId, table.sequence] }),
    foreignKey({
      columns: [table.userId, table.sessionId],
      foreignColumns: [conversationSession.userId, conversationSession.sessionId],
      name: "runtime_checkpoint_session_fk",
    }).onDelete("cascade"),
  ],
);

/** Where a model has read each observed transcript to, keyed by provider and provider session. */
export const observationCursor = pgTable(
  "observation_cursor",
  {
    userId: text("user_id").notNull(),
    sessionId: text("session_id").notNull(),
    providerId: text("provider_id").notNull(),
    providerSessionId: text("provider_session_id").notNull(),
    cursor: text("cursor").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.sessionId, table.providerId, table.providerSessionId],
    }),
    foreignKey({
      columns: [table.userId, table.sessionId],
      foreignColumns: [conversationSession.userId, conversationSession.sessionId],
      name: "observation_cursor_session_fk",
    }).onDelete("cascade"),
  ],
);

/** Where the inbox has captured each transcript to; ahead of the consumed cursor while entries wait. */
export const observationCaptureCursor = pgTable(
  "observation_capture_cursor",
  {
    userId: text("user_id").notNull(),
    sessionId: text("session_id").notNull(),
    providerId: text("provider_id").notNull(),
    providerSessionId: text("provider_session_id").notNull(),
    cursor: text("cursor").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.sessionId, table.providerId, table.providerSessionId],
    }),
    foreignKey({
      columns: [table.userId, table.sessionId],
      foreignColumns: [conversationSession.userId, conversationSession.sessionId],
      name: "observation_capture_cursor_session_fk",
    }).onDelete("cascade"),
  ],
);

export const observationInboxEntry = pgTable(
  "observation_inbox_entry",
  {
    userId: text("user_id").notNull(),
    sessionId: text("session_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    entryId: text("entry_id").notNull(),
    /** The observation entry whole, transcript delta included. Sealed. */
    sealedPayload: text("sealed_payload").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.sessionId, table.ordinal] }),
    foreignKey({
      columns: [table.userId, table.sessionId],
      foreignColumns: [conversationSession.userId, conversationSession.sessionId],
      name: "observation_inbox_entry_session_fk",
    }).onDelete("cascade"),
  ],
);

/**
 * One run of the brain: the developer's ask as the brain owns it from
 * acceptance to its end, and beside the record the turn's about-fields —
 * what woke it, how it ended, what it counted — which the trace records on
 * the desktop and the run row carries here. The about-fields describe the
 * turn and never quote it: item kinds and tool names are fixed vocabulary,
 * and every count is a number.
 */
export const conversationRun = pgTable(
  "conversation_run",
  {
    userId: text("user_id").notNull(),
    runId: text("run_id").notNull(),
    sessionId: text("session_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    submissionId: text("submission_id").notNull(),
    origin: text("origin").notNull(),
    /** The ask as the brain was handed it. Sealed. */
    sealedQuestion: text("sealed_question").notNull(),
    status: text("status").notNull(),
    revision: integer("revision").notNull(),
    acceptedAt: bigint("accepted_at", { mode: "number" }).notNull(),
    startedAt: bigint("started_at", { mode: "number" }),
    settledAt: bigint("settled_at", { mode: "number" }),
    /** The reply, when the run reached one. Sealed. */
    sealedText: text("sealed_text"),
    failure: text("failure"),
    performedActions: integer("performed_actions").notNull(),
    unknownActions: integer("unknown_actions").notNull(),
    askRecordedAt: bigint("ask_recorded_at", { mode: "number" }),
    conversationRecordedAt: bigint("conversation_recorded_at", { mode: "number" }),
    /**
     * When the developer asked for the run to be cancelled through the
     * service, for the function running it — or the one that resumes it — to
     * read at its next heartbeat; the record's own end is still the brain's.
     */
    cancelRequestedAt: bigint("cancel_requested_at", { mode: "number" }),
    trigger: text("trigger"),
    runOrigin: text("run_origin"),
    ending: text("ending"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    inputItemKinds: text("input_item_kinds").array(),
    transcriptBytes: integer("transcript_bytes"),
    elapsedMs: integer("elapsed_ms"),
    toolNames: text("tool_names").array(),
    compacted: boolean("compacted"),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.runId] }),
    foreignKey({
      columns: [table.userId, table.sessionId],
      foreignColumns: [conversationSession.userId, conversationSession.sessionId],
      name: "conversation_run_session_fk",
    }).onDelete("cascade"),
    index("conversation_run_by_session").on(table.userId, table.sessionId, table.ordinal),
  ],
);

export const actionReceipt = pgTable(
  "action_receipt",
  {
    userId: text("user_id").notNull(),
    runId: text("run_id").notNull(),
    callId: text("call_id").notNull(),
    sessionId: text("session_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    name: text("name").notNull(),
    /** The action's arguments as the model wrote them. Sealed. */
    sealedArguments: text("sealed_arguments").notNull(),
    startedAt: bigint("started_at", { mode: "number" }).notNull(),
    /** The action's outcome, once the performer answered. Sealed. */
    sealedOutput: text("sealed_output"),
    settledAt: bigint("settled_at", { mode: "number" }),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.runId, table.callId] }),
    foreignKey({
      columns: [table.userId, table.sessionId],
      foreignColumns: [conversationSession.userId, conversationSession.sessionId],
      name: "action_receipt_session_fk",
    }).onDelete("cascade"),
    index("action_receipt_by_session").on(table.userId, table.sessionId, table.ordinal),
  ],
);

/**
 * The conversation's lines as the panel draws them. An append is idempotent
 * on `event_key`, the hash of the line's own identity — its writer's id, or
 * its value for a line that reached the store without one — so the identity
 * of a value-keyed line, which is its words, never stands clear in an index.
 * A run's ask and its end are each published once however many clients
 * report them, and the partial unique index over the run and kind is what
 * carries that rule.
 */
export const conversationLine = pgTable(
  "conversation_line",
  {
    userId: text("user_id").notNull(),
    sessionKey: text("session_key").notNull(),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    /** The generation standing at the write, for attribution alone; not a foreign key. */
    sessionId: text("session_id"),
    eventKey: text("event_key").notNull(),
    kind: text("kind").notNull(),
    recordedAt: bigint("recorded_at", { mode: "number" }).notNull(),
    requestId: text("request_id"),
    providerId: text("provider_id"),
    providerSessionId: text("provider_session_id"),
    /** The line whole, exactly the entry, so the projection is the record read back. Sealed. */
    sealedPayload: text("sealed_payload").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.sessionKey, table.sequence] }),
    foreignKey({
      columns: [table.userId, table.sessionKey],
      foreignColumns: [conversation.userId, conversation.sessionKey],
      name: "conversation_line_conversation_fk",
    }).onDelete("cascade"),
    uniqueIndex("conversation_line_by_key").on(table.userId, table.sessionKey, table.eventKey),
    index("conversation_line_by_time").on(
      table.userId,
      table.sessionKey,
      table.recordedAt,
      table.sequence,
    ),
    uniqueIndex("conversation_line_once_published")
      .on(table.userId, table.sessionKey, table.requestId, table.kind)
      .where(sql`${table.requestId} is not null`),
  ],
);

/**
 * The retained transcript: every input the context engine ingested and every
 * point the projection folded, per conversation. A compaction changes the
 * projection and erases nothing here, which is what makes the transcript the
 * record and the checkpoint the projection.
 */
export const transcriptEvent = pgTable(
  "transcript_event",
  {
    userId: text("user_id").notNull(),
    sessionKey: text("session_key").notNull(),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    /** The generation the event was written under, for attribution alone; not a foreign key. */
    sessionId: text("session_id"),
    kind: text("kind").notNull(),
    recordedAt: bigint("recorded_at", { mode: "number" }).notNull(),
    /** The event less its kind and clock: the context input, or the boundary. Sealed. */
    sealedPayload: text("sealed_payload").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.sessionKey, table.sequence] }),
    foreignKey({
      columns: [table.userId, table.sessionKey],
      foreignColumns: [conversation.userId, conversation.sessionKey],
      name: "transcript_event_conversation_fk",
    }).onDelete("cascade"),
  ],
);

export const compactionBoundary = pgTable(
  "compaction_boundary",
  {
    userId: text("user_id").notNull(),
    sessionKey: text("session_key").notNull(),
    transcriptSequence: bigint("transcript_sequence", { mode: "number" }).notNull(),
    sessionId: text("session_id"),
    source: text("source").notNull(),
    dropped: integer("dropped").notNull(),
    checkpointFormat: text("checkpoint_format"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.sessionKey, table.transcriptSequence] }),
    foreignKey({
      columns: [table.userId, table.sessionKey],
      foreignColumns: [conversation.userId, conversation.sessionKey],
      name: "compaction_boundary_conversation_fk",
    }).onDelete("cascade"),
  ],
);
