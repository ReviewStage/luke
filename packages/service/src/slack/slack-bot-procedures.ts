/**
 * slack-bot-procedures.ts -- a workspace's own Slack bot read, connected, and disconnected, and the repositories and channels its Slack starts use.
 *
 * Six procedures the signed-in desktop calls with its bearer:
 *
 * - `GET /api/workspaces/slack-bot` takes any member, and answers whether
 *   this deployment holds the bot and the Slack team the workspace's bot is
 *   connected to.
 * - `POST /api/workspaces/slack-bot/connect` takes an owner or admin, asks
 *   Slack which team the bot's token answers for (`auth.test`), and keeps
 *   it as the workspace's installation.
 * - `POST /api/workspaces/slack-bot/disconnect` takes an owner or admin,
 *   and deletes the installation, every member's Slack id with it; the
 *   bot stays installed in Slack, where only Slack's admins remove it.
 * - `POST /api/workspaces/slack-bot/notifications` takes any member, and
 *   turns their own Slack notifications on or off, in every workspace.
 * - `POST /api/workspaces/slack-bot/repository` takes an owner or admin, and
 *   names the repository Slack starts default to, one the workspace reaches
 *   as GitHub spells it, or clears it.
 * - `POST /api/workspaces/slack-bot/channel` takes an owner or admin, and
 *   puts the bot in a public channel or takes it out of one, forgetting the
 *   channel's repository as it leaves, and names or clears the channel's
 *   default repository.
 *
 * The read answers an owner or admin the team's channels as Slack lists
 * them, each with its default repository; a member is answered none. A
 * connect, a disconnect, and a repository named or forgotten answer the
 * transaction their row was written in beside the bot, which a desktop
 * holding the workspace's integrations live waits for
 * (`workspaceIntegrationsLive`); a write that wrote no row answers none.
 *
 * A workspace the account is not in is not found, whatever it asked. The
 * bearer is resolved before the body is read, by the middleware on the
 * resource.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import {
  deleteSlackInstallation,
  linkSlackInstallation,
  type SlackChannelRepository,
  slackNotificationsOn,
  slackStartRepositories,
  workspaceSlackInstallation,
  writeSlackChannelRepository,
  writeSlackDefaultRepository,
  writeSlackNotifications,
} from "@repo/database/models/slack-installation-store";
import { type Workspace, workspaceOf } from "@repo/database/models/workspace-store";
import type { SlackBotChannel, WorkspaceSlackBot } from "@repo/features/slack-bot-wire";
import { managesWorkspace } from "@repo/features/workspace-role";
import { Effect, Option } from "effect";
import type { HttpClient } from "effect/http";
import type { GitHubApp } from "../github/github-app.js";
import { workspaceRepository } from "../github/workspace-repository.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import { SlackBot, type SlackBotService } from "./slack-bot.js";

export interface SlackBotProcedureSeams {
  resolveUserId: UserIdResolver;
}

/** The workspace named, as the account sees it; one it is not in is not found. */
const memberWorkspace = Effect.fn("web/slackBotWorkspace")(function* (
  userId: string,
  workspaceId: string,
): Effect.fn.Return<Workspace, HostedRefusal, DatabaseServices> {
  const workspace = yield* hostedStoreOrUnavailable(workspaceOf(userId, workspaceId));
  if (Option.isNone(workspace)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return workspace.value;
});

/** The workspace named, where the account is an owner or admin of it. */
const administeredWorkspace = Effect.fn("web/slackBotAdministered")(function* (
  userId: string,
  workspaceId: string,
) {
  const workspace = yield* memberWorkspace(userId, workspaceId);
  if (!managesWorkspace(workspace)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  return workspace;
});

/** The team's channels as Settings lists them, each with its default repository; none where Slack could not be read. */
const listedChannels = Effect.fn("web/slackBotChannels")(function* (
  bot: SlackBotService,
  channels: readonly SlackChannelRepository[],
) {
  const listed = yield* bot.channels;
  if (Option.isNone(listed)) return undefined;
  const named = new Map(channels.map((channel) => [channel.channelId, channel.repository]));
  return listed.value.map((channel): SlackBotChannel => {
    const repository = named.get(channel.id);
    return repository === undefined ? channel : { ...channel, repository };
  });
});

/**
 * The workspace's Slack bot as the wire carries it to the member: the team,
 * their own switch, and the default repository where it is connected, and,
 * to an owner or admin, the team's channels.
 */
const workspaceSlackBot = Effect.fn("web/workspaceSlackBot")(function* (
  workspace: Workspace,
  userId: string,
): Effect.fn.Return<WorkspaceSlackBot, HostedRefusal, DatabaseServices | SlackBot> {
  const bot = yield* SlackBot;
  const { configured } = bot;
  const installation = yield* hostedStoreOrUnavailable(workspaceSlackInstallation(workspace.id));
  if (Option.isNone(installation)) return { configured };
  const { teamId, teamName } = installation.value;
  const notifications = yield* hostedStoreOrUnavailable(slackNotificationsOn(userId));
  const { defaultRepository, channels } = yield* hostedStoreOrUnavailable(
    slackStartRepositories(workspace.id),
  );
  const listed = managesWorkspace(workspace) ? yield* listedChannels(bot, channels) : undefined;
  return {
    configured,
    team: { id: teamId, name: teamName },
    notifications,
    ...(defaultRepository === null ? undefined : { defaultRepository }),
    ...(listed === undefined ? undefined : { channels: listed }),
  };
});

/** The bot as it then stands, with the transaction a write committed its row in, where it wrote one. */
function withTxid(slackBot: WorkspaceSlackBot, txid: Option.Option<string>): WorkspaceSlackBot {
  return Option.match(txid, {
    onNone: () => slackBot,
    onSome: (id) => ({ ...slackBot, txid: id }),
  });
}

/** The repository named, as GitHub spells it, where the workspace reaches it; null clears. */
const reachedRepository = Effect.fn("web/slackBotRepository")(function* (
  workspaceId: string,
  userId: string,
  repository: string | null,
): Effect.fn.Return<
  string | null,
  HostedRefusal,
  DatabaseServices | GitHubApp | HttpClient.HttpClient
> {
  if (repository === null) return null;
  const reached = yield* workspaceRepository(workspaceId, repository, userId);
  return reached.repository.fullName;
});

/** The workspace named, where an owner or admin of it asks and its bot is connected; the bot as the deployment holds it. */
const connectedWorkspace = Effect.fn("web/slackBotConnected")(function* (
  userId: string,
  workspaceId: string,
) {
  const workspace = yield* administeredWorkspace(userId, workspaceId);
  const installation = yield* hostedStoreOrUnavailable(workspaceSlackInstallation(workspace.id));
  if (Option.isNone(installation)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const bot = yield* SlackBot;
  if (!bot.configured) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  return { workspace, bot };
});

/** The workspace Slack bot resource: connect and disconnect to an owner or admin, and the read and the member's own switch to any member. */
export function slackBotProcedures(seams: SlackBotProcedureSeams) {
  const resource = hosted.workspaceSlackBot.use(accountMiddleware(seams.resolveUserId));
  return {
    /** The workspace's Slack bot, to any member of it. */
    read: resource.read.effect(function* ({ input, context }) {
      const workspace = yield* memberWorkspace(context.userId, input.workspaceId);
      return yield* workspaceSlackBot(workspace, context.userId);
    }),
    /** The bot connected to the team its token answers for; unavailable where the deployment holds no bot or Slack did not answer. */
    connect: resource.connect.effect(function* ({ input, context }) {
      const workspace = yield* administeredWorkspace(context.userId, input.workspaceId);
      const bot = yield* SlackBot;
      if (!bot.configured) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      const team = yield* bot.team.pipe(
        Effect.tapError((failure) =>
          Effect.logWarning("The Slack bot could not read its team", failure.message),
        ),
        Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE),
      );
      const txid = yield* hostedStoreOrUnavailable(
        linkSlackInstallation({
          organizationId: workspace.id,
          teamId: team.id,
          teamName: team.name,
          userId: context.userId,
        }),
      );
      return withTxid(yield* workspaceSlackBot(workspace, context.userId), Option.some(txid));
    }),
    /** The bot disconnected from the workspace; disconnecting one already gone answers it as it stands. */
    disconnect: resource.disconnect.effect(function* ({ input, context }) {
      const workspace = yield* administeredWorkspace(context.userId, input.workspaceId);
      const txid = yield* hostedStoreOrUnavailable(deleteSlackInstallation(workspace.id));
      return withTxid(yield* workspaceSlackBot(workspace, context.userId), txid);
    }),
    /** The member's own Slack notifications turned on or off, which holds in every workspace. */
    notifications: resource.notifications.effect(function* ({ input, context }) {
      const workspace = yield* memberWorkspace(context.userId, input.workspaceId);
      yield* hostedStoreOrUnavailable(writeSlackNotifications(context.userId, input.notifications));
      return yield* workspaceSlackBot(workspace, context.userId);
    }),
    /** The workspace's default repository for Slack starts named, as GitHub spells it, or cleared. */
    repository: resource.repository.effect(function* ({ input, context }) {
      const { workspace } = yield* connectedWorkspace(context.userId, input.workspaceId);
      const repository = yield* reachedRepository(workspace.id, context.userId, input.repository);
      const txid = yield* hostedStoreOrUnavailable(
        writeSlackDefaultRepository(workspace.id, repository),
      );
      return withTxid(yield* workspaceSlackBot(workspace, context.userId), txid);
    }),
    /** The bot put in a public channel or taken out of one, and the channel's default repository named or cleared; unavailable where Slack refused. */
    channel: resource.channel.effect(function* ({ input, context }) {
      const { workspace, bot } = yield* connectedWorkspace(context.userId, input.workspaceId);
      const { channelId } = input;
      if (input.member === false) {
        if (!(yield* bot.leave(channelId))) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
        // A channel the bot left keeps no repository, so a later join starts from the workspace's.
        const txid = yield* hostedStoreOrUnavailable(
          writeSlackChannelRepository(workspace.id, channelId, null),
        );
        return withTxid(yield* workspaceSlackBot(workspace, context.userId), txid);
      }
      if (input.member === true && !(yield* bot.join(channelId))) {
        return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      }
      let txid = Option.none<string>();
      if (input.repository !== undefined) {
        const repository = yield* reachedRepository(workspace.id, context.userId, input.repository);
        txid = yield* hostedStoreOrUnavailable(
          writeSlackChannelRepository(workspace.id, channelId, repository),
        );
      }
      return withTxid(yield* workspaceSlackBot(workspace, context.userId), txid);
    }),
  };
}
