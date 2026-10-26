// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { PLAN_ACTOR } from "@luke/features/task-wire";
import { SETTINGS_VIEW, type SettingsLink } from "@luke/settings/settings-views";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { UPDATE_STATUS } from "@luke/settings/update";
import { PROFILE } from "@luke/ui";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import { MICROPHONE_STATUS } from "@luke/voice/audio";
import { NOTIFICATIONS_STATUS } from "@luke/voice/settings-controls";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, onTestFinished, test, vi } from "vitest";
import { runAppCommand } from "../app-commands.js";
import { PANEL_TAB, type PanelTab } from "../panel-tabs.js";
import type { SettingsPanelProps } from "../settings/settings-panel.js";
import { followSettingsLink, useSettingsPlace } from "../settings-link.js";
import { useStageRoom } from "../stage-room.js";
import {
  type HistorySpot,
  type PlanHistorySource,
  usePlanHistory,
} from "../tasks/use-plan-history.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { DESKTOP_CAPABILITIES } from "../testing/app-state.js";
import { layContainersAt, shown } from "../testing/container-width.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { DOCUMENT_TASK } from "../testing/document-task.js";
import { pixelsOf, wayBackGap } from "../testing/laid-length.js";
import { relayout } from "../testing/resize-observer.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { tasksControl } from "../testing/tasks-control.js";
// Note that Settings is loaded as the shell loads it, on first use, so the
// module is read here first and its load settles within the test's own ticks.
import "./desktop-settings.js";
import { DesktopShell } from "./desktop-shell.js";
import { useSidebarCollapse } from "./sidebar-collapse.js";

/**
 * narrow-screens.test.ts -- on a stage as narrow as a phone's, Settings and a
 * plan's version history each show their list or the item chosen
 * in it, one at a time and the whole width: each opens on its list, a row
 * pressed stands its item alone under a way back to the list, and a link to
 * an item opens on it with the same way back. The focus goes with each swap:
 * to the item's way back, and back to the row chosen. The desktop's width
 * keeps both columns side by side, with no way back drawn, and the focus where
 * it was. A Settings page standing alone on a phone is named by its bar and
 * opens a section's gap under the way back, over the places bar. A synthetic
 * plan, no account of anyone's.
 */

const ignore = () => undefined;
const accepted = () => Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });

/** A signed-in account's Settings, its page and its presses given by the window. */
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
};

/** The desktop's window at its usual width. */
const WIDE = 1280;

/** A phone's width. */
const PHONE = 390;

/** A stage wide enough for the window's panes side by side, though under the split's line for a screen that fills it, as a narrow Mac window or browser tab is. */
const UNDER_SPLIT = 800;

/** The screens that take the whole window, and so are as wide as the stage they fill. */
const WHOLE_WINDOW_SCREENS = ["app-stage", "desktop-settings", "desktop-version-history"];

/** A revision of the plan by the notetaker. */
function line(seq: number) {
  return {
    seq,
    lastEdit: { actor: PLAN_ACTOR.NOTETAKER, at: 10 * seq, duringCall: true },
    startedAt: 10 * seq,
    changes: 2,
  };
}

/** The plan's history as the service answers it: two revisions, each the plan as it stands. */
const HISTORY: PlanHistorySource = {
  readPage: () => Promise.resolve({ revisions: [line(3), line(2)] }),
  readRevision: (_taskId, seq) =>
    Promise.resolve({
      revision: { seq, document: DOCUMENT_TASK.document, previous: DOCUMENT_TASK.document },
    }),
  restore: () => Promise.resolve(false),
};

let root: Root | undefined;
let sheets: HTMLStyleElement | undefined;

/** How wide the panel's stage is laid out, which jsdom, laying out nothing, leaves to the test. */
let stageWidth = 0;

beforeEach(() => {
  window.localStorage.clear();
  installScrollIntoView();
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
  sheets = layContainersAt({});
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  sheets?.remove();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

/** The shell on the stage, as the panel's root draws it: the stage measured, its room, and the real sidebar. */
function Shell({
  tab,
  tasks,
  settings = SETTINGS,
  settingsStep = { listed: true, onList: ignore },
}: {
  tab: PanelTab;
  tasks: TasksControl;
  settings?: SettingsPanelProps;
  settingsStep?: { listed: boolean; onList: () => void };
}): React.JSX.Element {
  const stage = useStageRoom();
  const room = stage.room;
  const sidebar = useSidebarCollapse(false, stage.compact);
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
    sidebar,
    room,
    settingsStep,
    settings,
  });
  return createElement("div", { ref: stage.ref, className: "app-stage" }, shell);
}

