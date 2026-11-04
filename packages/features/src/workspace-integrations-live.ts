import { Schema as EffectSchema } from "effect";
import { sealedLiveQuerySchema } from "./live-wire.js";
import type { WorkspaceSentry } from "./sentry-install-wire.js";
import { countedNumber } from "./service-wire.js";
import type { WorkspaceSlackBot } from "./slack-bot-wire.js";

/**
 * workspace-integrations-live.ts -- one workspace's own integrations as the host follows them over the service's held poll: the statements the service answers, the rows they deliver, and the workspace's Sentry and Slack bot as Settings and an automation's editor draw them.
 *
 * The service answers three statements while the reader is a member of the
 * workspace: its active Sentry installations, its Slack bot's installation,
 * and each Slack channel's default repository. Whether this deployment holds
 * our Sentry integration and our Slack bot is its configuration rather than
 * a row, so it rides beside the statements on every answer. The rows come in
 * no order, so the reader orders the installations as the Sentry read
 * answers them: the first linked first.
 *
 * What the reader holds is the bot's rows alone. Its channels are Slack's
 * own list, which the host fetches beside it for an owner or an admin
 * (`LIVE_READ.SLACK_CHANNELS`), and the reader's own notifications switch is
 * their account's preference, which no row of the workspace carries.
 */

/** One workspace's integrations sealed for following: the address, three statements, and whether this deployment holds each integration. The service answers `not-found` for a workspace the account is no member of. */
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

/** One active Sentry installation as its statement delivers it: Sentry's id for it, its organization's slug where one was read, and when it was linked. */
const sentryInstallationLiveRowSchema = EffectSchema.Struct({
  installationId: EffectSchema.String,
  account: EffectSchema.NullOr(EffectSchema.String),
  createdAt: countedNumber,
});

export type SentryInstallationLiveRow = typeof sentryInstallationLiveRowSchema.Type;

/** The workspace's Slack bot as its statement delivers it: the workspace it stands in, the team it is connected to, and the default repository for Slack starts, null for none. */
const slackInstallationLiveRowSchema = EffectSchema.Struct({
  workspaceId: EffectSchema.String,
  teamId: EffectSchema.String,
  teamName: EffectSchema.String,
  defaultRepository: EffectSchema.NullOr(EffectSchema.String),
});

export type SlackInstallationLiveRow = typeof slackInstallationLiveRowSchema.Type;

/** One Slack channel's default repository as its statement delivers it, by Slack's id for the channel. */
const slackChannelRepositoryLiveRowSchema = EffectSchema.Struct({
  channelId: EffectSchema.String,
  repository: EffectSchema.String,
});

type SlackChannelRepositoryLiveRow = typeof slackChannelRepositoryLiveRowSchema.Type;

/** A workspace's integrations as Realtime delivers them, decoded at the boundary before anything reads them. */
export const workspaceIntegrationsLiveRowsSchema = EffectSchema.Struct({
  sentryInstallations: EffectSchema.Array(sentryInstallationLiveRowSchema),
  slackInstallation: EffectSchema.Array(slackInstallationLiveRowSchema),
  slackChannelRepositories: EffectSchema.Array(slackChannelRepositoryLiveRowSchema),
});

export type WorkspaceIntegrationsLiveRows = typeof workspaceIntegrationsLiveRowsSchema.Type;

/**
 * A workspace's Slack bot as the held read answers it: whether this
 * deployment holds the bot, the team it is connected to, absent while it is
 * not, and where it is, the default repository for Slack starts, absent
 * while none is named, and each channel's, by Slack's id for the channel.
 */
export interface WorkspaceSlack {
  readonly configured: boolean;
  readonly team?: NonNullable<WorkspaceSlackBot["team"]>;
  readonly defaultRepository?: string;
  readonly channelRepositories: Readonly<Record<string, string>>;
}

/** One workspace's own integrations as the held read answers them: its Sentry and its Slack bot. */
export interface WorkspaceIntegrations {
  readonly sentry: WorkspaceSentry;
  readonly slack: WorkspaceSlack;
}

/** Whether this deployment holds each integration, as every answer carries it beside the statements. */
export interface IntegrationsConfigured {
  readonly sentryConfigured: boolean;
  readonly slackConfigured: boolean;
}

/** The first linked first, then by Sentry's id, so two linked alike keep one order. */
function firstLinked(a: SentryInstallationLiveRow, b: SentryInstallationLiveRow): number {
  return a.createdAt - b.createdAt || (a.installationId < b.installationId ? -1 : 1);
}

/** The workspace's Sentry as the read answers it: its active installations, the first linked first. */
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

/** The workspace's Slack bot as the read answers it: connected where its installation's row stands, with each channel's repository. */
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

/** A workspace's integrations as the held read answers them, from its rows and what its answers carry beside them. */
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
