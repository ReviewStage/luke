import type { RunningBuild, UpdateSnapshot } from "@luke/settings/update";
import type { MicrophoneStatus } from "./audio.js";

/**
 * Whether Luke may open the microphone, and the two things that can be done
 * about that: asking the system for access, or opening the one place the
 * system's own grant can be changed.
 */
export interface MicrophoneControl {
  status: MicrophoneStatus;
  /** Whether there is anything to talk to, which is the microphone's only use. */
  voiceAvailable: boolean;
  /** Asks the system for access. Using the microphone is the talk key's job. */
  onRequest: () => void;
  /** Opens the one place the system's own grant can be changed. */
  onOpenSettings: () => void;
}

/**
 * What macOS last answered a notification of Luke's: nothing yet, showed it,
 * or refused it, which is the only word Electron gives of whether
 * notifications are on for Luke.
 */
export const NOTIFICATIONS_STATUS = {
  UNKNOWN: "unknown",
  ON: "on",
  OFF: "off",
} as const;

export type NotificationsStatus = (typeof NOTIFICATIONS_STATUS)[keyof typeof NOTIFICATIONS_STATUS];

/**
 * Who grants Luke's notifications where the panel stands: macOS for the Mac
 * app, or the browser's permission for the site, which the page itself
 * cannot open and the browser's own address bar changes.
 */
export const NOTIFICATIONS_GRANTOR = {
  MACOS: "macos",
  BROWSER: "browser",
} as const;

export type NotificationsGrantor =
  (typeof NOTIFICATIONS_GRANTOR)[keyof typeof NOTIFICATIONS_GRANTOR];

/**
 * Whether macOS shows Luke's notifications, the one place that grant can be
 * changed, and a notification posted now to find out.
 */
export interface NotificationsControl {
  status: NotificationsStatus;
  /** Who grants them, which decides the lines said of the grant and whether there is a settings page to open. */
  grantor: NotificationsGrantor;
  /**
   * Whether this is the packaged app: a development build runs inside
   * Electron's own app, which is the name macOS lists its notifications under.
   */
  packaged: boolean;
  /** Opens System Settings on its notifications; offered only where macOS grants them. */
  onOpenSettings: () => void;
  /** Posts a notification right away, even while Luke's window is in front. */
  onTest: () => void;
}

/**
 * Where the app stands against the latest release, and the actions the row can
 * take about that: ask the release manifest now, restart into a build already
 * downloaded, or — where installing in place is impossible or has failed —
 * open the releases page in the browser. A newer build downloads itself when
 * a check finds one; the running build is replaced only at a quit.
 */
export interface UpdateControl {
  update: UpdateSnapshot;
  /** The running build, which a development build's row names instead of a release. */
  build: RunningBuild;
  /** Asks the release manifest for the latest build, right now. */
  onCheck: () => Promise<void>;
  /** Restarts into the downloaded release. */
  onInstall: () => void;
  /** Opens the latest release's page, fixed by the build, in the browser. */
  onOpenLatest: () => void;
}
