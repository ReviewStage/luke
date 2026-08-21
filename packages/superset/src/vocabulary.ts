import {
  CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID,
  isProviderId,
  type ProviderId,
  SESSION_APPLICATION_ID,
} from "@sidecar/session";

export const SUPERSET_WORKSPACE_PROVIDER_ID = SESSION_APPLICATION_ID.SUPERSET;

/**
 * Every provider that can offer a workspace through the desktop app: the
 * observed session providers, Superset's own workspace provider, and local
 * Conductor's — the last two name no observed session provider, so they are
 * added beside `ProviderId` rather than found within it.
 */
export type WorkspaceProviderId =
  | ProviderId
  | typeof SUPERSET_WORKSPACE_PROVIDER_ID
  | typeof CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID;

export function isWorkspaceProviderId(value: string): value is WorkspaceProviderId {
  return (
    isProviderId(value) ||
    value === SUPERSET_WORKSPACE_PROVIDER_ID ||
    value === CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID
  );
}
