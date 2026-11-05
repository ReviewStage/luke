/**
 * status-words.ts -- the words the admin pages say a status in, read from the app's own maps so a state reads the same on every screen.
 *
 * A status is drawn as quiet words (`@repo/ui`'s `QuietWords`), after the
 * failure glyph where it is a failure. A pull request is the app's word for
 * where it stands (`PULL_REQUEST_STATE_LABEL`). A GitHub App installation and
 * an integration connection are said once here, for the account page, the
 * workspaces table, and Reliability's problems alike: an uninstalled App is a
 * failure.
 */

import type { AdminPullRequest } from "@repo/features/admin-account-wire";
import { PULL_REQUEST_STATE, type PullRequestState } from "@repo/features/agent-wire";
import {
  GITHUB_INSTALLATION_STATUS,
  type GitHubInstallationStatus,
} from "@repo/features/github-installation-wire";
import type { IntegrationRowStatus } from "@repo/features/integration-row-wire";
import { INTEGRATION_STATUS_WORDS } from "@repo/features/integration-status-words";
import { QUIET_MARK, type QuietMark } from "@repo/ui";
import { PULL_REQUEST_STATE_LABEL } from "../tasks/agent-model.js";

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

/** The mark an installation's words follow: the failure glyph for an uninstalled App, none for the rest. */
export function installationMark(status: GitHubInstallationStatus): QuietMark | undefined {
  return status === GITHUB_INSTALLATION_STATUS.DELETED ? QUIET_MARK.FAILED : undefined;
}

/** What each installation status is called. */
export const INSTALLATION_LABEL = {
  [GITHUB_INSTALLATION_STATUS.ACTIVE]: "Active",
  [GITHUB_INSTALLATION_STATUS.SUSPENDED]: "Suspended",
  [GITHUB_INSTALLATION_STATUS.DELETED]: "Uninstalled",
} as const satisfies Record<GitHubInstallationStatus, string>;

/** Whether a connection status is one this build knows, which the account page's answer, a bare string, may not be. */
function isConnectionStatus(status: string): status is IntegrationRowStatus {
  return Object.hasOwn(INTEGRATION_STATUS_WORDS, status);
}

/** What a connection is called; a status this build does not know is drawn as the service spelled it. */
export function connectionWord(status: string): string {
  return isConnectionStatus(status) ? INTEGRATION_STATUS_WORDS[status] : status;
}
