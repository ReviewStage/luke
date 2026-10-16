// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import type { Task } from "@luke/features/task-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS } from "@luke/host/acts";
import { EXPERIMENT } from "@luke/settings";
import { SETTINGS_VIEW } from "@luke/settings/settings-views";
import { experimentsOn } from "@luke/settings/testing";
import { UPDATE_STATUS } from "@luke/settings/update";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import { MICROPHONE_STATUS } from "@luke/voice/audio";
import { NOTIFICATIONS_STATUS } from "@luke/voice/settings-controls";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { APP_COMMAND } from "#shared/shortcuts";
import { handState } from "#testing/app-state";
import { layContainersAt } from "#testing/container-width";
import { onRegistry } from "#testing/copy-feedback";
import { DOCUMENT_NAME, DOCUMENT_PLAN } from "#testing/document-plan";
import { plansControl } from "#testing/plans-control";
import { useAct } from "../act";
import { runAppCommand } from "../app-commands";
import { callControls } from "../call/call-card";
import { PANEL_TAB, type PanelTab } from "../panel-tabs";
import { MAIN_TAB } from "../planning/use-main-tabs";
import { AUTOMATIONS_PAGE, type PlansControl } from "../planning/use-plans-tab";
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
  notifications: {
    status: NOTIFICATIONS_STATUS.UNKNOWN,
    packaged: true,
    onOpenSettings: ignore,
    onTest: ignore,
  },
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

/** The shell's props over `plans`, every other door ignored, the sidebar folded unless patched. */
function shellProps(
  plans: PlansControl,
  tab: PanelTab,
  onTabChange: (tab: PanelTab) => void,
  sidebarPatch: Partial<SidebarCollapse>,
): Parameters<typeof DesktopShell>[0] {
  return {
    gates: {
      accountRequired: false,
      onBeginSignIn: ignore,
      onCancelSignIn: ignore,
    },
    tab,
    onTabChange,
    plans,
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
  };
}

/**
 * The window's shell on the home page with the sidebar folded, the Inbox
 * open over it or not, New plan opening its dialog and Cancel putting it
 * away as the tab does.
 */
function mount(
  inboxOpen: boolean,
  restoring = false,
  overrides: Partial<PlansControl> = {},
  tab: PanelTab = PANEL_TAB.TASKS,
  onTabChange: (tab: PanelTab) => void = ignore,
  sidebarPatch: Partial<SidebarCollapse> = {},
  registry = AtomRegistry.make(),
): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const control = plansControl();
  function Shell() {
    const [asked, setAsked] = useState(false);
    const plans = plansControl({
      page: TASKS_PAGE.HOME,
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
    });
    return createElement(DesktopShell, shellProps(plans, tab, onTabChange, sidebarPatch));
  }
  act(() => root?.render(onRegistry(registry, createElement(Shell))));
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

  assert.deepEqual(tabs, [PANEL_TAB.TASKS]);
});

test("with the sidebar folded, New plan stands beside its toggle over the home page and the Inbox alike", () => {
  assert.deepEqual(titleBarButtons(mount(false)), ["Show sidebar", "New task"]);
  act(() => root?.unmount());
  root = undefined;
  assert.deepEqual(titleBarButtons(mount(true)), ["Show sidebar", "New task"]);
});

