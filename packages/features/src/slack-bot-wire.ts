import { Schema as EffectSchema } from "effect";
import { githubRepositoryFullNameSchema } from "./github-repositories-wire.js";
import { workspaceIdSchema } from "./task-wire.js";

export const WORKSPACE_SLACK_BOT_QUERY = { WORKSPACE_ID: "workspaceId" } as const;

export const workspaceSlackBotRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
});

const slackTeamSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  name: EffectSchema.String,
});

export const workspaceSlackBotNotificationsRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  notifications: EffectSchema.Boolean,
});

const slackChannelIdSchema = EffectSchema.String.check(
  EffectSchema.isMinLength(1),
  EffectSchema.isMaxLength(32),
);

export const workspaceSlackBotRepositoryRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  repository: EffectSchema.NullOr(githubRepositoryFullNameSchema),
});

export const workspaceSlackBotChannelRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  channelId: slackChannelIdSchema,
  member: EffectSchema.optionalKey(EffectSchema.Boolean),
  repository: EffectSchema.optionalKey(EffectSchema.NullOr(githubRepositoryFullNameSchema)),
});

export const slackBotChannelSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  name: EffectSchema.String,
  private: EffectSchema.Boolean,
  member: EffectSchema.Boolean,
  repository: EffectSchema.optionalKey(EffectSchema.String),
});

export type SlackBotChannel = typeof slackBotChannelSchema.Type;

export type SlackListedChannel = Omit<SlackBotChannel, "repository">;

export const workspaceSlackBotAnswerSchema = EffectSchema.Struct({
  configured: EffectSchema.Boolean,
  team: EffectSchema.optionalKey(slackTeamSchema),
  notifications: EffectSchema.optionalKey(EffectSchema.Boolean),
  defaultRepository: EffectSchema.optionalKey(EffectSchema.String),
  channels: EffectSchema.optionalKey(EffectSchema.Array(slackBotChannelSchema)),
  txid: EffectSchema.optionalKey(EffectSchema.String),
});

export type WorkspaceSlackBot = typeof workspaceSlackBotAnswerSchema.Type;
