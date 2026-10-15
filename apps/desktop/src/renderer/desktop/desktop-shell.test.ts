// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { ACCOUNT_CHAT_REASON, type AccountChatEntry } from "@luke/features/account-inbox-wire";
import { IDLE_PLANNING_VIEW } from "@luke/features/planning-view";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { WINDOW_ROLE } from "@luke/gateway/window-session";
import { EXPERIMENT, type ExperimentChoices } from "@luke/settings";
import { SETTINGS_VIEW } from "@luke/settings/settings-views";
import { appSettingsWire, experimentsOn, settingsView } from "@luke/settings/testing";
import { UPDATE_STATUS } from "@luke/settings/update";
import { MICROPHONE_STATUS } from "@luke/voice/audio";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { ACT_OUTCOME_STATUS } from "#shared/messages/acts";
import type { AppStateSnapshot } from "#shared/messages/app-state";
import { APP_COMMAND } from "#shared/shortcuts";
import { onRegistry } from "#testing/copy-feedback";
import { DOCUMENT_NAME, DOCUMENT_PLAN } from "#testing/document-plan";
import { plansControl } from "#testing/plans-control";
import { runAppCommand } from "../app-commands";
import { PANEL_TAB, type PanelTab } from "../panel-tabs";
import { fixtureChat } from "../planning/chat-fixture";
import { DOCUMENT_REGION, PLANS_PAGE } from "../planning/planning-model";
import type { PlansControl } from "../planning/use-plans-tab";
import type { SettingsPanelProps } from "../settings/settings-panel";
import { DesktopShell } from "./desktop-shell";
import { SIDEBAR_OVERLAY, type SidebarCollapse } from "./sidebar-collapse";

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
 * The window's shell on the home page with the sidebar folded, Chat open
 * over it or not, New plan opening its dialog and Cancel putting it
 * away as the tab does.
 */