/** Settings as the window holds it, opened plainly or by the link given, as the window's root opens it. */
function SettingsWindow({ link }: { link: SettingsLink | undefined }): React.JSX.Element {
  const place = useSettingsPlace();
  const [tab, setTab] = useState<PanelTab>(PANEL_TAB.TASKS);
  const { onEnter, onChoose } = place;
  useEffect(() => {
    // The root's tab switch enters Settings on its list, as `App`'s does.
    const changeTab = (next: PanelTab) => {
      setTab(next);
      onEnter();
    };
    if (link === undefined) changeTab(PANEL_TAB.SETTINGS);
    else followSettingsLink(link, { changeTab, changeView: onChoose, chooseWorkspace: ignore });
  }, [link, onEnter, onChoose]);
  return createElement(Shell, {
    tab,
    tasks: tasksControl(),
    settings: { ...SETTINGS, view: place.view, onViewChange: place.onChoose },
    settingsStep: place,
  });
}

/** The version history the last window drew, which the window's history moves as it goes back and forth. */
let standingVersions: ReturnType<typeof usePlanHistory> | undefined;

/** The plan's version history over the window, opened on the plan as it stands or where `returnTo` says. */
function HistoryWindow({ returnTo }: { returnTo: HistorySpot | undefined }): React.JSX.Element {
  const versions = usePlanHistory({
    source: HISTORY,
    taskId: DOCUMENT_TASK.id,
    editedAt: undefined,
    name: DOCUMENT_TASK.name,
    shown: true,
    seek: undefined,
    returnTo,
    onRestored: ignore,
  });
  standingVersions = versions;
  const base = tasksControl();
  const tasks = tasksControl({
    page: TASKS_PAGE.DOCUMENT,
    activeTaskId: DOCUMENT_TASK.id,
    region: { kind: DOCUMENT_REGION.READY, task: DOCUMENT_TASK },
    history: { ...base.history, ...versions, open: true },
  });
  return createElement(Shell, { tab: PANEL_TAB.TASKS, tasks });
}

/** Draws the window on a stage of a width, and lets what it reads land. */
async function mount(width: number, window: React.JSX.Element): Promise<HTMLElement> {
  stageWidth = width;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const fills = WHOLE_WINDOW_SCREENS.some((name) => this.classList.contains(name));
    return DOMRect.fromRect({ width: fills ? stageWidth : 0 });
  });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(onRegistry(AtomRegistry.make(), window)));
  await settle();
  return container;
}

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** Resizes the panel's stage, as a phone turned or a browser window dragged does. */
function resizeStage(width: number): void {
  stageWidth = width;
  act(() => relayout());
}

/** The element a selector names, which must stand. */
function the(page: HTMLElement, selector: string): HTMLElement {
  return page.querySelector<HTMLElement>(selector) ?? assert.fail(`${selector} stands`);
}

/** Which of a screen's two columns are on screen, by the names given them. */
function onScreen(page: HTMLElement, columns: Readonly<Record<string, string>>): string[] {
  return Object.entries(columns)
    .filter(([, selector]) => shown(the(page, selector)))
    .map(([name]) => name);
}

/** What a control is named: its words, folded or not, or its label where it has no words. */
function controlName(control: Element | null | undefined): string | null {
  return control?.textContent?.trim() || control?.getAttribute("aria-label") || null;
}

/** The button in `within` that says `words`, by its words or its name, or none. */
function buttonSaying(within: HTMLElement, words: string): HTMLButtonElement | undefined {
  // Note that a phone's way back is its glyph alone, so it says its words by its name.
  return [...within.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === words || button.getAttribute("aria-label") === words,
  );
}

/** Presses the button in `within` that says `words`. */
function press(within: HTMLElement, words: string): void {
  const button = buttonSaying(within, words) ?? assert.fail(`a button says ${words}`);
  act(() => button.click());
}

const SETTINGS_COLUMNS = {
  list: 'nav[aria-label="Settings pages"]',
  page: "section.settings-page",
};