test("the home page welcomes an account with no plan, and its New plan raises the dialog over the window, which Cancel puts away", () => {
  const page = mount(false);
  const home = page.querySelector('section[aria-label="Home"]');
  assert.ok(home, "the home page stands");
  const newPlan = [...home.querySelectorAll("button")].find((button) =>
    button.textContent?.startsWith("New task"),
  );
  assert.ok(newPlan, "the home page offers New plan");
  act(() => newPlan.click());
  const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
  assert.equal(dialog?.querySelector("h2")?.textContent, "New task");
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
  assert.deepEqual([home, tabs], [1, [PANEL_TAB.TASKS]]);
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

test("the window is called by what stands in it: the plan on screen in its own workspace, else the Inbox, Factory, or Settings, and Luke once signed out", () => {
  const titled = (inboxOpen: boolean, tab: PanelTab, signedIn = true, workspaces = [ACME]) => {
    mount(
      inboxOpen,
      false,
      {
        signedIn,
        workspaces,
        workspace: ACME,
        region: { kind: DOCUMENT_REGION.READY, task: DOCUMENT_PLAN },
      },
      tab,
    );
    const title = document.title;
    act(() => root?.unmount());
    return title;
  };

  assert.deepEqual(
    [
      titled(false, PANEL_TAB.TASKS),
      titled(true, PANEL_TAB.TASKS),
      titled(false, PANEL_TAB.SETTINGS),
      titled(false, PANEL_TAB.TASKS, false),
      titled(false, PANEL_TAB.TASKS, true, [{ ...ACME, id: "workspace-other" }]),
    ],
    [`${DOCUMENT_NAME} — Acme`, "Inbox — Acme", "Settings", "Luke", DOCUMENT_NAME],
  );

  mount(false, false, {
    workspaces: [ACME],
    workspace: ACME,
    factoryView: { open: true, onOpen: ignore, onClose: ignore },
    region: { kind: DOCUMENT_REGION.READY, task: DOCUMENT_PLAN },
  });
  assert.equal(document.title, "Factory — Acme");
});

test("a plan opened on its Inbox tab rather than its own is read at once, its row out of the unread weight, while the window's Inbox standing in its place leaves it unread", () => {
  const unreadOnOpen = (inboxOpen: boolean) => {
    window.localStorage.setItem("luke.planLooks", JSON.stringify({ [DOCUMENT_PLAN.id]: 1 }));
    window.localStorage.setItem("luke.planLooksSeeded", "1");
    const page = mount(
      inboxOpen,
      false,
      {
        page: TASKS_PAGE.DOCUMENT,
        plans: [DOCUMENT_PLAN],
        activePlanId: DOCUMENT_PLAN.id,
        region: { kind: DOCUMENT_REGION.READY, task: DOCUMENT_PLAN },
        mainTabs: {
          ...plansControl().mainTabs,
          tabs: [MAIN_TAB.PLAN, MAIN_TAB.INBOX],
          tab: MAIN_TAB.INBOX,
        },
      },
      PANEL_TAB.TASKS,
      ignore,
      { collapsed: false },
    );
    const row = page.querySelector(".sidebar-plan");
    assert.ok(row, "the plan's row stands in the sidebar");
    const unread = row.getAttribute("data-unread");
    act(() => root?.unmount());
    window.localStorage.clear();
    return unread;
  };

  assert.equal(unreadOnOpen(false), "false");
  assert.equal(unreadOnOpen(true), "true");
});

/** A second plan beside `DOCUMENT_PLAN`, saved after it. */
const NOTES_PLAN: Task = {
  ...DOCUMENT_PLAN,
  id: "0c9a3f1e-6b2d-4e8f-a1c7-3d5e7f9a1b2c",
  name: "Release notes",
  createdAt: 4,
  updatedAt: 5,
};

/**
 * The shell with the sidebar unfolded on `listed`, each looked at up to
 * the instant `looks` gives it, redrawn over whichever plan `open` names
 * next and the home page for none, the same shell throughout.
 */
function mountListing(
  listed: readonly Task[],
  looks: Readonly<Record<string, number>>,
): (open: Task | undefined) => void {
  window.localStorage.setItem("luke.planLooks", JSON.stringify(looks));
  window.localStorage.setItem("luke.planLooksSeeded", "1");
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const registry = AtomRegistry.make();
  return (open) => {
    const plans = plansControl({
      page: open === undefined ? TASKS_PAGE.HOME : TASKS_PAGE.DOCUMENT,
      plans: listed.map((plan) => (plan.id === open?.id ? open : plan)),
      activePlanId: open?.id,
      region:
        open === undefined
          ? { kind: DOCUMENT_REGION.NONE }
          : { kind: DOCUMENT_REGION.READY, task: open },
    });
    const props = shellProps(plans, PANEL_TAB.TASKS, ignore, { collapsed: false });
    act(() => root?.render(onRegistry(registry, createElement(DesktopShell, props))));
  };
}

/** The sidebar's row for the plan of this name. */
function sidebarRow(name: string): HTMLButtonElement {
  const row = [...document.querySelectorAll<HTMLButtonElement>("button.sidebar-plan")].find(
    (each) => each.querySelector(".sidebar-plan-name")?.textContent === name,
  );
  assert.ok(row, `the sidebar lists ${name}`);
  return row;
}

/** Whether the plan's row is drawn in the unread weight. */
function rowUnread(name: string): string | null {
  return sidebarRow(name).getAttribute("data-unread");
}

/** The read mark the row's right-click menu offers, chosen when `choose` says so. */
function rowReadMark(name: string, choose = false): string | undefined {
  act(() => {
    sidebarRow(name).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
  });
  const menu = document.querySelector('[role="menu"]');
  assert.ok(menu, `${name}'s menu opens`);
  const item = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((each) =>
    /^Mark as (un)?read$/u.test(each.textContent ?? ""),
  );
  act(() => {
    if (choose) item?.click();
    else menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  assert.equal(document.querySelector('[role="menu"]') === null, true, "the menu closes");
  return item?.textContent ?? undefined;
}

test("Mark as unread on the task being looked at draws its row unread through a save landing as it stays, and until it is opened again", () => {
  const draw = mountListing([DOCUMENT_PLAN, NOTES_PLAN], {
    [DOCUMENT_PLAN.id]: DOCUMENT_PLAN.updatedAt,
    [NOTES_PLAN.id]: NOTES_PLAN.updatedAt,
  });
  draw(DOCUMENT_PLAN);
  assert.equal(rowUnread(DOCUMENT_NAME), "false");
  assert.equal(rowReadMark(DOCUMENT_NAME, true), "Mark as unread");
  assert.equal(rowUnread(DOCUMENT_NAME), "true");

  draw({ ...DOCUMENT_PLAN, updatedAt: DOCUMENT_PLAN.updatedAt + 1 });
  assert.equal(rowUnread(DOCUMENT_NAME), "true");

  draw(NOTES_PLAN);
  assert.equal(rowUnread(DOCUMENT_NAME), "true");

  draw(DOCUMENT_PLAN);
  assert.equal(rowUnread(DOCUMENT_NAME), "false");
});

test("a task's menu offers Mark as read while its row is unread, which draws it read, and Mark as unread after", () => {
  const draw = mountListing([DOCUMENT_PLAN, NOTES_PLAN], {
    [DOCUMENT_PLAN.id]: DOCUMENT_PLAN.updatedAt,
    [NOTES_PLAN.id]: NOTES_PLAN.updatedAt - 1,
  });
  draw(undefined);
  assert.equal(rowUnread(NOTES_PLAN.name), "true");
  assert.equal(rowReadMark(DOCUMENT_NAME), "Mark as unread");

  assert.equal(rowReadMark(NOTES_PLAN.name, true), "Mark as read");
  assert.equal(rowUnread(NOTES_PLAN.name), "false");
  assert.equal(rowReadMark(NOTES_PLAN.name), "Mark as unread");

  assert.equal(rowReadMark(NOTES_PLAN.name, true), "Mark as unread");
  assert.equal(rowUnread(NOTES_PLAN.name), "true");
  assert.equal(rowReadMark(NOTES_PLAN.name), "Mark as read");
});

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
  const page = mount(false, false, {}, PANEL_TAB.TASKS, ignore, {
    overlay: SIDEBAR_OVERLAY.OPEN,
    onOverlay: (next) => told.push(next),
  });
  await settle();
  const row = page.querySelector<HTMLButtonElement>(".sidebar-factory");
  assert.ok(row);
  act(() => row.click());
  assert.deepEqual(told, [SIDEBAR_OVERLAY.CLOSED]);
});

test("the Automations page's sidebar row and its command stand only while the account has its experiment on", async () => {
  handState({});
  const off = mount(false);
  await settle();
  assert.equal(off.querySelector(".sidebar-automations"), null);
  assert.equal(runAppCommand(APP_COMMAND.AUTOMATIONS), false);
  act(() => root?.unmount());
  document.body.innerHTML = "";

  handState(experimentsOn(EXPERIMENT.AUTOMATIONS));
  const on = mount(false);
  await settle();
  assert.ok(on.querySelector(".sidebar-automations"));
  assert.equal(runAppCommand(APP_COMMAND.AUTOMATIONS), true);
});

test("Escape pressed while the Automations pages are still loading closes Automations, as the list does once it stands", async () => {
  const closed: string[] = [];
  const automationsView = {
    open: false,
    place: { kind: AUTOMATIONS_PAGE.LIST } as const,
    onOpen: ignore,
    onClose: () => closed.push("closed"),
  };
  const registry = AtomRegistry.make();
  handState(experimentsOn(EXPERIMENT.AUTOMATIONS));
  mount(
    false,
    false,
    { workspaces: [ACME], workspace: ACME, automationsView },
    PANEL_TAB.TASKS,
    ignore,
    {},
    registry,
  );
  await settle();
  act(() => root?.unmount());
  document.body.innerHTML = "";

  // Note that the window's state has landed in the registry, so Automations opens within one render, before their chunk can.
  const page = mount(
    false,
    false,
    { workspaces: [ACME], workspace: ACME, automationsView: { ...automationsView, open: true } },
    PANEL_TAB.TASKS,
    ignore,
    {},
    registry,
  );
  const loading = page.querySelector("section[aria-label=Automations]");
  assert.ok(loading, "the pages' frame stands");
  assert.equal(loading.childElementCount, 0, "their chunk has not loaded yet");
  act(() => {
    assert.ok(runAppCommand(APP_COMMAND.EXIT_AUTOMATIONS), "Automations' way out is offered");
  });

  assert.deepEqual(closed, ["closed"]);
});

test("the Automations page stands in the plan's place, titled for the listed workspace, and gives it back once its experiment is off", async () => {
  const closed: string[] = [];
  const automationsView = {
    open: true,
    place: { kind: AUTOMATIONS_PAGE.LIST } as const,
    onOpen: ignore,
    onClose: () => closed.push("closed"),
  };
  const overrides = {
    workspaces: [ACME],
    workspace: ACME,
    automationsView,
    region: { kind: DOCUMENT_REGION.READY, task: DOCUMENT_PLAN },
  };

  handState(experimentsOn(EXPERIMENT.AUTOMATIONS));
  const on = mount(false, false, overrides);
  await settle();
  assert.ok(on.querySelector("section[aria-label=Automations]"));
  assert.equal(document.title, "Automations — Acme");
  act(() => root?.unmount());
  document.body.innerHTML = "";
  closed.length = 0;

  handState({});
  const off = mount(false, false, overrides);
  await settle();
  assert.equal(off.querySelector("section[aria-label=Automations]"), null);
  assert.deepEqual(closed, ["closed"]);
});

/** The plan the call in progress is about, which none of the places below shows with its call bar. */
const CALL_PLAN_NAME = "Checkout redesign";

/** Every place in the window the developer can stand while a call goes on about another plan, as the shell is handed it. */
const PLACE = {
  HOME: "home",
  OTHER_PLAN: "another plan",
  INBOX: "the Inbox",
  AGENT_PAGE: "an agent's page",
  PERSON_PAGE: "a person's page",
  FACTORY: "Factory",
  AUTOMATIONS: "the Automations page",
  SIDE_PANEL_FULL_SCREEN: "a side panel filling the window",
  SETTINGS: "Settings",
  VERSION_HISTORY: "a plan's version history",
} as const;

type Place = (typeof PLACE)[keyof typeof PLACE];

/** The column at the window's left in each place: the plans' sidebar, which folds, or a column of the place's own, which does not. */
const LEFT_COLUMN = {
  [PLACE.HOME]: { selector: "aside.desktop-sidebar", folds: true },
  [PLACE.OTHER_PLAN]: { selector: "aside.desktop-sidebar", folds: true },
  [PLACE.INBOX]: { selector: "aside.desktop-sidebar", folds: true },
  [PLACE.AGENT_PAGE]: { selector: "aside.desktop-sidebar", folds: true },
  [PLACE.PERSON_PAGE]: { selector: "aside.desktop-sidebar", folds: true },
  [PLACE.FACTORY]: { selector: "aside.desktop-sidebar", folds: true },
  [PLACE.AUTOMATIONS]: { selector: "aside.desktop-sidebar", folds: true },
  [PLACE.SIDE_PANEL_FULL_SCREEN]: { selector: "aside.desktop-sidebar", folds: true },
  [PLACE.SETTINGS]: { selector: 'nav[aria-label="Settings pages"]', folds: false },
  [PLACE.VERSION_HISTORY]: { selector: 'nav[aria-label="Versions"]', folds: false },
} as const satisfies Record<Place, { selector: string; folds: boolean }>;

/** The tab and the plans' state that stand the window in a place. */
function placed(place: Place) {
  const control = plansControl();
  const onPlan = {
    page: TASKS_PAGE.DOCUMENT,
    region: { kind: DOCUMENT_REGION.READY, task: DOCUMENT_PLAN },
  } as const;
  const plans = {
    [PLACE.HOME]: { page: TASKS_PAGE.HOME },
    [PLACE.OTHER_PLAN]: onPlan,
    [PLACE.INBOX]: { inboxView: { ...control.inboxView, open: true } },
    [PLACE.AGENT_PAGE]: { agentView: { ...control.agentView, agentId: "agent-page-1" } },
    [PLACE.PERSON_PAGE]: { personView: { ...control.personView, userId: "user-charles" } },
    [PLACE.FACTORY]: { factoryView: { ...control.factoryView, open: true } },
    [PLACE.AUTOMATIONS]: { automationsView: { ...control.automationsView, open: true } },
    [PLACE.SIDE_PANEL_FULL_SCREEN]: {
      ...onPlan,
      sidePanel: { ...control.sidePanel, open: true, fullScreen: true },
    },
    [PLACE.SETTINGS]: { page: TASKS_PAGE.HOME },
    [PLACE.VERSION_HISTORY]: { ...onPlan, history: { ...control.history, open: true } },
  } satisfies Record<Place, Partial<PlansControl>>;
  return {
    tab: place === PLACE.SETTINGS ? PANEL_TAB.SETTINGS : PANEL_TAB.TASKS,
    plans: plans[place],
  };
}

/** The shell standing in a place with a call in progress about another plan, its card's presses sent as `App` sends them. */
function CallShell({ place, folded }: { place: Place; folded: boolean }): React.JSX.Element {
  const { tell } = useAct();
  const { tab, plans } = placed(place);
  return createElement(DesktopShell, {
    gates: {
      accountRequired: false,
      onBeginSignIn: ignore,
      onCancelSignIn: ignore,
    },
    tab,
    onTabChange: ignore,
    plans: plansControl(plans),
    history: {
      canGoBack: false,
      canGoForward: false,
      onBack: ignore,
      onForward: ignore,
      onLeaveVersionHistory: ignore,
    },
    sidebar: {
      collapsed: folded,
      compact: false,
      overlay: SIDEBAR_OVERLAY.CLOSED,
      width: 264,
      onToggle: ignore,
      onOverlay: ignore,
      onResize: ignore,
      staged: false,
    },
    call: {
      card: { taskName: CALL_PLAN_NAME, status: undefined, microphoneMuted: false },
      speakerMuted: false,
      controls: callControls(tell, false),
    },
    captions: {
      caption: { content: undefined, shown: false },
      volumeHint: { wanted: false, text: "", onDismiss: ignore },
    },
    settings: SETTINGS,
  });
}

/** Every act the window sent over the bridge, by kind, in order. */
let sentActs: string[] = [];

/**
 * The bridge as the window meets it, every act written down, with Factory
 * and the Automations page on, and Settings' chunk already loaded, as it is
 * once Settings has opened once, so it stands within a settle.
 */
async function handBridge(): Promise<void> {
  await import("./desktop-settings");
  handState(experimentsOn(EXPERIMENT.FACTORY, EXPERIMENT.AUTOMATIONS));
  sentActs = [];
  const bridge = window.luke;
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      ...bridge,
      act: (request: { kind: string }) => {
        sentActs.push(request.kind);
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." });
      },
    },
  });
}

