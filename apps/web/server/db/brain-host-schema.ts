import { bigint, foreignKey, index, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { user } from "./auth-schema.js";
import { conversation, conversationLine } from "./conversation-schema.js";

/**
 * What the hosted brain host keeps beside the conversation tables to run
 * request-scoped: who holds a conversation right now, and what the developer
 * thought of a line Luke wrote.
 *
 * A lease is the one thing standing between two functions that would both
 * run a turn over one conversation: whichever acquires it runs, heartbeats
 * while it does, and releases at the end, and a lease whose heartbeat stopped
 * — a function cut off by its own duration — expires so the next request or
 * tick can pick the run up from its journal. It hangs from the user rather
 * than the conversation row, because a Clear deletes the conversation under
 * the lease that guards the Clear itself. Nothing here is sealed: an owner
 * id is the function's own random token and the rest are instants.
 */
export const conversationLease = pgTable(
  "conversation_lease",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sessionKey: text("session_key").notNull(),
    ownerId: text("owner_id").notNull(),
    acquiredAt: bigint("acquired_at", { mode: "number" }).notNull(),
    heartbeatAt: bigint("heartbeat_at", { mode: "number" }).notNull(),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.sessionKey] })],
);

/**
 * The developer's rating of one line Luke authored, a reply or an
 * announcement: a thumb, and the words they added if any. It hangs from the
 * line by the key the line is idempotent on, so it goes with the line at a
 * Clear and with the user at deletion, and it names the device it was pressed
 * on and the instant. The rating itself is a fixed word and stands clear, so
 * "why was this rated down" can join it to the run's about-fields; the note
 * is the developer's own words and is sealed.
 */
export const conversationLineRating = pgTable(
  "conversation_line_rating",
  {
    userId: text("user_id").notNull(),
    sessionKey: text("session_key").notNull(),
    eventKey: text("event_key").notNull(),
    rating: text("rating").notNull(),
    /** The developer's words about the rating, when they added any. Sealed. */
    sealedNote: text("sealed_note"),
    deviceId: text("device_id").notNull(),
    ratedAt: bigint("rated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.sessionKey, table.eventKey] }),
    foreignKey({
      columns: [table.userId, table.sessionKey],
      foreignColumns: [conversation.userId, conversation.sessionKey],
      name: "conversation_line_rating_conversation_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.userId, table.sessionKey, table.eventKey],
      foreignColumns: [
        conversationLine.userId,
        conversationLine.sessionKey,
        conversationLine.eventKey,
      ],
      name: "conversation_line_rating_line_fk",
    }).onDelete("cascade"),
    index("conversation_line_rating_by_rating").on(table.userId, table.rating, table.ratedAt),
  ],
);
