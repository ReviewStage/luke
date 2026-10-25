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
  /** Asks the system for access, settling once asked, for the button that waits on it. Using the microphone is the talk key's job. */
  onRequest: () => void | Promise<void>;
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
 * Whether macOS shows Luke's notifications, which the one notification Luke
 * posts, a command waiting on this Mac, reaches the developer through, and
 * the one place that grant can be changed.
 */
export interface NotificationsControl {
  status: NotificationsStatus;
  /**
   * Whether this is the packaged app: a development build runs inside
   * Electron's own app, which is the name macOS lists its notifications under.
   */
  packaged: boolean;
  /** Opens System Settings on its notifications. */
  onOpenSettings: () => void;
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
