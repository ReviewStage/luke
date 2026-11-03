/**
 * slack-bot-procedures.ts -- a workspace's own Slack bot read, connected, and disconnected.
 *
 * Three procedures the signed-in desktop calls with its bearer:
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
 *
 * A workspace the account is not in is not found, whatever it asked. The
 * bearer is resolved before the body is read, by the middleware on the
 * resource.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import {
  deleteSlackInstallation,
  linkSlackInstallation,
  workspaceSlackInstallation,
} from "@repo/database/models/slack-installation-store";
import { type Workspace, workspaceOf } from "@repo/database/models/workspace-store";
import type { WorkspaceSlackBot } from "@repo/features/slack-bot-wire";
import { managesWorkspace } from "@repo/features/workspace-role";
import { Effect, Option } from "effect";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import { SlackBot } from "./slack-bot.js";

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

/** The workspace's Slack bot as the wire carries it. */
const workspaceSlackBot = Effect.fn("web/workspaceSlackBot")(function* (
  workspaceId: string,
): Effect.fn.Return<WorkspaceSlackBot, HostedRefusal, DatabaseServices | SlackBot> {
  const { configured } = yield* SlackBot;
  const installation = yield* hostedStoreOrUnavailable(workspaceSlackInstallation(workspaceId));
  return Option.match(installation, {
    onNone: () => ({ configured }),
    onSome: ({ teamId, teamName }) => ({ configured, team: { id: teamId, name: teamName } }),
  });
});

/** The workspace Slack bot resource: connect and disconnect to an owner or admin, and the read to any member. */
export function slackBotProcedures(seams: SlackBotProcedureSeams) {
  const resource = hosted.workspaceSlackBot.use(accountMiddleware(seams.resolveUserId));
  return {
    /** The workspace's Slack bot, to any member of it. */
    read: resource.read.effect(function* ({ input, context }) {
      const workspace = yield* memberWorkspace(context.userId, input.workspaceId);
      return yield* workspaceSlackBot(workspace.id);
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
      yield* hostedStoreOrUnavailable(
        linkSlackInstallation({
          organizationId: workspace.id,
          teamId: team.id,
          teamName: team.name,
          userId: context.userId,
        }),
      );
      return yield* workspaceSlackBot(workspace.id);
    }),
    /** The bot disconnected from the workspace; disconnecting one already gone answers it as it stands. */
    disconnect: resource.disconnect.effect(function* ({ input, context }) {
      const workspace = yield* administeredWorkspace(context.userId, input.workspaceId);
      yield* hostedStoreOrUnavailable(deleteSlackInstallation(workspace.id));
      return yield* workspaceSlackBot(workspace.id);
    }),
  };
}
