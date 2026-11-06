export const GITHUB_INSTALL_LANDING = {
  PATH: "/github-installed",
  STATUS_PARAM: "status",
} as const;

export const GITHUB_INSTALL_STATUS = {
  INSTALLED: "installed",
  UPDATED: "updated",
  REQUESTED: "requested",
  NOT_FOUND: "not-found",
  UNAVAILABLE: "unavailable",
  CONNECTED: "connected",
  ALREADY_CONNECTED: "already-connected",
  EXPIRED: "expired",
} as const;

export type GitHubInstallStatus =
  (typeof GITHUB_INSTALL_STATUS)[keyof typeof GITHUB_INSTALL_STATUS];

const STATUSES: ReadonlySet<string> = new Set(Object.values(GITHUB_INSTALL_STATUS));

export function githubInstallStatusFromWire(value: string | null): GitHubInstallStatus | undefined {
  return value !== null && STATUSES.has(value) ? (value as GitHubInstallStatus) : undefined;
}

export function githubInstallLandingPath(status: GitHubInstallStatus): string {
  return `${GITHUB_INSTALL_LANDING.PATH}?${GITHUB_INSTALL_LANDING.STATUS_PARAM}=${status}`;
}
