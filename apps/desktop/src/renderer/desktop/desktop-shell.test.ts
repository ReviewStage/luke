// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { SETTINGS_VIEW } from "@luke/settings/settings-views";
import { UPDATE_STATUS } from "@luke/settings/update";
import { MICROPHONE_STATUS } from "@luke/voice/audio";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { ACT_OUTCOME_STATUS } from "#shared/messages/acts";
import { APP_COMMAND } from "#shared/shortcuts";
import { onRegistry } from "#testing/copy-feedback";
import { plansControl } from "#testing/plans-control";
import { runAppCommand } from "../app-commands";
import { PANEL_TAB, type PanelTab } from "../panel-tabs";
import { PLANS_PAGE } from "../planning/planning-model";
import type { PlansControl } from "../planning/use-plans-tab";
import type { SettingsPanelProps } from "../settings/settings-panel";
import { DesktopShell } from "./desktop-shell";

const ignore = () => undefined;
const accepted = () => Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });

/** A signed-in account's Settings, every press ignored. */
const SETTINGS: SettingsPanelProps = {
  account: {
    status: ACCOUNT_STATUS.SIGNED_IN,
    email: "dev@example.com",
    name: "Dev",
    provider: "github",
  },
  onSignOut: () => Promise.resolve(),
  onDeleteAccount: accepted,
  view: SETTINGS_VIEW.ACCOUNT,
  onViewChange: ignore,
  microphone: {
    status: MICROPHONE_STATUS.GRANTED,
    voiceAvailable: true,
    onRequest: ignore,
    onOpenSettings: ignore,
  },
  notifications: { refused: false, onOpenSettings: ignore },
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
  shortcuts: {
    voiceHotkeyHeld: false,
    voiceChosen: false,
    voiceOff: false,
    onVoiceHotkeyChange: accepted,
    stopChosen: false,
    stopOff: false,
    onStopHotkeyChange: accepted,
    onCapture: ignore,
  },
};

let root: Root | undefined;

beforeEach(() => {
  // The window's motion as a Mac with none reduced answers it.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      onMenuCommand: () => () => undefined,
      recordSurfaceEvent: () => undefined,
      act: () => Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." }),
    },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/**
 * The window's shell on the home page with the sidebar folded, the Inbox
 * open over it or not, New plan opening its dialog and Cancel putting it
 * away as the tab does.
 */
function mount(
  inboxOpen: boolean,
  restoring = false,
  overrides: Partial<PlansControl> = {},
  tab: PanelTab = PANEL_TAB.PLANS,
  onTabChange: (tab: PanelTab) => void = ignore,
): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const control = plansControl();
  function Shell() {
    const [asked, setAsked] = useState(false);
    return createElement(DesktopShell, {
      gates: {
        accountRequired: false,
        onBeginSignIn: ignore,
        onCancelSignIn: ignore,
        signInFace: { play: 0 },
      },
      tab,
      onTabChange,
      plans: plansControl({
        page: PLANS_PAGE.HOME,
        restoring,
        inboxView: {
          open: inboxOpen,
          chosen: undefined,
          onOpen: ignore,
          onClose: ignore,
          onChoose: ignore,
        },
        onNewPlan: () => setAsked(true),
        newPlan: { ...control.newPlan, open: asked, onClose: () => setAsked(false) },
        ...overrides,
      }),
      history: {
        canGoBack: false,
        canGoForward: false,
        onBack: ignore,
        onForward: ignore,
        onLeaveVersionHistory: ignore,
      },
      sidebar: { collapsed: true, width: 264, onToggle: ignore, onResize: ignore, staged: false },
      call: undefined,
      captions: {
        caption: { content: undefined, shown: false },
        volumeHint: { wanted: false, text: "", onDismiss: ignore },
      },
      settings: SETTINGS,
    });
  }
  act(() => root?.render(onRegistry(AtomRegistry.make(), createElement(Shell))));
  return container;
}

/** The buttons beside the traffic lights, by name. */
function titleBarButtons(page: HTMLElement): string[] {
  const controls = page.querySelector(".title-bar-controls:not([data-edge])");
  assert.ok(controls, "the title bar's buttons stand");
  return [...controls.querySelectorAll("button")].map(
    (button) => button.getAttribute("aria-label") ?? "",
  );
}

test("with the sidebar folded, New plan stands beside its toggle over the home page and the Inbox alike", () => {
  assert.deepEqual(titleBarButtons(mount(false)), ["Show sidebar", "New plan"]);
  act(() => root?.unmount());
  root = undefined;
  assert.deepEqual(titleBarButtons(mount(true)), ["Show sidebar", "New plan"]);
});

test("the home page welcomes an account with no plan, and its New plan raises the dialog over the window, which Cancel puts away", () => {
  const page = mount(false);
  const home = page.querySelector('section[aria-label="Home"]');
  assert.ok(home, "the home page stands");
  const newPlan = [...home.querySelectorAll("button")].find((button) =>
    button.textContent?.startsWith("New plan"),
  );
  assert.ok(newPlan, "the home page offers New plan");
  act(() => newPlan.click());
  const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
  assert.equal(dialog?.querySelector("h2")?.textContent, "New plan");
  const cancel = [...(dialog?.querySelectorAll("button") ?? [])].find(
    (button) => button.textContent === "Cancel",
  );
  act(() => cancel?.click());
  assert.equal(document.querySelector('[role="dialog"][aria-modal="true"]'), null);
});

test("while a launch reopens the plan last open, the column draws no home page to flash before it", () => {
  const page = mount(false, true);
  assert.equal(page.querySelector('section[aria-label="Home"]'), null);
});

/** The sidebar's Home row. */
function homeRow(page: HTMLElement): HTMLButtonElement {
  const row = page.querySelector<HTMLButtonElement>("button.sidebar-home");
  assert.ok(row, "the Home row stands");
  return row;
}

test("the sidebar's Home row is the place shown on the home page, and neither over the Inbox nor while a launch reopens a plan", () => {
  assert.equal(homeRow(mount(false)).getAttribute("aria-current"), "page");
  act(() => root?.unmount());
  assert.equal(homeRow(mount(true)).getAttribute("aria-current"), null);
  act(() => root?.unmount());
  assert.equal(homeRow(mount(false, true)).getAttribute("aria-current"), null);
});

test("Home, pressed or by its chord from Settings, brings the Plans tab forward on the home page", () => {
  let home = 0;
  const tabs: PanelTab[] = [];
  mount(false, false, { onGoHome: () => (home += 1) }, PANEL_TAB.SETTINGS, (tab) => tabs.push(tab));
  act(() => runAppCommand(APP_COMMAND.HOME));
  assert.deepEqual([home, tabs], [1, [PANEL_TAB.PLANS]]);
  act(() => root?.unmount());

  const plans = mount(false, false, { onGoHome: () => (home += 1) });
  act(() => homeRow(plans).click());
  assert.equal(home, 2);
});
