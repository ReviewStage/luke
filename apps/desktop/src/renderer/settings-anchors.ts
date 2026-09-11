import {
  CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID,
  PROVIDER_ID,
  SUPERSET_WORKSPACE_PROVIDER_ID,
  type WorkspaceProviderId,
} from "@sidecar/session";

/**
 * How a row says a pressed search result may land on it, and the ids the rows
 * that are not settings wear.
 *
 * It lives apart from the search itself because the rows wear these and the
 * search reads them: a module holding both would have every row's file
 * importing the search, and the search importing the table those rows are
 * drawn from.
 */
export const SETTINGS_SEARCH_ANCHOR_ATTRIBUTE = "data-search-anchor";

/** What a row spreads onto itself to be somewhere a pressed result lands. */
export function searchAnchorProps(id: string) {
  return { [SETTINGS_SEARCH_ANCHOR_ATTRIBUTE]: id } satisfies Record<string, string>;
}

/**
 * The ids of the searchable rows that are neither stored settings nor
 * connections, shared with the panel so the entry and the anchor its row wears
 * cannot drift apart. A connection anchors by its own `CONNECTION_SCHEMA` id,
 * and a setting by its schema id.
 */
export const SETTINGS_SEARCH_ROW = {
  UPDATES: "updates",
  CHANGELOG: "changelog",
  FEEDBACK: "feedback",
  SIGN_OUT: "sign-out",
  DELETE_ACCOUNT: "delete-account",
  QUIT: "quit",
  MICROPHONE: "microphone",
  TALK_KEY: "talk-key",
  STOP_KEY: "stop-key",
} as const;

/**
 * Each provider's Default project row, by the provider it belongs to: several
 * providers draw one, so a shared id would land a press on whichever row
 * happens to stand first. A literal table rather than a composed string, and
 * deliberately only the providers that create workspaces today — a provider
 * it does not name draws its row unfound rather than mislanding a press, and
 * widening it is one line beside the capability that widened.
 */
type DefaultProjectProviderId =
  | typeof PROVIDER_ID.CONDUCTOR
  | typeof CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID
  | typeof PROVIDER_ID.CODEX
  | typeof SUPERSET_WORKSPACE_PROVIDER_ID;

const DEFAULT_PROJECT_ROW_ID = {
  [PROVIDER_ID.CONDUCTOR]: "default-project-conductor",
  [CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID]: "default-project-conductor-local",
  [PROVIDER_ID.CODEX]: "default-project-codex",
  [SUPERSET_WORKSPACE_PROVIDER_ID]: "default-project-superset",
} as const satisfies Readonly<Record<DefaultProjectProviderId, string>>;

/** The anchor a provider's Default project row wears, if the table names it. */
export function defaultProjectRowId(providerId: WorkspaceProviderId): string | undefined {
  if (!Object.hasOwn(DEFAULT_PROJECT_ROW_ID, providerId)) return undefined;
  // SAFETY: hasOwn narrows the id to the table's own keys.
  return DEFAULT_PROJECT_ROW_ID[providerId as keyof typeof DEFAULT_PROJECT_ROW_ID];
}