test("Settings on a narrow stage opens on its page list, a page chosen stands alone under a way back, and Back returns to the list", async () => {
  const page = await mount(PHONE, createElement(SettingsWindow, { link: undefined }));
  assert.deepEqual(onScreen(page, SETTINGS_COLUMNS), ["list"]);
  assert.equal(
    getComputedStyle(the(page, ".desktop-shell")).gridTemplateColumns,
    "minmax(0, 1fr)",
    "the list is the shell's one column",
  );

  press(the(page, SETTINGS_COLUMNS.list), "Appearance");
  assert.deepEqual(onScreen(page, SETTINGS_COLUMNS), ["page"]);
  assert.equal(the(page, SETTINGS_COLUMNS.page).getAttribute("aria-label"), "Appearance");

  press(the(page, SETTINGS_COLUMNS.page), "Settings");
  assert.deepEqual(onScreen(page, SETTINGS_COLUMNS), ["list"]);

  press(the(page, SETTINGS_COLUMNS.list), "Appearance");
  resizeStage(WIDE);
  assert.deepEqual(
    onScreen(page, SETTINGS_COLUMNS),
    ["list", "page"],
    "the desktop's width stands the list beside the page again",
  );
  assert.equal(buttonSaying(the(page, SETTINGS_COLUMNS.page), "Settings"), undefined);
});

test("a Settings page standing alone on a phone is named by its bar, opens a section's gap under the way back, and keeps the places bar with no place current", async () => {
  // Note that the stage wears the web's profile, whose tokens the gap is read in.
  document.documentElement.dataset.lukeProfile = PROFILE.WEB;
  onTestFinished(() => {
    delete document.documentElement.dataset.lukeProfile;
  });
  const page = await mount(PHONE, createElement(SettingsWindow, { link: undefined }));
  press(the(page, SETTINGS_COLUMNS.list), "Appearance");
  const item = the(page, SETTINGS_COLUMNS.page);
  const bar = the(item, 'header[data-look="phone"]');
  assert.equal(bar.querySelector("h1")?.textContent, "Appearance", "the bar names the page");
  assert.equal(item.querySelectorAll("h1").length, 1, "the page draws no second heading");

  const column = the(item, ".luke-settings-page-column");
  assert.equal(
    wayBackGap(bar, column),
    pixelsOf(column, "var(--luke-section-gap)"),
    "the page's first line stands a section's gap under the way back",
  );

  const places = the(page, 'nav[aria-label="Places"]');
  assert.deepEqual([...places.querySelectorAll("button")].map(controlName), [
    "Channels",
    "Tasks",
    "More",
  ]);
  assert.equal(places.querySelector('[aria-current="page"]'), null, "no place is current");
});

test("Settings on a stage wide enough for panes, but under the split's line by its own width, shows its list, then a page chosen alone under a way back, and splits again once wide", async () => {
  const page = await mount(UNDER_SPLIT, createElement(SettingsWindow, { link: undefined }));
  assert.equal(the(page, ".desktop-shell").dataset["room"], "wide", "the stage is no phone's");
  assert.deepEqual(onScreen(page, SETTINGS_COLUMNS), ["list"]);

  press(the(page, SETTINGS_COLUMNS.list), "Appearance");
  assert.deepEqual(onScreen(page, SETTINGS_COLUMNS), ["page"]);

  press(the(page, SETTINGS_COLUMNS.page), "Settings");
  assert.deepEqual(onScreen(page, SETTINGS_COLUMNS), ["list"]);

  press(the(page, SETTINGS_COLUMNS.list), "Appearance");
  resizeStage(WIDE);
  assert.deepEqual(onScreen(page, SETTINGS_COLUMNS), ["list", "page"]);
  assert.equal(buttonSaying(the(page, SETTINGS_COLUMNS.page), "Settings"), undefined);
});

test("Settings' page list kept wider than its share moves from the width it is drawn at, at the first press of its edge", async () => {
  window.localStorage.setItem("luke.sidebar-width", "400");
  const page = await mount(900, createElement(SettingsWindow, { link: undefined }));
  const edge = the(page, '[role="separator"][aria-label="Resize sidebar"]');
  act(() => {
    edge.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
  });
  assert.equal(
    edge.getAttribute("aria-valuenow"),
    String(Math.round(900 * 0.35) - 16),
    "one step narrower than the 35% of the stage it is drawn at, not than the 400 kept",
  );
});