function mount(
  chatOpen: boolean,
  restoring = false,
  overrides: Partial<PlansControl> = {},
  tab: PanelTab = PANEL_TAB.PLANS,
  onTabChange: (tab: PanelTab) => void = ignore,
  sidebarPatch: Partial<SidebarCollapse> = {},
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
        chatView: { ...control.chatView, open: chatOpen, available: chatOpen },
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
      sidebar: {
        collapsed: true,
        compact: false,
        overlay: SIDEBAR_OVERLAY.CLOSED,
        width: 264,
        onToggle: ignore,
        onOverlay: ignore,
        onResize: ignore,
        staged: false,
        ...sidebarPatch,
      },
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

test("Escape pressed while Settings is still loading leaves Settings for the plans, as it does once Settings stands", () => {
  const tabs: PanelTab[] = [];
  mount(false, false, {}, PANEL_TAB.SETTINGS, (tab) => tabs.push(tab));

  act(() => {
    assert.ok(runAppCommand(APP_COMMAND.EXIT_SETTINGS), "Settings' way out is offered");
  });

  assert.deepEqual(tabs, [PANEL_TAB.PLANS]);
});

test("with the sidebar folded, New plan stands beside its toggle over the home page and Chat alike", () => {
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

test("the sidebar's Home row is the place shown on the home page, and neither over Chat nor while a launch reopens a plan", () => {
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

const ACME: Workspace = {
  id: DOCUMENT_PLAN.workspaceId,
  name: "Acme",
  slug: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
};

test("the window is called by what stands in it: the plan on screen in its own workspace, else Chat, Factory, or Settings, and Luke once signed out", () => {
  const titled = (chatOpen: boolean, tab: PanelTab, signedIn = true, workspaces = [ACME]) => {
    mount(
      chatOpen,
      false,
      {
        signedIn,
        workspaces,
        workspace: ACME,
        region: { kind: DOCUMENT_REGION.READY, plan: DOCUMENT_PLAN },
      },
      tab,
    );
    const title = document.title;
    act(() => root?.unmount());
    return title;
  };

  assert.deepEqual(
    [
      titled(false, PANEL_TAB.PLANS),
      titled(true, PANEL_TAB.PLANS),
      titled(false, PANEL_TAB.SETTINGS),
      titled(false, PANEL_TAB.PLANS, false),
      titled(false, PANEL_TAB.PLANS, true, [{ ...ACME, id: "workspace-other" }]),
    ],
    [`${DOCUMENT_NAME} — Acme`, "Chat — Acme", "Settings", "Luke", DOCUMENT_NAME],
  );

  mount(false, false, {
    workspaces: [ACME],
    workspace: ACME,
    factoryView: { open: true, onOpen: ignore, onClose: ignore },
    region: { kind: DOCUMENT_REGION.READY, plan: DOCUMENT_PLAN },
  });
  assert.equal(document.title, "Factory — Acme");
});

/** The panel's snapshot of main's document with the account's experiments as given, everything else as a launch begins it. */
function snapshotWith(experiments: ExperimentChoices): AppStateSnapshot {
  return {
    version: 1,
    run: {
      profile: "test",
      packaged: false,
      platform: "darwin",
      appVersion: "1.0.0",
      captureMode: false,
      fixtureMode: false,
      accountRequired: false,
      agentTraceEnabled: false,
    },
    settings: appSettingsWire(settingsView({ experiments })),
    account: SETTINGS.account,
    update: {
      status: UPDATE_STATUS.IDLE,
      currentVersion: "1.0.0",
      installSupported: true,
      upToDate: false,
    },
    audio: { microphoneStatus: MICROPHONE_STATUS.GRANTED },
    hotkeys: { talkHeld: true },
    voice: {},
    planning: IDLE_PLANNING_VIEW,
    codingAgents: { unseen: [] },
    chat: { waiting: [] },
    notifications: { refused: false },
    sessionReplay: { permitted: false, halted: false },
    window: { role: WINDOW_ROLE.PANEL, fullScreen: false },
  };
}

/** Main's document as the bridge hands it, with the account's experiments as given. */
function handState(experiments: ExperimentChoices): void {
  const snapshot = snapshotWith(experiments);
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      ...window.luke,
      onAppState: () => () => undefined,
      requestAppState: () => Promise.resolve(snapshot),
    },
  });
}

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

test("Factory's sidebar row and its command stand only while the account has its experiment on", async () => {
  handState({});
  const off = mount(false);
  await settle();
  assert.equal(off.querySelector(".sidebar-factory"), null);
  assert.equal(runAppCommand(APP_COMMAND.FACTORY), false);
  act(() => root?.unmount());
  document.body.innerHTML = "";

  handState(experimentsOn(EXPERIMENT.FACTORY));
  const on = mount(false);
  await settle();
  assert.ok(on.querySelector(".sidebar-factory"));
  assert.equal(runAppCommand(APP_COMMAND.FACTORY), true);
});

test("a press on Factory's row in a floating sidebar puts the sidebar away, as every row's does", async () => {
  handState(experimentsOn(EXPERIMENT.FACTORY));
  const told: SidebarCollapse["overlay"][] = [];
  const page = mount(false, false, {}, PANEL_TAB.PLANS, ignore, {
    overlay: SIDEBAR_OVERLAY.OPEN,
    onOverlay: (next) => told.push(next),
  });
  await settle();
  const row = page.querySelector<HTMLButtonElement>(".sidebar-factory");
  assert.ok(row);
  act(() => row.click());
  assert.deepEqual(told, [SIDEBAR_OVERLAY.CLOSED]);
});

/** An ask main's read of the account says waits on the developer. */
const WAITING_ASK: AccountChatEntry = {
  messageId: "10000000-0000-4000-8000-000000000001",
  seq: 1,
  workspaceId: DOCUMENT_PLAN.workspaceId,
  reason: ACCOUNT_CHAT_REASON.ASK,
  from: "invites-agent",
  planId: DOCUMENT_PLAN.id,
  touchedSeq: 1,
  updatedAt: 1,
};

/** The sidebar's Chat row, where one stands. */
function chatRow(page: HTMLElement): HTMLButtonElement | undefined {
  return [...page.querySelectorAll<HTMLButtonElement>("button.sidebar-chat")].find((button) =>
    button.textContent?.startsWith("Chat"),
  );
}

test("the sidebar's Chat row stands where the Inbox's did, counts what waits on the developer by main's read or Chat's own, and opens Chat in the plan's place, which it marks while Home's row is not", () => {
  const signedOut = chatRow(mount(false, false, { signedIn: false }));
  assert.equal(signedOut?.disabled, true, "signed out, Chat stands but cannot open");
  act(() => root?.unmount());
  const waiting = chatRow(mount(false, false, { chatWaiting: [WAITING_ASK] }));
  assert.equal(waiting?.textContent, "Chat1 waiting on you⇧⌘I");
  act(() => root?.unmount());

  let opened = 0;
  const chat = fixtureChat({ fixtureMode: true }, 0);
  const view = { ...plansControl().chatView, available: true, chat, onOpen: () => (opened += 1) };
  const page = mount(false, false, { chatView: view });
  const row = chatRow(page);
  assert.equal(row?.textContent, "Chat4 waiting on you⇧⌘I");
  assert.equal(row?.getAttribute("aria-current"), null);
  act(() => row?.click());
  assert.equal(opened, 1);
  act(() => root?.unmount());

  const open = mount(false, false, { chatView: { ...view, open: true } });
  assert.equal(chatRow(open)?.getAttribute("aria-current"), "page");
  assert.equal(homeRow(open).getAttribute("aria-current"), null);
  assert.ok(open.querySelector(".desktop-main > .chat-view"), "Chat stands in the plan's place");
});
