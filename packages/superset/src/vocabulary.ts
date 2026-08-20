import { isProviderId, type ProviderId, SESSION_APPLICATION_ID } from "@sidecar/session";

export const SUPERSET_WORKSPACE_PROVIDER_ID = SESSION_APPLICATION_ID.SUPERSET;

/** Every provider that can offer a workspace through the desktop app. */
export type WorkspaceProviderId = ProviderId | typeof SUPERSET_WORKSPACE_PROVIDER_ID;

export function isWorkspaceProviderId(value: string): value is WorkspaceProviderId {
  return isProviderId(value) || value === SUPERSET_WORKSPACE_PROVIDER_ID;
}
