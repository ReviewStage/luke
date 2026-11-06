import type { MicrophoneStatus } from "./microphone.js";
import type { RunningBuild, UpdateSnapshot } from "./update.js";

export interface MicrophoneControl {
  status: MicrophoneStatus;
  onRequest: () => void | Promise<void>;
  onOpenSettings: () => void;
}

export const NOTIFICATIONS_STATUS = {
  UNKNOWN: "unknown",
  ON: "on",
  OFF: "off",
} as const;

export type NotificationsStatus = (typeof NOTIFICATIONS_STATUS)[keyof typeof NOTIFICATIONS_STATUS];

export interface NotificationsControl {
  status: NotificationsStatus;
  packaged: boolean;
  onOpenSettings: () => void;
}

export interface UpdateControl {
  update: UpdateSnapshot;
  build: RunningBuild;
  onCheck: () => Promise<void>;
  onInstall: () => void;
  onMoveToApplications: () => void;
  onOpenLatest: () => void;
}
