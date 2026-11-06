export const ADMIN_PULL_REQUEST = {
  NONE: "none",
  OPEN: "open",
  MERGED: "merged",
  CLOSED: "closed",
} as const;

export type AdminPullRequest = (typeof ADMIN_PULL_REQUEST)[keyof typeof ADMIN_PULL_REQUEST];

export const ADMIN_WORKSPACE_KIND = {
  PERSONAL: "personal",
  SHARED: "shared",
} as const;

export type AdminWorkspaceKind = (typeof ADMIN_WORKSPACE_KIND)[keyof typeof ADMIN_WORKSPACE_KIND];

export const ADMIN_FAILURE_KIND = {
  AGENT: "agent",
  KEY: "key",
  CONNECTION: "connection",
  AUTOMATION: "automation",
} as const;
