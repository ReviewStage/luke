import { app, Notification } from "electron";
import type { AgentEndToast, AgentNoticeDoorsSurface, InboxItemToast } from "../agent-notices";

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
 * notifications are on for Luke.
 *
 * The Dock's badge is Electron's own count, which macOS draws only where
 * notifications are allowed for Luke and its badges are not turned off in
 * System Settings, so the developer's own switch for it is the system's.
 */
export function electronNoticeDoors(dependencies: {
  toPanels: (end: AgentEndToast) => void;
  inboxToPanels: (item: InboxItemToast) => void;
  /** macOS refused a notification, or showed one: whether notifications are off for Luke. */
  onRefused: (refused: boolean) => void;
  report: (line: string) => void;
}): AgentNoticeDoorsSurface {
  const { toPanels, inboxToPanels, onRefused, report } = dependencies;
  const standing = new Set<Notification>();
  return {
    post: (notice) => {
      if (!Notification.isSupported()) return;
      const posted = new Notification({ title: notice.title, body: notice.body });
      const release = () => standing.delete(posted);
      standing.add(posted);
      posted.on("click", () => {
        release();
        notice.onClick();
      });
      posted.on("close", release);
      posted.on("show", () => onRefused(false));
      posted.on("failed", (_event, error) => {
        release();
        report(`macOS did not show the agent's notification: ${error}`);
        onRefused(true);
      });
      posted.show();
    },
    toast: toPanels,
    toastInbox: inboxToPanels,
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