test("a link to a Settings page on a narrow stage opens on that page, with the way back to the list", async () => {
  const page = await mount(
    PHONE,
    createElement(SettingsWindow, { link: { page: SETTINGS_VIEW.APPEARANCE } }),
  );
  assert.deepEqual(onScreen(page, SETTINGS_COLUMNS), ["page"]);
  assert.equal(the(page, SETTINGS_COLUMNS.page).getAttribute("aria-label"), "Appearance");

  press(the(page, SETTINGS_COLUMNS.page), "Settings");
  assert.deepEqual(onScreen(page, SETTINGS_COLUMNS), ["list"]);
});

test("a link to Settings that names no page opens on the page list on a narrow stage", async () => {
  const page = await mount(
    PHONE,
    createElement(SettingsWindow, { link: { page: SETTINGS_VIEW.ACCOUNT, listed: true } }),
  );
  assert.deepEqual(onScreen(page, SETTINGS_COLUMNS), ["list"]);
});

test("Find on a narrow Settings lands in the search shown: a page with none shows the list for it, and the list takes it from a hidden page's own", async () => {
  const page = await mount(
    PHONE,
    createElement(SettingsWindow, { link: { page: SETTINGS_VIEW.APPEARANCE } }),
  );
  act(() => {
    runAppCommand(APP_COMMAND.FIND);
  });
  assert.deepEqual(onScreen(page, SETTINGS_COLUMNS), ["list"], "the list stands for its search");
  act(() => root?.unmount());
  document.body.innerHTML = "";

  const integrations = await mount(
    PHONE,
    createElement(SettingsWindow, { link: { page: SETTINGS_VIEW.INTEGRATIONS } }),
  );
  press(the(integrations, SETTINGS_COLUMNS.page), "Settings");
  act(() => {
    runAppCommand(APP_COMMAND.FIND);
  });
  const field = document.activeElement;
  assert.ok(field instanceof HTMLElement, "a field takes the caret");
  assert.ok(the(integrations, SETTINGS_COLUMNS.list).contains(field), "the list's own field");
});

const HISTORY_COLUMNS = {
  list: 'nav[aria-label="Versions"]',
  version: 'section[aria-label="Version"]',
};

/** The version list's row of the revision drawn `at` places down, newest first. */
function versionRow(page: HTMLElement, at: number): HTMLButtonElement {
  const rows = [
    ...the(page, '[aria-label="Version list"]').querySelectorAll<HTMLButtonElement>(
      "button:not([aria-label])",
    ),
  ];
  return rows[at] ?? assert.fail(`a version stands ${at} rows down`);
}

test("a version history on a narrow stage opens on its versions, a version chosen stands alone under a way back, and Back returns to the list", async () => {
  const page = await mount(PHONE, createElement(HistoryWindow, { returnTo: undefined }));
  assert.deepEqual(onScreen(page, HISTORY_COLUMNS), ["list"]);

  act(() => versionRow(page, 1).click());
  await settle();
  assert.deepEqual(onScreen(page, HISTORY_COLUMNS), ["version"]);

  press(the(page, HISTORY_COLUMNS.version), "Versions");
  assert.deepEqual(onScreen(page, HISTORY_COLUMNS), ["list"]);

  resizeStage(WIDE);
  assert.deepEqual(onScreen(page, HISTORY_COLUMNS), ["list", "version"]);
  assert.equal(buttonSaying(the(page, HISTORY_COLUMNS.version), "Versions"), undefined);
});

test("a version history under the split's line by its own width, on a stage wide enough for panes, opens on its versions and stands a version chosen alone under a way back", async () => {
  const page = await mount(UNDER_SPLIT, createElement(HistoryWindow, { returnTo: undefined }));
  assert.deepEqual(onScreen(page, HISTORY_COLUMNS), ["list"]);

  act(() => versionRow(page, 1).click());
  await settle();
  assert.deepEqual(onScreen(page, HISTORY_COLUMNS), ["version"]);

  press(the(page, HISTORY_COLUMNS.version), "Versions");
  assert.deepEqual(onScreen(page, HISTORY_COLUMNS), ["list"]);

  resizeStage(WIDE);
  assert.deepEqual(onScreen(page, HISTORY_COLUMNS), ["list", "version"]);
});

