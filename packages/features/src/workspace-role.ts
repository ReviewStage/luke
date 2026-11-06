import { WORKSPACE_ROLE, type Workspace } from "./workspace-wire.js";

export function managesWorkspace(workspace: Workspace): boolean {
  return workspace.role === WORKSPACE_ROLE.OWNER || workspace.role === WORKSPACE_ROLE.ADMIN;
}
