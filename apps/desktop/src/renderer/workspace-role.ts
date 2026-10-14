import { WORKSPACE_ROLE, type Workspace } from "@sidecar/features/workspace-wire";

/**
 * workspace-role.ts -- what the account's role in a workspace lets it do, read where the panel decides what to offer.
 */

/** Whether the account's role lets it manage the workspace's members and GitHub organization. */
export function managesWorkspace(workspace: Workspace): boolean {
  return workspace.role === WORKSPACE_ROLE.OWNER || workspace.role === WORKSPACE_ROLE.ADMIN;
}
