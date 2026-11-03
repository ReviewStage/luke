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
 * the same. No answer carries a Slack token.
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

/**
 * A workspace's Slack bot as it stands: whether this deployment holds the
 * bot, without which nothing is offered, and the team it is connected to,
 * absent while it is not.
 */
export const workspaceSlackBotAnswerSchema = EffectSchema.Struct({
  configured: EffectSchema.Boolean,
  team: EffectSchema.optionalKey(slackTeamSchema),
});

export type WorkspaceSlackBot = typeof workspaceSlackBotAnswerSchema.Type;
