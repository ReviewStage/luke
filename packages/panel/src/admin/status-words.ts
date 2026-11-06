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

const ADMIN_PULL_REQUEST_STATE = {
  open: PULL_REQUEST_STATE.OPEN,
  merged: PULL_REQUEST_STATE.MERGED,
  closed: PULL_REQUEST_STATE.CLOSED,
} as const satisfies Record<Exclude<AdminPullRequest, "none">, PullRequestState>;

export function pullRequestWord(state: Exclude<AdminPullRequest, "none">): string {
  return PULL_REQUEST_STATE_LABEL[ADMIN_PULL_REQUEST_STATE[state]];
}

export function installationMark(status: GitHubInstallationStatus): QuietMark | undefined {
  return status === GITHUB_INSTALLATION_STATUS.DELETED ? QUIET_MARK.FAILED : undefined;
}

export const INSTALLATION_LABEL = {
  [GITHUB_INSTALLATION_STATUS.ACTIVE]: "Active",
  [GITHUB_INSTALLATION_STATUS.SUSPENDED]: "Suspended",
  [GITHUB_INSTALLATION_STATUS.DELETED]: "Uninstalled",
} as const satisfies Record<GitHubInstallationStatus, string>;

function isConnectionStatus(status: string): status is IntegrationRowStatus {
  return Object.hasOwn(INTEGRATION_STATUS_WORDS, status);
}

export function connectionWord(status: string): string {
  return isConnectionStatus(status) ? INTEGRATION_STATUS_WORDS[status] : status;
}