/** Where the window draws the call card: on which surface, and whether at the foot of the column at the window's left. */
function cardStanding(page: HTMLElement, place: Place) {
  const cards = page.querySelectorAll<HTMLElement>('section.call-card[aria-label="Call"]');
  assert.equal(cards.length, 1, `one call card stands over ${place}`);
  const [card] = cards;
  assert.ok(card);
  const foot = card.closest(".sidebar-foot");
  return {
    surface: card.dataset.surface ?? "",
    docked: foot !== null && foot.parentElement === page.querySelector(LEFT_COLUMN[place].selector),
  };
}

/** Presses the card's way back to the call's plan. */
function pressReturn(page: HTMLElement): void {
  const button = page.querySelector<HTMLButtonElement>(
    `section.call-card button[aria-label="Open ${CALL_PLAN_NAME}"]`,
  );
  assert.ok(button, "the card offers the way back to the call's plan");
  act(() => button.click());
}

const PLACES = Object.values(PLACE);

test("the side panel's toggle stands on a plan and on an agent's page, which keeps a panel of its own, and nowhere else the plan's place is taken", async () => {
  await handBridge();
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const registry = AtomRegistry.make();
  const toggled: Partial<Record<Place, boolean>> = {};
  for (const place of PLACES) {
    act(() =>
      root?.render(onRegistry(registry, createElement(CallShell, { place, folded: false }))),
    );
    await settle();
    toggled[place] = container.querySelector("button.side-panel-toggle") !== null;
  }
  assert.deepEqual(toggled, {
    [PLACE.HOME]: false,
    [PLACE.OTHER_PLAN]: true,
    [PLACE.INBOX]: false,
    [PLACE.AGENT_PAGE]: true,
    [PLACE.PERSON_PAGE]: false,
    [PLACE.FACTORY]: false,
    [PLACE.AUTOMATIONS]: false,
    [PLACE.SIDE_PANEL_FULL_SCREEN]: true,
    [PLACE.SETTINGS]: false,
    [PLACE.VERSION_HISTORY]: false,
  });
});

