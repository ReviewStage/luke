/**
 * workspace-integrations.ts -- a workspace's own integrations' live read bound: its three statements, the tables they read, the topics that wake it, who it admits, and whether this deployment holds each integration beside them.
 *
 * Its active Sentry installations, Sentry's id for each and its
 * organization's slug, null where none was read; its Slack bot, the team it
 * is connected to and the default repository for Slack starts, no row while
 * it is not connected; and each Slack channel's default repository. Each
 * reads nothing once the reader is no member of the workspace, so a
 * subscription stays bound to the rule its endpoint checked
 * (`WORKSPACE_INTEGRATIONS_READ`). Whether this deployment holds each
 * integration is its configuration, which no statement reads, so it is
 * answered beside them.
 *
 * It is woken on the workspace's integrations topic by an install finished
 * in the browser, a disconnect, Sentry's own uninstall, and a repository
 * named, and on the reader's own by their membership made or ended, which
 * decides whether they read it at all.
 */

import { queryBuilder } from "@repo/database/core/query";
import { INTEGRATION_INSTALLATION_STATUS } from "@repo/database/integration-vocabulary";
import { workspaceReachableBy } from "@repo/database/models/workspace-store";
import { integrationInstallation } from "@repo/database/schemas/integration-installation";
import {
  slackChannelRepository,
  slackInstallation,
} from "@repo/database/schemas/slack-installation";
import { TOPIC } from "@repo/database/sync/notification";
import {
  integrationInstallationSync,
  memberSync,
  slackChannelRepositorySync,
  slackInstallationSync,
} from "@repo/database/sync/tables";
import { TRIGGER_PROVIDER } from "@repo/features/trigger-catalog";
import { WORKSPACE_INTEGRATIONS_READ } from "@repo/features/workspace-integrations-live";
import { and, eq } from "drizzle-orm";
import { Effect, Result } from "effect";
import { SlackBot } from "../../slack/slack-bot.js";
import { SentryApp } from "../../triggers/sentry/sentry-app-config.js";
import { bindLiveRead, liveRowsStatement } from "../live-read-binding.js";
import { admitWorkspaceMember } from "./workspace-member.js";

export const workspaceIntegrationsRead = bindLiveRead(WORKSPACE_INTEGRATIONS_READ, {
  reads: [
    integrationInstallationSync,
    slackInstallationSync,
    slackChannelRepositorySync,
    memberSync,
  ],
  topics: ({ userId, workspaceId }) => [
    [TOPIC.WORKSPACE_INTEGRATIONS, workspaceId],
    [TOPIC.ACCOUNT, userId],
  ],
  statements: ({ userId, workspaceId }) => {
    const reached = workspaceReachableBy(userId, workspaceId);
    return {
      sentryInstallations: liveRowsStatement(
        WORKSPACE_INTEGRATIONS_READ.parts.sentryInstallations,
        {
          ordered: false,
          columns: {
            installationId: integrationInstallation.externalId,
            account: integrationInstallation.accountLabel,
          },
          instants: { createdAt: integrationInstallation.createdAt },
        },
        (selection) =>
          queryBuilder
            .select(selection)
            .from(integrationInstallation)
            .where(
              and(
                eq(integrationInstallation.organizationId, workspaceId),
                eq(integrationInstallation.provider, TRIGGER_PROVIDER.SENTRY),
                eq(integrationInstallation.status, INTEGRATION_INSTALLATION_STATUS.ACTIVE),
                reached,
              ),
            ),
      ),
      slackInstallation: liveRowsStatement(
        WORKSPACE_INTEGRATIONS_READ.parts.slackInstallation,
        {
          ordered: false,
          columns: {
            workspaceId: slackInstallation.organizationId,
            teamId: slackInstallation.teamId,
            teamName: slackInstallation.teamName,
            defaultRepository: slackInstallation.defaultRepository,
          },
        },
        (selection) =>
          queryBuilder
            .select(selection)
            .from(slackInstallation)
            .where(and(eq(slackInstallation.organizationId, workspaceId), reached)),
      ),
      slackChannelRepositories: liveRowsStatement(
        WORKSPACE_INTEGRATIONS_READ.parts.slackChannelRepositories,
        {
          ordered: false,
          columns: {
            channelId: slackChannelRepository.channelId,
            repository: slackChannelRepository.repository,
          },
        },
        (selection) =>
          queryBuilder
            .select(selection)
            .from(slackChannelRepository)
            .where(and(eq(slackChannelRepository.organizationId, workspaceId), reached)),
      ),
    };
  },
  admit: admitWorkspaceMember,
  beside: () =>
    Effect.gen(function* () {
      const sentry = yield* SentryApp;
      const { configured: slackConfigured } = yield* SlackBot;
      return {
        sentryConfigured: Result.isSuccess(yield* Effect.result(sentry.settings)),
        slackConfigured,
      };
    }),
});
