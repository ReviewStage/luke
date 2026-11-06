import { Schema as EffectSchema } from "effect";
import { sealedLiveQuerySchema } from "./live-wire.js";
import type { WorkspaceSentry } from "./sentry-install-wire.js";
import { countedNumber } from "./service-wire.js";
import type { WorkspaceSlackBot } from "./slack-bot-wire.js";

export const workspaceIntegrationsLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({
    sentryInstallations: sealedLiveQuerySchema,
    slackInstallation: sealedLiveQuerySchema,
    slackChannelRepositories: sealedLiveQuerySchema,
  }),
  sentryConfigured: EffectSchema.Boolean,
  slackConfigured: EffectSchema.Boolean,
});

export type WorkspaceIntegrationsLiveAnswer = typeof workspaceIntegrationsLiveAnswerSchema.Type;

const sentryInstallationLiveRowSchema = EffectSchema.Struct({
  installationId: EffectSchema.String,
  account: EffectSchema.NullOr(EffectSchema.String),
  createdAt: countedNumber,
});

export type SentryInstallationLiveRow = typeof sentryInstallationLiveRowSchema.Type;

const slackInstallationLiveRowSchema = EffectSchema.Struct({
  workspaceId: EffectSchema.String,
  teamId: EffectSchema.String,
  teamName: EffectSchema.String,
  defaultRepository: EffectSchema.NullOr(EffectSchema.String),
});

export type SlackInstallationLiveRow = typeof slackInstallationLiveRowSchema.Type;

const slackChannelRepositoryLiveRowSchema = EffectSchema.Struct({
  channelId: EffectSchema.String,
  repository: EffectSchema.String,
});

type SlackChannelRepositoryLiveRow = typeof slackChannelRepositoryLiveRowSchema.Type;

export const workspaceIntegrationsLiveRowsSchema = EffectSchema.Struct({
  sentryInstallations: EffectSchema.Array(sentryInstallationLiveRowSchema),
  slackInstallation: EffectSchema.Array(slackInstallationLiveRowSchema),
  slackChannelRepositories: EffectSchema.Array(slackChannelRepositoryLiveRowSchema),
});

export type WorkspaceIntegrationsLiveRows = typeof workspaceIntegrationsLiveRowsSchema.Type;

export interface WorkspaceSlack {
  readonly configured: boolean;
  readonly team?: NonNullable<WorkspaceSlackBot["team"]>;
  readonly defaultRepository?: string;
  readonly channelRepositories: Readonly<Record<string, string>>;
}

export interface WorkspaceIntegrations {
  readonly sentry: WorkspaceSentry;
  readonly slack: WorkspaceSlack;
}

export interface IntegrationsConfigured {
  readonly sentryConfigured: boolean;
  readonly slackConfigured: boolean;
}

function firstLinked(a: SentryInstallationLiveRow, b: SentryInstallationLiveRow): number {
  return a.createdAt - b.createdAt || (a.installationId < b.installationId ? -1 : 1);
}

function sentryOfLiveRows(
  configured: boolean,
  rows: readonly SentryInstallationLiveRow[],
): WorkspaceSentry {
  return {
    configured,
    installations: rows
      .toSorted(firstLinked)
      .map((row) =>
        row.account === null
          ? { installationId: row.installationId }
          : { installationId: row.installationId, account: row.account },
      ),
  };
}

function slackOfLiveRows(
  configured: boolean,
  installation: SlackInstallationLiveRow | undefined,
  channels: readonly SlackChannelRepositoryLiveRow[],
): WorkspaceSlack {
  if (installation === undefined) return { configured, channelRepositories: {} };
  return {
    configured,
    team: { id: installation.teamId, name: installation.teamName },
    ...(installation.defaultRepository === null
      ? undefined
      : { defaultRepository: installation.defaultRepository }),
    channelRepositories: Object.fromEntries(
      channels.map((channel) => [channel.channelId, channel.repository]),
    ),
  };
}

export function workspaceIntegrationsOfLive(
  configured: IntegrationsConfigured,
  rows: WorkspaceIntegrationsLiveRows,
): WorkspaceIntegrations {
  return {
    sentry: sentryOfLiveRows(configured.sentryConfigured, rows.sentryInstallations),
    slack: slackOfLiveRows(
      configured.slackConfigured,
      rows.slackInstallation[0],
      rows.slackChannelRepositories,
    ),
  };
}
