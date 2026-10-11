import { Notification } from "electron";
import type { AgentEndToast, AgentNoticeDoorsSurface } from "../agent-notices";

/**
 * notice-doors.ts -- the doors an agent's announcement leaves this process through: Electron's `Notification`, shown once with its click handed back, or the panel's own toast.
 *
 * A system that posts no notifications is left alone rather than asked;
 * the unseen dot still says the agent ended. The toast is the panels' to
 * draw, so it is handed to whatever carries an event to them.
 */
export function electronNoticeDoors(
  toPanels: (end: AgentEndToast) => void,
): AgentNoticeDoorsSurface {
  return {
    post: (notice) => {
      if (!Notification.isSupported()) return;
      const posted = new Notification({ title: notice.title, body: notice.body });
      posted.on("click", notice.onClick);
      posted.show();
    },
    toast: toPanels,
  };
}
