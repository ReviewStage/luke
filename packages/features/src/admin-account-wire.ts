/**
 * admin-account-wire.ts -- the words the account page's support sections are answered in.
 *
 * Apart from `admin-account.ts` because the page draws by them, and that
 * module reads coding-agent statuses with service code the browser bundle
 * must not carry.
 */

/** Where an agent's pull request stands as the page draws it: none, open (a draft among them), merged, or closed. */
export const ADMIN_PULL_REQUEST = {
  NONE: "none",
  OPEN: "open",
  MERGED: "merged",
  CLOSED: "closed",
} as const;

export type AdminPullRequest = (typeof ADMIN_PULL_REQUEST)[keyof typeof ADMIN_PULL_REQUEST];

/** Whether a workspace is the account's personal one, or another. */
export const ADMIN_WORKSPACE_KIND = {
  PERSONAL: "personal",
  SHARED: "shared",
} as const;

export type AdminWorkspaceKind = (typeof ADMIN_WORKSPACE_KIND)[keyof typeof ADMIN_WORKSPACE_KIND];

/** What failed, by the record it was read from. */
export const ADMIN_FAILURE_KIND = {
  AGENT: "agent",
  CALL: "call",
  KEY: "key",
  CONNECTION: "connection",
  AUTOMATION: "automation",
} as const;
