/**
 * github-installation-wire.ts -- the words a GitHub App installation row is spelled in, as the service stores them and the admin pages draw them.
 */

/** The kind of GitHub account an installation of the App is on, as GitHub spells it. */
export const GITHUB_ACCOUNT_TYPE = {
  USER: "User",
  ORGANIZATION: "Organization",
} as const;

export type GitHubAccountType = (typeof GITHUB_ACCOUNT_TYPE)[keyof typeof GITHUB_ACCOUNT_TYPE];

/** Where an installation of the App stands, as its webhook last said; a workspace of any other is listed inactive and offered to nobody. */
export const GITHUB_INSTALLATION_STATUS = {
  ACTIVE: "active",
  SUSPENDED: "suspended",
  DELETED: "deleted",
} as const;

export type GitHubInstallationStatus =
  (typeof GITHUB_INSTALLATION_STATUS)[keyof typeof GITHUB_INSTALLATION_STATUS];
