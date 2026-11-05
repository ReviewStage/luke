import type { AppCommand } from "@repo/settings/shortcuts";
import { BrowserWindow, type WebContents } from "electron";
import type { MenuBarChange } from "../app-menu";

/**
 * menu-offers.ts -- which commands each panel offers the menu bar, as it tells them, and the focused panel's drawn.
 *
 * A panel tells the commands its controls offer whenever they change
 * (`ACT_KIND.WINDOW_MENU_OFFERS`). The menu bar answers the focused window,
 * so it is drawn from the focused panel's, and again whenever the focus moves
 * between windows; while no panel is focused, or the focused one has told
 * nothing yet, it dims nothing, so no item stands dimmed that a click would
 * still run.
 */

/** The panels' offers, and the menu bar drawn from the focused one's. */
export interface MenuOffers {
  /** Keeps what `sender` offers now, drawing it where `sender` is the focused panel. */
  tell: (sender: WebContents, commands: readonly AppCommand[]) => void;
  /** Draws the menu bar from the panel focused now, as the focus moved. */
  focusMoved: () => void;
}

/** The focused window's page, if a window is focused. */
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
