/**
 * notification.ts -- the topics a write touches, and what a notification on Luke Sync's channel carries.
 *
 * A synced table's triggers (`render.ts`) send each write's topics on one
 * channel, and the listener (`listener.ts`) hands what arrives to whoever
 * waits on them. A topic is a `(kind, id)` pair: the kind of thing a view
 * follows and that thing's id, kept apart and never joined into one string.
 * A change carries the topics a transaction's write touched and that
 * transaction's id (`pg_current_xact_id()`, 64 bits, so text), which is the
 * id a write already answers its caller with. A heartbeat is a listener's
 * own notification, sent to learn that its connection still hears the
 * channel; it carries only the beating listener's nonce.
 */
import { Schema } from "effect";

/** The channel every synced table notifies and every listener listens on. */
export const SYNC_CHANNEL = "luke_sync";

/**
 * Postgres refuses a payload of 8000 bytes or more (`NOTIFY`'s default
 * limit), so a write's topics are split across as many notifications as
 * keep each under it.
 */
export const SYNC_PAYLOAD_BYTES = 8000;

/** The kinds of thing a view follows, each named by its own id. */
export const TOPIC = {
  /** A user's account, by user id. */
  ACCOUNT: "account",
  /** A workspace, by organization id. */
  WORKSPACE: "workspace",
  TASK: "task",
  AGENT: "agent",
  CONVERSATION: "conversation",
} as const;

export type TopicKind = (typeof TOPIC)[keyof typeof TOPIC];

const TopicKindSchema = Schema.Literals(Object.values(TOPIC));

/** One topic: its kind, then its id as text. */
const SyncTopicSchema = Schema.Tuple([TopicKindSchema, Schema.String]);

export type SyncTopic = typeof SyncTopicSchema.Type;

/** A committed write's topics, `t`, and its transaction's id, `x`. */
const SyncChangeSchema = Schema.Struct({
  t: Schema.Array(SyncTopicSchema),
  x: Schema.String,
});

export type SyncChange = typeof SyncChangeSchema.Type;

/** A listener's heartbeat: the nonce, `h`, it listens for to know it still hears the channel. */
const SyncHeartbeatSchema = Schema.Struct({ h: Schema.String });

export type SyncHeartbeat = typeof SyncHeartbeatSchema.Type;

/** Whatever arrives on the channel, as its payload's JSON text. */
export const SyncNotificationSchema = Schema.fromJsonString(
  Schema.Union([SyncChangeSchema, SyncHeartbeatSchema]),
);

export type SyncNotification = typeof SyncNotificationSchema.Type;
