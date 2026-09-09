import { isProviderId, type Session } from "@sidecar/session";
import type { Rectangle, ResolvedNotchGeometry } from "@sidecar/surface";
import { isRecord, isWireString, type UnparsedWireValue } from "@sidecar/wire";

export {
  SUPERSET_SIGN_IN_STAGE,
  type SupersetOrganizationChoice,
  type SupersetSignInSnapshot,
} from "@sidecar/providers/superset/sign-in-stage";
export {
  isWorkspaceProviderId,
  type SessionOpenResult,
  SUPERSET_WORKSPACE_PROVIDER_ID,
  type WorkspaceProviderId,
} from "@sidecar/session";
export type { WindowMode } from "@sidecar/surface";

/**
 * A session as its provider named it, read at a process boundary. The
 * provider id is admitted against the registry rather than typed by it: a
 * `SessionIdentity` carries the id its provider reported, and this build's own
 * registry is what says whether that is one it observes.
 */
export function isSessionIdentity(value: UnparsedWireValue): boolean {
  if (!isRecord(value)) return false;
  return (
    isWireString(value.providerId) &&
    isProviderId(value.providerId) &&
    isWireString(value.providerSessionId) &&
    value.providerSessionId.length > 0
  );
}

/**
 * Which surface a window exists to draw. Every window loads the same renderer
 * bundle, so the role is what tells the hidden voice window apart from the
 * panel windows — decided in the main process by which window asked, never by
 * anything the renderer could claim about itself. The spoken introduction is
 * not one of them: it is a fullscreen mode of the panel, and the document's
 * own `introduction` slice is what says so.
 */
export const WINDOW_ROLE = {
  PANEL: "panel",
  /** The one hidden window that will hold the live conversation; it draws nothing. */
  VOICE: "voice",
} as const;

export type WindowRole = (typeof WINDOW_ROLE)[keyof typeof WINDOW_ROLE];

export interface DisplayDiagnostic {
  id: number;
  label: string;
  bounds: Rectangle;
  workArea: Rectangle;
  scaleFactor: number;
  notch: ResolvedNotchGeometry;
}

/**
 * How screen recording is armed, decided in the main process and carried on
 * every version of the app-state document.
 *
 * It carries what the renderer cannot work out for itself and nothing else.
 * The two switches are not here: the renderer already holds `shareUsageData`
 * and `sessionReplay` and is told the moment either moves, so reading them
 * live is what lets a switch turned off stop a recording where it stands —
 * and a switch turned back on start one — rather than at the next launch.
 * Where a recording goes is not here either: the processor's address is fixed
 * by the build, in the renderer beside the connect policy that names it.
 */
export interface SessionReplayBootstrap {
  /**
   * Whether this run may record at all, whatever the switches say. False for
   * a fixture and a capture run, which must stay deterministic and send
   * nothing, and false for the rest of a run in which an account was deleted.
   * Being signed out is not one of the reasons: recording begins at the first
   * paint, before an account exists.
   */
  permitted: boolean;
  /**
   * This build's own version, for the recorder to file what it sends under.
   * It rides here rather than on a channel of its own because the renderer
   * has no way to read it: the bundle is written once and the version is a
   * fact of the packaged app around it.
   */
  appVersion: string;
  /**
   * The account's opaque id, absent while signed out. It is the same id the
   * hosted endpoints resolve a bearer token to, so a recording lands on the
   * person the counted events already belong to — which is also what makes
   * deleting the account erase the recordings with it. A recording that runs
   * while this is absent is anonymous, joined to the person if a sign-in
   * lands during it and to nobody if none ever does.
   */
  accountId?: string;
}

/** The complete session state one observation revision publishes to a desktop surface. */
export interface SessionRosterPayload {
  sessions: readonly Session[];
}
