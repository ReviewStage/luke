// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { PLAN_ACTOR } from "@luke/features/task-wire";
import { EXPERIMENT } from "@luke/settings";
import { SETTINGS_VIEW, type SettingsLink } from "@luke/settings/settings-views";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { experimentsOn } from "@luke/settings/testing";
import { UPDATE_STATUS } from "@luke/settings/update";
import { CHAT_PLACE, type ChatPlace, FOR_YOU } from "@luke/ui/chat-model";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import { MICROPHONE_STATUS } from "@luke/voice/audio";
import { NOTIFICATIONS_GRANTOR, NOTIFICATIONS_STATUS } from "@luke/voice/settings-controls";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { runAppCommand } from "../app-commands.js";
import { PANEL_TAB, type PanelTab } from "../panel-tabs.js";
import type { SettingsPanelProps } from "../settings/settings-panel.js";
import { followSettingsLink, useSettingsPlace } from "../settings-link.js";
import { useStageRoom } from "../stage-room.js";
import { fixtureChat } from "../tasks/chat-fixture.js";
import {
  type HistorySpot,
  type PlanHistorySource,
  usePlanHistory,
} from "../tasks/use-plan-history.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { DESKTOP_CAPABILITIES, handState } from "../testing/app-state.js";
import { layContainersAt, shown } from "../testing/container-width.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { DOCUMENT_TASK } from "../testing/document-task.js";
import { relayout } from "../testing/resize-observer.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { tasksControl } from "../testing/tasks-control.js";
// Note that Settings is loaded as the shell loads it, on first use, so the
// module is read here first and its load settles within the test's own ticks.
import "./desktop-settings.js";
import { DesktopShell } from "./desktop-shell.js";
import { useSidebarCollapse } from "./sidebar-collapse.js";

/**
 * narrow-screens.test.ts -- on a stage as narrow as a phone's, Settings, a
 * plan's version history, and Chat each show their list or the item chosen
 * in it, one at a time and the whole width: each opens on its list, a row
 * pressed stands its item alone under a way back to the list, and a link to
 * an item opens on it with the same way back. The focus goes with each swap:
 * to the item's way back, and back to the row chosen. The desktop's width
 * keeps both columns side by side, with no way back drawn, and the focus where
 * it was. Synthetic plan and chat, no account of anyone's.
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
    grantor: NOTIFICATIONS_GRANTOR.MACOS,
    packaged: true,
    onOpenSettings: ignore,
    onTest: ignore,
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

/** The desktop's window at its usual width. */
const WIDE = 1280;

/** A phone's width. */
const PHONE = 390;

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
      onLeaveVersionHistory: ignore,
    },
    sidebar,
    room,
    settingsStep,
    call: undefined,
    captions: {
      caption: { content: undefined, shown: false },
      volumeHint: { wanted: false, text: "", onDismiss: ignore },
    },
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

/** The window's Chat over the fixture's chat, its place and its rail held as the plans tab holds them. */
function ChatWindow({ opensOn }: { opensOn: ChatPlace | undefined }): React.JSX.Element {
  const [standing, setStanding] = useState({
    place: opensOn ?? FOR_YOU,
    listed: opensOn === undefined,
  });
  const base = tasksControl();
  const tasks = tasksControl({
    chatView: {
      ...base.chatView,
      open: true,
      available: true,
      chat: fixtureChat({ fixtureMode: true }, 1_000_000),
      place: standing.place,
      listed: standing.listed,
      onList: () => setStanding((held) => ({ ...held, listed: true })),
      onChoose: (place) => setStanding({ place, listed: false }),
    },
  });
  return createElement(Shell, { tab: PANEL_TAB.TASKS, tasks });
}

/** Draws the window on a stage of a width, and lets what it reads land. */
async function mount(width: number, window: React.JSX.Element): Promise<HTMLElement> {
  stageWidth = width;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return DOMRect.fromRect({ width: this.classList.contains("app-stage") ? stageWidth : 0 });
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

/** The button in `within` that says `words`, or none. */
function buttonSaying(within: HTMLElement, words: string): HTMLButtonElement | undefined {
  return [...within.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === words,
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

const CHAT_COLUMNS = {
  rail: "nav.chat-rail",
  place: "section.chat-stream",
};

test("Chat on a narrow stage opens on its rail, a place chosen stands alone under a way back, and Back returns to the rail", async () => {
  handState(experimentsOn(EXPERIMENT.CHAT));
  const page = await mount(PHONE, createElement(ChatWindow, { opensOn: undefined }));
  assert.deepEqual(onScreen(page, CHAT_COLUMNS), ["rail"]);
  assert.equal(
    getComputedStyle(the(page, ".chat-view")).gridTemplateColumns,
    "minmax(0, 1fr)",
    "the rail is the view's one column",
  );

  // Note that the row's words run on into its count.
  const forYou = [...the(page, CHAT_COLUMNS.rail).querySelectorAll("button")].find((button) =>
    button.textContent?.startsWith("For you"),
  );
  act(() => forYou?.click());
  assert.deepEqual(onScreen(page, CHAT_COLUMNS), ["place"]);
  assert.equal(the(page, CHAT_COLUMNS.place).getAttribute("aria-label"), "For you");

  press(the(page, CHAT_COLUMNS.place), "Chat");
  assert.deepEqual(onScreen(page, CHAT_COLUMNS), ["rail"]);

  resizeStage(WIDE);
  assert.deepEqual(onScreen(page, CHAT_COLUMNS), ["rail", "place"]);
  assert.equal(buttonSaying(the(page, CHAT_COLUMNS.place), "Chat"), undefined);
});

test("a link to a chat place on a narrow stage opens on that place, with the way back to the rail", async () => {
  const chat = fixtureChat({ fixtureMode: true }, 1_000_000);
  const channel = chat?.answer.channels[0] ?? assert.fail("the fixture has a channel");
  handState(experimentsOn(EXPERIMENT.CHAT));
  const page = await mount(
    PHONE,
    createElement(ChatWindow, { opensOn: { kind: CHAT_PLACE.CHANNEL, channelId: channel.id } }),
  );
  assert.deepEqual(onScreen(page, CHAT_COLUMNS), ["place"]);

  press(the(page, CHAT_COLUMNS.place), "Chat");
  assert.deepEqual(onScreen(page, CHAT_COLUMNS), ["rail"]);
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

test("a place chosen in a narrow Chat takes the focus to its way back, and Back hands it to the place's row", async () => {
  handState(experimentsOn(EXPERIMENT.CHAT));
  const page = await mount(PHONE, createElement(ChatWindow, { opensOn: undefined }));
  const forYou =
    [...the(page, CHAT_COLUMNS.rail).querySelectorAll("button")].find((button) =>
      button.textContent?.startsWith("For you"),
    ) ?? assert.fail("For you's row stands");
  act(() => {
    forYou.focus();
    forYou.click();
  });
  assert.equal(focusIn(page, CHAT_COLUMNS), "place");
  assert.equal(document.activeElement?.textContent?.trim(), "Chat", "the way back to the rail");

  pressFocused(the(page, CHAT_COLUMNS.place), "Chat");
  assert.equal(document.activeElement, forYou, "the row chosen");
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
