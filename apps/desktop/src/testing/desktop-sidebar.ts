import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { SIDEBAR_OVERLAY } from "@luke/panel/desktop/sidebar-collapse";
import { PANEL_TAB } from "@luke/panel/panel-tabs";
import { UPDATE_STATUS } from "@luke/settings/update";
import type { ComponentProps } from "react";
import type { DesktopSidebar } from "../renderer/desktop/desktop-sidebar";
import type { TasksControl } from "../renderer/tasks/use-tasks-tab";

/**
 * desktop-sidebar.ts -- the sidebar's props on the Plans tab, open and pinned, signed in, listing what `plans` lists, every other press ignored.
 */

const ignore = () => undefined;

export function sidebarProps(tasks: TasksControl): ComponentProps<typeof DesktopSidebar> {
  return {
    sidebar: {
      collapsed: false,
      compact: false,
      overlay: SIDEBAR_OVERLAY.CLOSED,
      width: 264,
      onToggle: ignore,
      onOverlay: ignore,
      onResize: ignore,
      staged: false,
    },
    history: { canGoBack: false, canGoForward: false, onBack: ignore, onForward: ignore },
    tasks: tasks,
    tab: PANEL_TAB.TASKS,
    onTabChange: ignore,
    onPressWithin: ignore,
    account: {
      status: ACCOUNT_STATUS.SIGNED_IN,
      email: "dev@example.com",
      name: "Dev",
      provider: "github",
    },
    updates: {
      update: {
        status: UPDATE_STATUS.IDLE,
        currentVersion: "1.0.0",
        installSupported: true,
        upToDate: true,
      },
      build: { packaged: false },
      onCheck: () => Promise.resolve(),
      onInstall: ignore,
      onOpenLatest: ignore,
    },
    onSignOut: () => Promise.resolve(),
    call: undefined,
  };
}
