// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { SETTINGS_VIEW } from "@luke/settings/settings-views";
import { UPDATE_STATUS } from "@luke/settings/update";
import { TASKS_PAGE } from "@luke/ui/tasks-model";
import { MICROPHONE_STATUS } from "@luke/voice/audio";
import { NOTIFICATIONS_STATUS } from "@luke/voice/settings-controls";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { PANEL_TAB, type PanelTab } from "../panel-tabs.js";
import { SHELL_ROOM } from "../shell-room.js";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { DESKTOP_CAPABILITIES } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { tasksControl } from "../testing/tasks-control.js";
import { DesktopShell } from "./desktop-shell.js";
import { SIDEBAR_OVERLAY } from "./sidebar-collapse.js";

// Note that a chunk whose fetch failed rejects its import as the browser does, so each page the
// shell splits off stands in its place as a failure, which `lazyRoute` is to keep to the page.
vi.mock("./desktop-settings.js", () => {
  throw new TypeError("Failed to fetch dynamically imported module");
});
vi.mock("./tasks-page.js", () => {
  throw new TypeError("Failed to fetch dynamically imported module");
});
vi.mock("./automations-page.js", () => {
  throw new TypeError("Failed to fetch dynamically imported module");
});

const ignore = () => undefined;

let root: Root | undefined;

beforeEach(() => {
  fakeAppPlatform(QUIET_PANEL);
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  fakeAppBridge({});
  // Note that React says each failure its boundary caught on the console, as it would in the window.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** The shell on `tab` over the tasks page `page`, drawn and its chunk's failure landed. */
async function mountFailing(
  tab: PanelTab,
  overrides: Parameters<typeof tasksControl>[0],
): Promise<HTMLElement> {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const tasks = tasksControl({ page: TASKS_PAGE.HOME, ...overrides });
  const shell = createElement(DesktopShell, {
    gates: { accountRequired: false, onBeginSignIn: ignore, onCancelSignIn: ignore },
    tab,
    onTabChange: ignore,
    tasks,
    history: {
      canGoBack: false,
      canGoForward: false,
      onBack: ignore,
      onForward: ignore,
      steps: { back: [], forward: [] },
      onGoTo: ignore,
      onLeaveVersionHistory: ignore,
      away: undefined,
      onLeave: ignore,
    },
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
    room: SHELL_ROOM.WIDE,
    settingsStep: { listed: true, onList: ignore },
    settings: {
      account: {
        status: ACCOUNT_STATUS.SIGNED_IN,
        email: "dev@example.com",
        name: "Dev",
        provider: "github",
      },
      onSignOut: () => Promise.resolve(),
      onDeleteAccount: () => Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED }),
      view: SETTINGS_VIEW.ACCOUNT,
      onViewChange: ignore,
      microphone: {
        status: MICROPHONE_STATUS.GRANTED,
        voiceAvailable: true,
        onRequest: ignore,
        onOpenSettings: ignore,
      },
      notifications: {
        status: NOTIFICATIONS_STATUS.UNKNOWN,
        packaged: true,
        onOpenSettings: ignore,
      },
      capabilities: DESKTOP_CAPABILITIES,
      updates: {
        update: {
          status: UPDATE_STATUS.IDLE,
          currentVersion: "1.0.0",
          installSupported: true,
          upToDate: false,
        },
        build: { packaged: false },
        onCheck: () => Promise.resolve(),
        onInstall: ignore,
        onOpenLatest: ignore,
      },
    },
  });
  act(() => root?.render(onRegistry(AtomRegistry.make(), shell)));
  await act(async () => {
    for (let tick = 0; tick < 16; tick += 1) await Promise.resolve();
  });
  return container;
}

/** The alert a failed page stands in its place, and whether it offers Retry. */
function failure(window: HTMLElement): { text: string; retry: boolean } {
  const alert = window.querySelector('[role="alert"]');
  assert.ok(alert, "the failed page says so");
  return {
    text: alert.textContent ?? "",
    retry: [...window.querySelectorAll("button")].some((button) =>
      /Retry|Reload/u.test(button.textContent ?? ""),
    ),
  };
}

test("a Settings chunk that fails to import stands its own error with a way to try again, the window around it still standing", async () => {
  const window = await mountFailing(PANEL_TAB.SETTINGS, {});
  assert.equal(failure(window).retry, true);
  assert.ok(window.querySelector(".desktop-shell"), "the window's shell stands");
});

test("a Tasks page chunk that fails to import stands its own error, the sidebar left drawn", async () => {
  const window = await mountFailing(PANEL_TAB.TASKS, {
    boardView: { ...tasksControl().boardView, open: true },
  });
  assert.equal(failure(window).retry, true);
  assert.ok(window.querySelector("aside.desktop-sidebar"), "the sidebar stands");
});

test("an Automations chunk that fails to import stands its own error, the sidebar left drawn", async () => {
  const window = await mountFailing(PANEL_TAB.TASKS, {
    automationsView: { ...tasksControl().automationsView, open: true },
  });
  assert.equal(failure(window).retry, true);
  assert.ok(window.querySelector("aside.desktop-sidebar"), "the sidebar stands");
});
