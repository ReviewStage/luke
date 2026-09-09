import { CREDENTIAL_PROVIDER_ID, CREDENTIAL_PROVIDERS } from "@sidecar/credentials/vocabulary";
import {
  ACT_KIND,
  type AdvertisedControl,
  SESSION_CONTROL_KIND,
  SESSION_STATUS,
  type SessionProvider,
  type SessionStatus,
  workspaceAgentModels,
} from "@sidecar/session";

/**
 * What Conductor calls the states it reports and the acts it documents, and
 * the bounds every read is held to. Nothing here issues a request.
 */

// Shared with the credential registry so the key the user saves and the
// provider Luke observes with it can never name different things.
export const CONDUCTOR_PROVIDER_ID = CREDENTIAL_PROVIDER_ID.CONDUCTOR;
export const CONDUCTOR_PROVIDER_NAME =
  CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.CONDUCTOR].displayName;

export const CONDUCTOR_ENVIRONMENT = {
  API_URL: "CONDUCTOR_API_URL",
} as const;

export const CONDUCTOR_DEFAULT_API_URL = "https://api.conductor.build";

/**
 * The kinds of agent Conductor's session-creation endpoint documents, named
 * exactly as it takes them — read from the build's one table of Conductor's
 * agents and models, so the kinds a roster advertises and the pairings the
 * settings row offers can never disagree. The endpoint also takes `acp`,
 * which is a protocol shim with no defaults of its own rather than an agent
 * someone asks for by name, so the table deliberately leaves it out. Effort
 * and fast mode are never sent: the user is not offered either, so
 * Conductor's defaults stand.
 */
export const CONDUCTOR_SPAWNABLE_AGENTS: readonly string[] = workspaceAgentModels(
  CONDUCTOR_PROVIDER_ID,
).map((entry) => entry.agent);

/**
 * The turn-level control, advertised only while a session is actually working
 * a turn there is something to stop.
 */
export const CONDUCTOR_CANCEL_ADVERTISEMENT = {
  kind: ACT_KIND.CONTROL,
  id: "cancel-turn",
  label: "Stop this turn",
  controlKind: SESSION_CONTROL_KIND.STOP,
} as const satisfies AdvertisedControl;

export const CONDUCTOR_ARCHIVE_WORKSPACE_CONTROL_ID = "archive-workspace";

/**
 * The workspace-level control: Conductor documents archiving a workspace,
 * which files away every chat in it at once. It is advertised on a chat's row
 * only once every still-open chat in that workspace was positively seen
 * settled — a
 * workspace mid-turn has a stop to offer, not a filing away, and one whose
 * state could not be read is not known to have stopped — and the workspace it
 * acts on rides the advertisement as the control's target, so a press
 * archives the workspace the user was shown and nothing an adapter kept on
 * the side.
 */

export function conductorArchiveWorkspaceAdvertisement(workspaceId: string): AdvertisedControl {
  return {
    kind: ACT_KIND.CONTROL,
    id: CONDUCTOR_ARCHIVE_WORKSPACE_CONTROL_ID,
    label: "Archive",
    controlKind: SESSION_CONTROL_KIND.ARCHIVE,
    target: workspaceId,
  };
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const CONDUCTOR_SESSION_STATUS = {
  IDLE: "idle",
  WORKING: "working",
  ERROR: "error",
} as const;

export type ConductorSessionStatus =
  (typeof CONDUCTOR_SESSION_STATUS)[keyof typeof CONDUCTOR_SESSION_STATUS];

/**
 * An idle Conductor session has finished its turn and is holding for the user,
 * which is what Luke reports as waiting on the row. That is not itself an
 * ask: Conductor does not say whether the turn ended on a question, so the
 * row shows the wait and no notice speaks it, because a settled turn that
 * merely leaves the next prompt to them is silence. A session the provider
 * reports as errored stopped on something the user has to deal with, and it
 * carries the message that says what.
 */
export const SESSION_STATUS_BY_CONDUCTOR_STATUS = {
  [CONDUCTOR_SESSION_STATUS.IDLE]: SESSION_STATUS.WAITING,
  [CONDUCTOR_SESSION_STATUS.WORKING]: SESSION_STATUS.WORKING,
  [CONDUCTOR_SESSION_STATUS.ERROR]: SESSION_STATUS.ERROR,
} as const satisfies Readonly<Record<ConductorSessionStatus, SessionStatus>>;

/** The lifecycle states `GET …/workspaces/{id}/status` documents. */
export const CONDUCTOR_WORKSPACE_STATUS = {
  INITIALIZING: "initializing",
  READY: "ready",
  SLEEPING: "sleeping",
  ARCHIVED: "archived",
  DELETED: "deleted",
  UPDATING: "updating",
} as const;

export type ConductorWorkspaceStatus =
  (typeof CONDUCTOR_WORKSPACE_STATUS)[keyof typeof CONDUCTOR_WORKSPACE_STATUS];

/**
 * The lifecycle states worth a row's activity slot: a workspace still being
 * built or rebuilt is why its chats are quiet, and without the words a
 * just-created session reads as unaccountably idle. A ready workspace is the
 * normal case and says nothing, and a sleeping one is Conductor's own economy
 * — it wakes on the next message — so wording it would put a non-event on
 * the row.
 */
export const CONDUCTOR_WORKSPACE_ACTIVITY = {
  [CONDUCTOR_WORKSPACE_STATUS.INITIALIZING]: "Workspace initializing",
  [CONDUCTOR_WORKSPACE_STATUS.UPDATING]: "Workspace updating",
} as const satisfies Readonly<Partial<Record<ConductorWorkspaceStatus, string>>>;

/**
 * The lifecycle states of a workspace no longer open. Conductor's workspace
 * listing keeps a filed-away workspace in the page, but marks it: the
 * listing's `state` and the lifecycle endpoint's `status` document the same
 * value set, and the roster filters on these states wherever either read
 * reports one.
 */
export const CONDUCTOR_RETIRED_WORKSPACE_STATUSES: ReadonlySet<ConductorWorkspaceStatus> = new Set([
  CONDUCTOR_WORKSPACE_STATUS.ARCHIVED,
  CONDUCTOR_WORKSPACE_STATUS.DELETED,
]);

export const CONDUCTOR_DEFAULTS = {
  MAXIMUM_PROJECTS: 10,
  WORKSPACE_PAGE_SIZE: 100,
  /**
   * How far the workspace listing is followed while it says more remain. The
   * pages hold only the user's own open workspaces, so the bound is on live
   * conversations rather than on everything ever archived, and five hundred
   * of them is far past what one person's panel can mean anything for.
   */
  MAXIMUM_WORKSPACE_PAGES: 5,
  SESSION_PAGE_SIZE: 20,
  MAXIMUM_MODEL_LABEL_LENGTH: 60,
  MAXIMUM_ERROR_LENGTH: 120,
  MAXIMUM_AGENT_KIND_LENGTH: 40,
} as const;

export const CONDUCTOR_PROVIDER: SessionProvider = {
  id: CONDUCTOR_PROVIDER_ID,
  displayName: CONDUCTOR_PROVIDER_NAME,
};
