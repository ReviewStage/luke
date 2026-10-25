import type { AgentNoticeDoorsSurface } from "@luke/host/agent-notices";
import { NOTIFICATIONS_STATUS, type NotificationsStatus } from "@luke/voice/settings-controls";
import { app, Notification } from "electron";

/**
 * notice-doors.ts -- the doors a notice leaves this process through: Electron's `Notification`, shown once with its click handed back, which only a command waiting on this Mac posts, or the Dock's badge.
 *
 * A system that posts no notifications is left alone rather than asked;
 * the prompt in the window still says a command waits.
 *
 * Note that each notification is held until macOS is done with it, because
 * the object is all that ties the banner to its click: one the collector
 * took has no click left to hand back. Whether macOS refused it or showed
 * it is handed on, since that is the only word Electron gives of whether
 * notifications are on for Luke, which This Mac says under Ask every time.
 *
 * The Dock's badge is Electron's own count, which macOS draws only where
 * notifications are allowed for Luke and its badges are not turned off in
 * System Settings, so the developer's own switch for it is the system's.
 */
export function electronNoticeDoors(dependencies: {
  /** macOS showed a notification, or refused one: whether notifications are on for Luke. */
  onAnswered: (status: NotificationsStatus) => void;
  report: (line: string) => void;
}): AgentNoticeDoorsSurface {
  const { onAnswered, report } = dependencies;
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
    badge: (count) => {
      app.setBadgeCount(count);
    },
  };
}

/**
 * Asks macOS whether Luke may post notifications, at launch rather than at
 * the first command ask. Electron asks as it first reaches for notifications
 * and posts without waiting for the answer, so a first notification posted
 * before the developer has answered is refused, and the question itself
 * would arrive while the window is behind, which is when an ask is posted.
 */
export function askForNotifications(): void {
  Notification.isSupported();
}
