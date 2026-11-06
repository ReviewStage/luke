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

const memberWorkspace = Effect.fn("web/slackBotWorkspace")(function* (
  userId: string,
  workspaceId: string,
): Effect.fn.Return<Workspace, HostedRefusal, DatabaseServices> {
  const workspace = yield* hostedStoreOrUnavailable(workspaceOf(userId, workspaceId));
  if (Option.isNone(workspace)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return workspace.value;
});

const administeredWorkspace = Effect.fn("web/slackBotAdministered")(function* (
  userId: string,
  workspaceId: string,
) {
  const workspace = yield* memberWorkspace(userId, workspaceId);
  if (!managesWorkspace(workspace)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  return workspace;
});

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

function withTxid(slackBot: WorkspaceSlackBot, txid: Option.Option<string>): WorkspaceSlackBot {
  return Option.match(txid, {
    onNone: () => slackBot,
    onSome: (id) => ({ ...slackBot, txid: id }),
  });
}

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

export function slackBotProcedures(seams: SlackBotProcedureSeams) {
  const resource = hosted.workspaceSlackBot.use(accountMiddleware(seams.resolveUserId));
  return {
    read: resource.read.effect(function* ({ input, context }) {
      const workspace = yield* memberWorkspace(context.userId, input.workspaceId);
      return yield* workspaceSlackBot(workspace, context.userId);
    }),
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
    disconnect: resource.disconnect.effect(function* ({ input, context }) {
      const workspace = yield* administeredWorkspace(context.userId, input.workspaceId);
      const txid = yield* hostedStoreOrUnavailable(deleteSlackInstallation(workspace.id));
      return withTxid(yield* workspaceSlackBot(workspace, context.userId), txid);
    }),
    notifications: resource.notifications.effect(function* ({ input, context }) {
      const workspace = yield* memberWorkspace(context.userId, input.workspaceId);
      const txid = yield* hostedStoreOrUnavailable(
        writeSlackNotifications(context.userId, input.notifications),
      );
      return { ...(yield* workspaceSlackBot(workspace, context.userId)), txid };
    }),
    repository: resource.repository.effect(function* ({ input, context }) {
      const { workspace } = yield* connectedWorkspace(context.userId, input.workspaceId);
      const repository = yield* reachedRepository(workspace.id, context.userId, input.repository);
      const txid = yield* hostedStoreOrUnavailable(
        writeSlackDefaultRepository(workspace.id, repository),
      );
      return withTxid(yield* workspaceSlackBot(workspace, context.userId), txid);
    }),
    channel: resource.channel.effect(function* ({ input, context }) {
      const { workspace, bot } = yield* connectedWorkspace(context.userId, input.workspaceId);
      const { channelId } = input;
      if (input.member === false) {
        if (!(yield* bot.leave(channelId))) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
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
