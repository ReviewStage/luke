// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS } from "@sidecar/credentials/snapshot";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { ACT_OUTCOME_STATUS } from "#shared/messages/acts";
import { MICROPHONE_STATUS } from "#shared/messages/audio";
import { UPDATE_STATUS } from "#shared/messages/update";
import { onRegistry } from "#testing/copy-feedback";
import { plansControl } from "#testing/plans-control";
import { PANEL_TAB } from "../panel-tabs";
import { PLANS_PAGE } from "../planning/planning-model";
import type { SettingsPanelProps } from "../settings/settings-panel";
import { SETTINGS_VIEW } from "../settings-views";
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
  view: SETTINGS_VIEW.ROOT,
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
  Object.defineProperty(window, "sidecar", {
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

/** The window's shell on the new-plan page with the sidebar folded, the Inbox open over it or not. */
function mount(inboxOpen: boolean): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const shell = createElement(DesktopShell, {
    gates: {
      accountRequired: false,
      onBeginSignIn: ignore,
      onCancelSignIn: ignore,
      signInFace: { play: 0 },
    },
    tab: PANEL_TAB.PLANS,
    onTabChange: ignore,
    plans: plansControl({
      page: PLANS_PAGE.NEW,
      inboxView: {
        open: inboxOpen,
        chosen: undefined,
        onOpen: ignore,
        onClose: ignore,
        onChoose: ignore,
      },
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
  act(() => root?.render(onRegistry(AtomRegistry.make(), shell)));
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

test("with the sidebar folded, New plan stands beside its toggle over the Inbox, though the new-plan page beneath it leaves New plan out", () => {
  assert.deepEqual(titleBarButtons(mount(false)), ["Show sidebar"]);
  act(() => root?.unmount());
  root = undefined;
  assert.deepEqual(titleBarButtons(mount(true)), ["Show sidebar", "New plan"]);
});