test("⌘F opens a find over every page that stands in the window, and Settings keeps it for its own search", async () => {
  await handBridge();
  const found: Partial<Record<Place, boolean>> = {};
  for (const place of PLACES) {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() =>
      root?.render(
        onRegistry(AtomRegistry.make(), createElement(CallShell, { place, folded: false })),
      ),
    );
    await settle();
    act(() => {
      runAppCommand(APP_COMMAND.FIND);
    });
    found[place] = container.querySelector("search[aria-label='Find']") !== null;
    act(() => root?.unmount());
    container.remove();
  }
  assert.deepEqual(found, {
    [PLACE.HOME]: true,
    [PLACE.OTHER_PLAN]: true,
    [PLACE.INBOX]: true,
    // Note that this agent is never read here, and an agent's page finds once its agent is drawn (`desktop-agent-page.test.ts`).
    [PLACE.AGENT_PAGE]: false,
    [PLACE.PERSON_PAGE]: true,
    [PLACE.FACTORY]: true,
    [PLACE.AUTOMATIONS]: true,
    // Note that the panel filling the window holds the keys, on its Board, whose canvas no find reads.
    [PLACE.SIDE_PANEL_FULL_SCREEN]: false,
    [PLACE.SETTINGS]: false,
    [PLACE.VERSION_HISTORY]: true,
  });
});

