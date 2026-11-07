import { Schema } from "effect";
import { refuses } from "./contract/base.js";
import {
  LIVE_MODE,
  LIVE_PARAM,
  type LiveReadAnswer,
  type LiveRowOf,
  liveRead,
  liveRows,
  ORDER,
  orderedLiveRows,
} from "./live-read.js";
import { LIVE_READ, LIVE_USER_QUERY } from "./live-wire.js";
import type { WorkspaceSentry } from "./sentry-install-wire.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";
import { countedNumber, HOSTED_API_ERROR } from "./service-wire.js";
import type { WorkspaceSlackBot } from "./slack-bot-wire.js";

/**
 * workspace-integrations-live.ts -- one workspace's own integrations as the host follows them over the service's held poll: the read declared, and the workspace's Sentry and Slack bot as Settings and an automation's editor draw them.
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

/**
 * One workspace's own integrations as the host follows them: three parts,
 * its active Sentry installations, the first linked first, then by Sentry's
 * id; its Slack bot's installation; and each Slack channel's default
 * repository, by Slack's id for the channel. Whether this deployment holds
 * each integration rides beside them. The service answers `not-found` for
 * a workspace the account is no member of.
 */
export const WORKSPACE_INTEGRATIONS_READ = liveRead({
  name: LIVE_READ.WORKSPACE_INTEGRATIONS,
  path: HOSTED_SERVICE_PATH.LIVE_WORKSPACE_INTEGRATIONS,
  params: { [LIVE_USER_QUERY]: LIVE_PARAM.USER, workspaceId: LIVE_PARAM.TEXT },
  mode: LIVE_MODE.SNAPSHOT,
  parts: {
    /** One active Sentry installation: Sentry's id for it, its organization's slug where one was read, and when it was linked. */
    sentryInstallations: liveRows({
      row: Schema.Struct({
        installationId: Schema.String,
        account: Schema.NullOr(Schema.String),
        createdAt: countedNumber,
      }),
      key: "installationId",
      order: [
        ["createdAt", ORDER.ASC],
        ["installationId", ORDER.ASC],
      ],
    }),
    /** The workspace's Slack bot: the workspace it stands in, the team it is connected to, and the default repository for Slack starts, null for none. */
    slackInstallation: liveRows({
      row: Schema.Struct({
        workspaceId: Schema.String,
        teamId: Schema.String,
        teamName: Schema.String,
        defaultRepository: Schema.NullOr(Schema.String),
      }),
      key: "workspaceId",
      order: [["teamId", ORDER.ASC]],
    }),
    /** One Slack channel's default repository, by Slack's id for the channel. */
    slackChannelRepositories: liveRows({
      row: Schema.Struct({ channelId: Schema.String, repository: Schema.String }),
      key: "channelId",
      order: [["channelId", ORDER.ASC]],
    }),
  },
  beside: { sentryConfigured: Schema.Boolean, slackConfigured: Schema.Boolean },
  refuses: refuses(HOSTED_API_ERROR.NOT_FOUND),
});

export type WorkspaceIntegrationsLiveAnswer = LiveReadAnswer<typeof WORKSPACE_INTEGRATIONS_READ>;

export type SentryInstallationLiveRow = LiveRowOf<
  typeof WORKSPACE_INTEGRATIONS_READ.parts.sentryInstallations
>;

export type SlackInstallationLiveRow = LiveRowOf<
  typeof WORKSPACE_INTEGRATIONS_READ.parts.slackInstallation
>;

type SlackChannelRepositoryLiveRow = LiveRowOf<
  typeof WORKSPACE_INTEGRATIONS_READ.parts.slackChannelRepositories
>;

/** A workspace's integrations as Realtime delivers them. */
export type WorkspaceIntegrationsLiveRows = typeof WORKSPACE_INTEGRATIONS_READ.rows.Type;

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

/** The workspace's Sentry as the read answers it: its active installations, the first linked first. */
function sentryOfLiveRows(
  configured: boolean,
  rows: readonly SentryInstallationLiveRow[],
): WorkspaceSentry {
  return {
    configured,
    installations: orderedLiveRows(WORKSPACE_INTEGRATIONS_READ.parts.sentryInstallations, rows).map(
      (row) =>
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
