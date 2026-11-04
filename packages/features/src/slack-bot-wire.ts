import { Schema as EffectSchema } from "effect";
import { githubRepositoryFullNameSchema } from "./github-repositories-wire.js";
import { workspaceIdSchema } from "./task-wire.js";

/**
 * slack-bot-wire.ts -- a workspace's own Slack bot, as the desktop reads, connects, and disconnects it.
 *
 * An owner or admin connects our own Slack bot to a workspace, which
 * keeps the Slack team the bot answers for, so the bot may write to the
 * workspace's members there. `GET /api/workspaces/slack-bot` answers
 * whether the deployment holds the bot at all, and the team it is
 * connected to; `POST /api/workspaces/slack-bot/connect` connects it, and
 * `POST /api/workspaces/slack-bot/disconnect` disconnects it, each answering
 * the same. `POST /api/workspaces/slack-bot/notifications` turns the
 * reader's own Slack notifications on or off, which is theirs alone and
 * holds in every workspace. An owner or admin names the repository an agent
 * started from Slack works in where its message names none, for the
 * workspace (`POST /api/workspaces/slack-bot/repository`) and for each
 * channel, where they also put the bot in a public channel or take it out of
 * one (`POST /api/workspaces/slack-bot/channel`); the read answers them the
 * team's channels. No answer carries a Slack token.
 */

/** The query the read names its workspace by. */
export const WORKSPACE_SLACK_BOT_QUERY = { WORKSPACE_ID: "workspaceId" } as const;

/** The workspace whose Slack bot is read, connected, or disconnected (POST body, or the read's query). */
export const workspaceSlackBotRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
});

/** The Slack team a workspace's bot is connected to: Slack's id for it and its name. */
const slackTeamSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  name: EffectSchema.String,
});

/** The reader's Slack notifications turned on or off, from Settings in the workspace named (POST body). */
export const workspaceSlackBotNotificationsRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  notifications: EffectSchema.Boolean,
});

/** Slack's id for a channel, as the bot's channel list names it. */
const slackChannelIdSchema = EffectSchema.String.check(
  EffectSchema.isMinLength(1),
  EffectSchema.isMaxLength(32),
);

/** The workspace's default repository for Slack starts named by an owner or admin, or cleared with null (POST body). */
export const workspaceSlackBotRepositoryRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  repository: EffectSchema.NullOr(githubRepositoryFullNameSchema),
});

/**
 * One channel changed by an owner or admin (POST body): the bot put in it or
 * taken out of it (`member`, joining a public channel alone), and its
 * default repository named or cleared with null, either or both.
 */
export const workspaceSlackBotChannelRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  channelId: slackChannelIdSchema,
  member: EffectSchema.optionalKey(EffectSchema.Boolean),
  repository: EffectSchema.optionalKey(EffectSchema.NullOr(githubRepositoryFullNameSchema)),
});

/** One channel of the team as Settings lists it: its name, whether it is private, whether the bot is in it, and its default repository where one is named. */
export const slackBotChannelSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  name: EffectSchema.String,
  private: EffectSchema.Boolean,
  member: EffectSchema.Boolean,
  repository: EffectSchema.optionalKey(EffectSchema.String),
});

export type SlackBotChannel = typeof slackBotChannelSchema.Type;

/** One channel of the team as the host holds Slack's list of them for Settings: its repository is the workspace's held read's (`workspace-integrations-live.ts`), so it carries none. */
export type SlackListedChannel = Omit<SlackBotChannel, "repository">;

/**
 * A workspace's Slack bot as it stands: whether this deployment holds the
 * bot, without which nothing is offered, the team it is connected to,
 * absent while it is not, and whether the bot writes the reader the threads
 * that wait on them, which is on until they turn it off; absent from a
 * service before the switch. Where it is connected, the workspace's default
 * repository for Slack starts, absent while none is named, and, to an owner
 * or admin, the team's channels, absent where Slack could not be read. A
 * write that changed the bot's rows carries the transaction it committed
 * in, which a desktop holding the workspace's integrations live waits for;
 * a read, and a write that changed none, carry none.
 */
export const workspaceSlackBotAnswerSchema = EffectSchema.Struct({
  configured: EffectSchema.Boolean,
  team: EffectSchema.optionalKey(slackTeamSchema),
  notifications: EffectSchema.optionalKey(EffectSchema.Boolean),
  defaultRepository: EffectSchema.optionalKey(EffectSchema.String),
  channels: EffectSchema.optionalKey(EffectSchema.Array(slackBotChannelSchema)),
  txid: EffectSchema.optionalKey(EffectSchema.String),
});

export type WorkspaceSlackBot = typeof workspaceSlackBotAnswerSchema.Type;