test("a link to a version on a narrow stage opens on that version, with the way back to the list", async () => {
  const page = await mount(
    PHONE,
    createElement(HistoryWindow, { returnTo: { revision: 2, opened: undefined } }),
  );
  assert.deepEqual(onScreen(page, HISTORY_COLUMNS), ["version"]);

  press(the(page, HISTORY_COLUMNS.version), "Versions");
  assert.deepEqual(onScreen(page, HISTORY_COLUMNS), ["list"]);
});

test("a version history gone back to on its list in a narrow room opens on its list, and the window's history moves it between the list and the version", async () => {
  const page = await mount(
    PHONE,
    createElement(HistoryWindow, { returnTo: { revision: 2, opened: undefined, listed: true } }),
  );
  assert.deepEqual(onScreen(page, HISTORY_COLUMNS), ["list"]);

  act(() => standingVersions?.onStand({ revision: 2, opened: undefined, listed: false }));
  await settle();
  assert.deepEqual(onScreen(page, HISTORY_COLUMNS), ["version"]);
  assert.equal(standingVersions?.selected, 2);

  act(() => standingVersions?.onStand({ revision: 3, opened: undefined, listed: true }));
  assert.deepEqual(onScreen(page, HISTORY_COLUMNS), ["list"]);
  assert.equal(standingVersions?.selected, 2, "the list stands over the version chosen");
});

/** Focuses the button in `within` that says `words`, as a press of a key or a tap does, and presses it. */
function pressFocused(within: HTMLElement, words: string): void {
  const button = buttonSaying(within, words) ?? assert.fail(`a button says ${words}`);
  act(() => {
    button.focus();
    button.click();
  });
}

/** The words the focused element says, and the column it stands in, by the names given the columns. */
function focusIn(page: HTMLElement, columns: Readonly<Record<string, string>>): string | undefined {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return undefined;
  return Object.entries(columns).find(([, selector]) => the(page, selector).contains(active))?.[0];
}

test("a page chosen on a narrow Settings takes the focus to its way back, and Back hands it to the page's row", async () => {
  const page = await mount(PHONE, createElement(SettingsWindow, { link: undefined }));
  pressFocused(the(page, SETTINGS_COLUMNS.list), "Appearance");
  assert.equal(focusIn(page, SETTINGS_COLUMNS), "page");
  assert.equal(document.activeElement?.textContent?.trim(), "Settings", "the way back to the list");

  pressFocused(the(page, SETTINGS_COLUMNS.page), "Settings");
  assert.equal(focusIn(page, SETTINGS_COLUMNS), "list");
  assert.equal(document.activeElement?.textContent?.trim(), "Appearance", "the row chosen");
});

test("a page chosen on a wide Settings leaves the focus on its row", async () => {
  const page = await mount(WIDE, createElement(SettingsWindow, { link: undefined }));
  pressFocused(the(page, SETTINGS_COLUMNS.list), "Appearance");
  assert.equal(focusIn(page, SETTINGS_COLUMNS), "list");
  assert.equal(document.activeElement?.textContent?.trim(), "Appearance");
});

test("a version chosen on a narrow stage takes the focus to its way back, and Back hands it to the version's row", async () => {
  const page = await mount(PHONE, createElement(HistoryWindow, { returnTo: undefined }));
  const row = versionRow(page, 1);
  act(() => {
    row.focus();
    row.click();
  });
  await settle();
  assert.equal(focusIn(page, HISTORY_COLUMNS), "version");
  assert.equal(document.activeElement?.textContent?.trim(), "Versions", "the way back to the list");

  pressFocused(the(page, HISTORY_COLUMNS.version), "Versions");
  assert.equal(document.activeElement, versionRow(page, 1), "the row chosen");
});

test("a wide Settings turned narrow hands the focus from the hidden page list to the page's way back", async () => {
  const page = await mount(WIDE, createElement(SettingsWindow, { link: undefined }));
  pressFocused(the(page, SETTINGS_COLUMNS.list), "Appearance");
  resizeStage(PHONE);
  assert.deepEqual(onScreen(page, SETTINGS_COLUMNS), ["page"]);
  assert.equal(document.activeElement?.textContent?.trim(), "Settings", "the way back to the list");
});

test("a link to a version on a narrow stage opens with the focus on its way back", async () => {
  const page = await mount(
    PHONE,
    createElement(HistoryWindow, { returnTo: { revision: 2, opened: undefined } }),
  );
  assert.equal(focusIn(page, HISTORY_COLUMNS), "version");
  assert.equal(document.activeElement?.textContent?.trim(), "Versions", "the way back to the list");
});
