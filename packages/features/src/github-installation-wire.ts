export const GITHUB_ACCOUNT_TYPE = {
  USER: "User",
  ORGANIZATION: "Organization",
} as const;

export type GitHubAccountType = (typeof GITHUB_ACCOUNT_TYPE)[keyof typeof GITHUB_ACCOUNT_TYPE];

export const GITHUB_INSTALLATION_STATUS = {
  ACTIVE: "active",
  SUSPENDED: "suspended",
  DELETED: "deleted",
} as const;

export type GitHubInstallationStatus =
  (typeof GITHUB_INSTALLATION_STATUS)[keyof typeof GITHUB_INSTALLATION_STATUS];
