import { Schema } from "effect";

export const SYNC_CHANNEL = "app_sync";

export const SYNC_PAYLOAD_BYTES = 8000;

export const TOPIC = {
  ACCOUNT: "account",
  ACCOUNT_INTEGRATIONS: "account-integrations",
  ACCOUNT_SKILLS: "account-skills",
  WORKSPACE: "workspace",
  WORKSPACE_CHAPTERS: "workspace-chapters",
  MEMORY: "memory",
  WORKSPACE_INTEGRATIONS: "workspace-integrations",
  WORKSPACE_SKILLS: "workspace-skills",
  TASK: "task",
  AGENT: "agent",
  CONVERSATION: "conversation",
} as const;

export type TopicKind = (typeof TOPIC)[keyof typeof TOPIC];

const TopicKindSchema = Schema.Literals(Object.values(TOPIC));

const SyncTopicSchema = Schema.Tuple([TopicKindSchema, Schema.String]);

export type SyncTopic = typeof SyncTopicSchema.Type;

const SyncChangeSchema = Schema.Struct({
  t: Schema.Array(SyncTopicSchema),
  x: Schema.String,
});

export type SyncChange = typeof SyncChangeSchema.Type;

const SyncHeartbeatSchema = Schema.Struct({ h: Schema.String });

export type SyncHeartbeat = typeof SyncHeartbeatSchema.Type;

export const SyncNotificationSchema = Schema.fromJsonString(
  Schema.Union([SyncChangeSchema, SyncHeartbeatSchema]),
);

export type SyncNotification = typeof SyncNotificationSchema.Type;
