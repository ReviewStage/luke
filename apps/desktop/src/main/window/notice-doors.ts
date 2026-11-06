import { PRODUCT_NAME } from "@repo/features/product-name";
import type { AgentNoticeDoorsSurface } from "@repo/host/agent-notices";
import { NOTIFICATIONS_STATUS, type NotificationsStatus } from "@repo/settings/settings-controls";
import { app, Notification } from "electron";

export function electronNoticeDoors(dependencies: {
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
      report(`macOS did not show ${PRODUCT_NAME}'s notification: ${error}`);
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

export function askForNotifications(): void {
  Notification.isSupported();
}
