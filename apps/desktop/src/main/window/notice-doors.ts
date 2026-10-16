import type {
  AgentEndToast,
  AgentNoticeDoorsSurface,
  FailedRunToast,
  InboxItemToast,
} from "@luke/host/agent-notices";
import { NOTIFICATIONS_STATUS, type NotificationsStatus } from "@luke/voice/settings-controls";
import { app, Notification } from "electron";

/** What the notification Settings' test posts says. */
const TEST_NOTICE = {
  title: "Luke notifications are on",
  body: "",
} as const;

/**
 * The doors Luke's notices leave through, and the one notification posted on
 * the developer's own ask: through the same door, so its answer from macOS is
 * read as every other one is.
 */
export interface ElectronNoticeDoors extends AgentNoticeDoorsSurface {
  /** Posts the test notification right away, whatever window is in front; a click on it calls `onClick`. */
  postTest: (onClick: () => void) => void;
}

/**
 * notice-doors.ts -- the doors an agent's announcement leaves this process through: Electron's `Notification`, shown once with its click handed back, the panel's own toast, or the Dock's badge.
 *
 * A system that posts no notifications is left alone rather than asked;
 * the unseen dot still says the agent ended. The toast is the panels' to
 * draw, so it is handed to whatever carries an event to them.
 *
 * Note that each notification is held until macOS is done with it, because
 * the object is all that ties the banner to its click: one the collector
 * took has no click left to hand back. Whether macOS refused it or showed
 * it is handed on, since that is the only word Electron gives of whether
 * notifications are on for Luke; the test Settings posts is how a
 * developer asks for that word before any agent has ended.
 *
 * The Dock's badge is Electron's own count, which macOS draws only where
 * notifications are allowed for Luke and its badges are not turned off in
 * System Settings, so the developer's own switch for it is the system's.
 */
export function electronNoticeDoors(dependencies: {
  toPanels: (end: AgentEndToast) => void;
  inboxToPanels: (item: InboxItemToast) => void;
  failedRunToPanels: (run: FailedRunToast) => void;
  /** macOS showed a notification, or refused one: whether notifications are on for Luke. */
  onAnswered: (status: NotificationsStatus) => void;
  report: (line: string) => void;
}): ElectronNoticeDoors {
  const { toPanels, inboxToPanels, failedRunToPanels, onAnswered, report } = dependencies;
  const standing = new Set<Notification>();
  const post: AgentNoticeDoorsSurface["post"] = (notice) => {
    if (!Notification.isSupported()) return;
    const posted = new Notification({ title: notice.title, body: notice.body });
    const release = () => standing.delete(posted);
    standing.add(posted);
    posted.on("click", () => {
      release();
      notice.onClick();
    });
    posted.on("close", release);
    posted.on("show", () => onAnswered(NOTIFICATIONS_STATUS.ON));
    posted.on("failed", (_event, error) => {
      release();
      report(`macOS did not show Luke's notification: ${error}`);
      onAnswered(NOTIFICATIONS_STATUS.OFF);
    });
    posted.show();
  };
  return {
    post,
    postTest: (onClick) => post({ ...TEST_NOTICE, onClick }),
    toast: toPanels,
    toastInbox: inboxToPanels,
    toastFailedRun: failedRunToPanels,
    badge: (count) => {
      app.setBadgeCount(count);
    },
  };
}

/**
 * Asks macOS whether Luke may post notifications, at launch rather than at
 * the first agent's end. Electron asks as it first reaches for notifications
 * and posts without waiting for the answer, so a first notification posted
 * before the developer has answered is refused, and the question itself
 * would arrive while the window is behind, which is when an end is posted.
 */
export function askForNotifications(): void {
  Notification.isSupported();
}
