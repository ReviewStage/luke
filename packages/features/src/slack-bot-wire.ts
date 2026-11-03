import { Schema as EffectSchema } from "effect";
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
 * holds in every workspace. No answer carries a Slack token.
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

/**
 * A workspace's Slack bot as it stands: whether this deployment holds the
 * bot, without which nothing is offered, the team it is connected to,
 * absent while it is not, and whether the bot writes the reader the threads
 * that wait on them, which is on until they turn it off; absent from a
 * service before the switch.
 */
export const workspaceSlackBotAnswerSchema = EffectSchema.Struct({
  configured: EffectSchema.Boolean,
  team: EffectSchema.optionalKey(slackTeamSchema),
  notifications: EffectSchema.optionalKey(EffectSchema.Boolean),
});

export type WorkspaceSlackBot = typeof workspaceSlackBotAnswerSchema.Type;
