import { Notification } from "electron";
import type { AgentNoticePoster } from "../agent-notices";

/**
 * notice-poster.ts -- the one door a notification leaves this process through: Electron's `Notification`, shown once with its click handed back.
 *
 * A system that posts no notifications is left alone rather than asked;
 * the unseen dot still says the agent ended.
 */
export function electronNoticePoster(): AgentNoticePoster {
  return {
    post: (notice) => {
      if (!Notification.isSupported()) return;
      const posted = new Notification({ title: notice.title, body: notice.body });
      posted.on("click", notice.onClick);
      posted.show();
    },
  };
}
