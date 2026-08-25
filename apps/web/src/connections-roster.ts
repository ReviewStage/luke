import {
  PROVIDER_ID_LIST,
  PROVIDER_IDENTITY_BY_ID,
  SESSION_APPLICATION_ID,
  SESSION_APPLICATION_ID_LIST,
  type SessionApplicationId,
} from "@sidecar/session";

/**
 * The roster every "works with" presentation draws from, whatever its
 * styling: the agents Luke observes and the apps that hold their sessions,
 * each keyed by the product's own id lists so a renamed or removed provider
 * breaks the build instead of leaving stale marketing. See `WorksWith.tsx`
 * for the shipped presentation.
 */
export interface RosterEntry {
  readonly id: string;
  readonly name: string;
}

export const AGENTS: readonly RosterEntry[] = PROVIDER_ID_LIST.map((id) => ({
  id,
  name: PROVIDER_IDENTITY_BY_ID[id].displayName,
}));

const APPLICATION_DISPLAY_NAME = {
  [SESSION_APPLICATION_ID.CHATGPT]: "ChatGPT",
  [SESSION_APPLICATION_ID.CMUX]: "cmux",
  [SESSION_APPLICATION_ID.CONDUCTOR]: "Conductor",
  [SESSION_APPLICATION_ID.CURSOR]: "Cursor",
  [SESSION_APPLICATION_ID.ORCA]: "Orca",
  [SESSION_APPLICATION_ID.RADIUS]: "Radius",
  [SESSION_APPLICATION_ID.REPLICAS]: "Replicas",
  [SESSION_APPLICATION_ID.SUPERSET]: "Superset",
} as const satisfies Readonly<Record<SessionApplicationId, string>>;

export const APPS: readonly RosterEntry[] = SESSION_APPLICATION_ID_LIST.map((id) => ({
  id,
  name: APPLICATION_DISPLAY_NAME[id],
}));
