/**
 * status-words.ts -- the words and tones the admin pages say a status in, read from the app's own maps so a state reads the same on every screen.
 *
 * A pull request is the app's: its word from `PULL_REQUEST_STATE_LABEL` and
 * its tone from `PULL_REQUEST_TONE`, so open is green and closed is red as
 * they are in the sidebar. A GitHub App installation and an integration
 * connection are said once here, for the account page, the workspaces table,
 * and Reliability's problems alike: an expired sign-in needs attention, and an
 * uninstalled App is a danger.
 */

import type { AdminPullRequest } from "@luke/features/admin-account-wire";
import { PULL_REQUEST_STATE, type PullRequestState } from "@luke/features/coding-agent-wire";
import {
  GITHUB_INSTALLATION_STATUS,
  type GitHubInstallationStatus,
} from "@luke/features/github-installation-wire";
import {
  INTEGRATION_ROW_STATUS,
  type IntegrationRowStatus,
} from "@luke/features/integration-row-wire";
import { INTEGRATION_STATUS_WORDS } from "@luke/features/integration-status-words";
import { STATUS_TONE, type StatusTone } from "@luke/ui";
import { PULL_REQUEST_STATE_LABEL } from "../tasks/coding-agent-model.js";
import { PULL_REQUEST_TONE } from "../tasks/pull-request-mark.js";

/** The state each pull request the admin pages draw stands in; a draft is one of the open. */
const ADMIN_PULL_REQUEST_STATE = {
  open: PULL_REQUEST_STATE.OPEN,
  merged: PULL_REQUEST_STATE.MERGED,
  closed: PULL_REQUEST_STATE.CLOSED,
} as const satisfies Record<Exclude<AdminPullRequest, "none">, PullRequestState>;

/** What a pull request is called on a badge: the app's word for where it stands. */
export function pullRequestWord(state: Exclude<AdminPullRequest, "none">): string {
  return PULL_REQUEST_STATE_LABEL[ADMIN_PULL_REQUEST_STATE[state]];
}

/** The tone a pull request's badge wears: the app's tone for where it stands. */
export function pullRequestTone(state: Exclude<AdminPullRequest, "none">): StatusTone {
  return PULL_REQUEST_TONE[ADMIN_PULL_REQUEST_STATE[state]];
}

/** The tone each installation status is drawn in: working, held, or gone. */
export const INSTALLATION_TONE = {
  [GITHUB_INSTALLATION_STATUS.ACTIVE]: STATUS_TONE.COMPLETE,
  [GITHUB_INSTALLATION_STATUS.SUSPENDED]: STATUS_TONE.ATTENTION,
  [GITHUB_INSTALLATION_STATUS.DELETED]: STATUS_TONE.DANGER,
} as const satisfies Record<GitHubInstallationStatus, StatusTone>;

/** What each installation status is called. */
export const INSTALLATION_LABEL = {
  [GITHUB_INSTALLATION_STATUS.ACTIVE]: "Active",
  [GITHUB_INSTALLATION_STATUS.SUSPENDED]: "Suspended",
  [GITHUB_INSTALLATION_STATUS.DELETED]: "Uninstalled",
} as const satisfies Record<GitHubInstallationStatus, string>;

/** The tone each connection status is drawn in; an expired sign-in needs a person. */
const CONNECTION_TONE = {
  [INTEGRATION_ROW_STATUS.PENDING]: STATUS_TONE.WORKING,
  [INTEGRATION_ROW_STATUS.CONNECTED]: STATUS_TONE.COMPLETE,
  [INTEGRATION_ROW_STATUS.EXPIRED]: STATUS_TONE.ATTENTION,
} as const satisfies Record<IntegrationRowStatus, StatusTone>;

/** Whether a connection status is one this build knows, which the account page's answer, a bare string, may not be. */
function isConnectionStatus(status: string): status is IntegrationRowStatus {
  return Object.hasOwn(CONNECTION_TONE, status);
}

/** The tone a connection's badge wears; a status this build does not know reads as needing attention. */
export function connectionTone(status: string): StatusTone {
  return isConnectionStatus(status) ? CONNECTION_TONE[status] : STATUS_TONE.ATTENTION;
}

/** What a connection is called on a badge; a status this build does not know is drawn as the service spelled it. */
export function connectionWord(status: string): string {
  return isConnectionStatus(status) ? INTEGRATION_STATUS_WORDS[status] : status;
}
