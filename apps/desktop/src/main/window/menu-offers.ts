import type { AppCommand } from "@repo/settings/shortcuts";
import { BrowserWindow, type WebContents } from "electron";
import type { MenuBarChange } from "../app-menu";

export interface MenuOffers {
  tell: (sender: WebContents, commands: readonly AppCommand[]) => void;
  focusMoved: () => void;
}

function focusedPage(): WebContents | undefined {
  return BrowserWindow.getFocusedWindow()?.webContents;
}

export function menuOffers(show: (change: MenuBarChange) => void): MenuOffers {
  const held = new Map<WebContents, readonly AppCommand[]>();
  return {
    tell: (sender, commands) => {
      held.set(sender, commands);
      if (focusedPage() === sender) show({ offered: commands });
    },
    focusMoved: () => {
      for (const sender of held.keys()) if (sender.isDestroyed()) held.delete(sender);
      const focused = focusedPage();
      show({ offered: focused === undefined ? undefined : held.get(focused) });
    },
  };
}