test("walking every place in the window during a call about another plan, the card stays at the foot of the column at the window's left, and its way back asks for the call's plan from each", async () => {
  await handBridge();
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const registry = AtomRegistry.make();
  const standing: Record<string, ReturnType<typeof cardStanding>> = {};
  for (const place of PLACES) {
    act(() =>
      root?.render(onRegistry(registry, createElement(CallShell, { place, folded: false }))),
    );
    await settle();
    standing[place] = cardStanding(container, place);
    sentActs = [];
    pressReturn(container);
    assert.deepEqual(sentActs, [ACT_KIND.CALL_SHOW_TASK], `the way back from ${place}`);
  }
  assert.deepEqual(
    standing,
    Object.fromEntries(PLACES.map((place) => [place, { surface: "sidebar", docked: true }])),
  );
});

test("with the plans' sidebar folded, the card floats in the window's corner wherever the sidebar would have held it, and stays at the foot of Settings' and a version history's own columns, which do not fold", async () => {
  await handBridge();
  const standing: Record<string, ReturnType<typeof cardStanding>> = {};
  for (const place of PLACES) {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() =>
      root?.render(
        onRegistry(AtomRegistry.make(), createElement(CallShell, { place, folded: true })),
      ),
    );
    await settle();
    standing[place] = cardStanding(container, place);
    sentActs = [];
    pressReturn(container);
    assert.deepEqual(sentActs, [ACT_KIND.CALL_SHOW_TASK], `the way back from ${place}`);
    act(() => root?.unmount());
    container.remove();
  }
  assert.deepEqual(
    standing,
    Object.fromEntries(
      PLACES.map((place) => [
        place,
        LEFT_COLUMN[place].folds
          ? { surface: "floating", docked: false }
          : { surface: "sidebar", docked: true },
      ]),
    ),
  );
});

test("no place the window stands on can be scrolled sideways into the room its bars draw past the column's edges, folded sidebar or not", async () => {
  await handBridge();
  // Note that the window's stylesheets are laid once, because jsdom takes seconds to lay them.
  const style = layContainersAt({});
  const clipped: Record<string, string> = {};
  for (const folded of [false, true]) {
    for (const place of PLACES) {
      const container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
      act(() =>
        root?.render(onRegistry(AtomRegistry.make(), createElement(CallShell, { place, folded }))),
      );
      await settle();
      const shell = container.querySelector(".desktop-shell");
      assert.ok(shell, `${place} stands in the window's shell`);
      clipped[`${place}${folded ? ", folded" : ""}`] = getComputedStyle(shell).overflow;
      act(() => root?.unmount());
      container.remove();
    }
  }
  style.remove();
  assert.deepEqual(
    clipped,
    Object.fromEntries(Object.keys(clipped).map((place) => [place, "clip"])),
  );
}, 60_000);
