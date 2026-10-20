// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AUTOMATION_PRESET } from "@luke/features/automation-code-review";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import { EXPERIMENT } from "@luke/settings";
import { SETTINGS_VIEW, type SettingsView } from "@luke/settings/settings-views";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { experimentsOn } from "@luke/settings/testing";
import { CHAT_PLACE, type ChatPlace, FOR_YOU } from "@luke/ui/chat-model";
import { memoryHistory } from "@luke/ui/history-adapter";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { runAppCommand } from "./app-commands.js";
import { useCopyLink } from "./links-at-hand.js";
import {
  installWindowHistory,
  throughHistory,
  useWindowHistory,
  type WindowHistoryLists,
} from "./navigation-history.js";
import { PANEL_TAB, type PanelTab } from "./panel-tabs.js";
import { SHELL_ROOM, type ShellRoom } from "./shell-room.js";
import type { SidePanelTab } from "./tasks/use-side-panel.js";
import {
  AUTOMATIONS_PAGE,
  type AutomationsPlace,
  type InboxChoice,
  type TasksControl,
} from "./tasks/use-tasks-tab.js";
import { copyingInto, fakeAppPlatform, QUIET_PANEL } from "./testing/app-platform.js";
import { handState } from "./testing/app-state.js";
import { onRegistry } from "./testing/copy-feedback.js";
import { DOCUMENT_TASK } from "./testing/document-task.js";
import { tasksControl } from "./testing/tasks-control.js";

/**
 * navigation-history-narrow.test.ts -- on a stage as narrow as a phone's,
 * each pane opened over another is a step of its own: the side panel over
 * the plan, an Inbox item, a Settings page, a version, and a Chat place over
 * their lists, and an automation's runs over its setup. Back returns to the pane before, Forward opens it again, the
 * screens' own ways back go through the history, and each step's address is
 * the link Copy link copies there. On the desktop's width none of them is a
 * step. The window's plans tab and Settings are a fake holding only where the
 * window stands; the history is the memory one the desktop installs.
 */

const ACME = {
  id: "workspace-acme",
  name: "Acme",
  slug: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
};

const TASK_PATH = `/acme/plan/${DOCUMENT_TASK.id}`;

/** A page an agent wrote for the task, as its side panel tab names it. */
const PAGE_TAB: SidePanelTab = { page: "page-1" };

/** An Inbox item of the task. */
const ITEM: InboxChoice = { taskId: DOCUMENT_TASK.id, itemId: "item-1" };

/** A coding agent of the task's. */
const AGENT = "agent-1";

/** A channel of Acme's chat. */
const CHANNEL: ChatPlace = { kind: CHAT_PLACE.CHANNEL, channelId: "channel-1" };

/** An automation of Acme's, whose page stands over the plan. */
const AUTOMATION = "automation-1";

/** Where the window stands, as the Tasks tab and Settings hold it. */
interface Standing {
  readonly tab: PanelTab;
  readonly settings: { readonly view: SettingsView; readonly listed: boolean };
  readonly panel: { readonly open: boolean; readonly tab: SidePanelTab | undefined };
  readonly inbox: {
    readonly open: boolean;
    readonly chosen: InboxChoice | undefined;
    readonly listed: boolean;
  };
  readonly chat: { readonly open: boolean; readonly place: ChatPlace; readonly listed: boolean };
  readonly versions: {
    readonly open: boolean;
    readonly revision: number | undefined;
    readonly listed: boolean;
  };
  /** The coding agent whose page stands, while one does. */
  readonly agent: string | undefined;
  /** Whether the automation's page stands, and its runs alone over its setup. */
  readonly automation?:
    | {
        readonly open: boolean;
        readonly runs: boolean;
        /** The page standing, the automation's own as no link named a run where left out. */
        readonly page?: AutomationsPlace | undefined;
      }
    | undefined;
  /** Whether a page holds unsaved work whose ask refuses every way out, as Cancel would. */
  readonly unsaved?: boolean | undefined;
}

/** The window on the task, every pane over it shut. */
const ON_TASK: Standing = {
  tab: PANEL_TAB.TASKS,
  settings: { view: SETTINGS_VIEW.ACCOUNT, listed: true },
  panel: { open: false, tab: undefined },
  inbox: { open: false, chosen: undefined, listed: false },
  chat: { open: false, place: FOR_YOU, listed: true },
  versions: { open: false, revision: undefined, listed: true },
  agent: undefined,
};

/** The Tasks tab over where the window stands, each press moving it as the real one does. */
function tasksTab(
  at: Standing,
  patch: (move: (held: Standing) => Standing) => void,
  room: ShellRoom,
): TasksControl {
  const base = tasksControl();
  const versions = (next: Partial<Standing["versions"]>) =>
    patch((held) => ({ ...held, versions: { ...held.versions, ...next } }));
  const panel = (next: Standing["panel"]) => patch((held) => ({ ...held, panel: next }));
  const inbox = (next: Partial<Standing["inbox"]>) =>
    patch((held) => ({ ...held, inbox: { ...held.inbox, ...next } }));
  const chat = (next: Partial<Standing["chat"]>) =>
    patch((held) => ({ ...held, chat: { ...held.chat, ...next } }));
  // As the real one does, opening or shutting the panel leaves the tab where it stands.
  const setOpen = (open: boolean) => patch((held) => ({ ...held, panel: { ...held.panel, open } }));
  const shut = () => setOpen(false);
  // A narrow room holds the panel full screen alone, so leaving full screen there shuts it.
  const narrow = room === SHELL_ROOM.NARROW;
  // As the window's own guard does while a page holds unsaved work, every way out guarded asks, and here is
  // refused, but for a way out the page passes it by.
  let passing = false;
  const leaveGuard: TasksControl["leaveGuard"] =
    at.unsaved === true
      ? {
          ...base.leaveGuard,
          pass: (leave) => {
            passing = true;
            try {
              leave();
            } finally {
              passing = false;
            }
          },
          guard:
            (leave) =>
            (...args) => {
              if (passing) leave(...args);
            },
        }
      : base.leaveGuard;
  return tasksControl({
    page: TASKS_PAGE.DOCUMENT,
    activeTaskId: DOCUMENT_TASK.id,
    boundFor: DOCUMENT_TASK.id,
    region: { kind: DOCUMENT_REGION.READY, task: { ...DOCUMENT_TASK, workspaceId: ACME.id } },
    workspaces: [ACME],
    workspace: ACME,
    sidePanel: {
      ...base.sidePanel,
      open: at.panel.open,
      fullScreen: at.panel.open && narrow,
      fullScreenOnly: at.panel.open && narrow,
      tab: at.panel.tab,
      onShow: (_taskId, tab) => panel({ open: true, tab }),
      onSetOpen: setOpen,
      onToggle: () => panel({ open: !at.panel.open, tab: at.panel.tab }),
      onToggleFullScreen: () => (narrow ? shut() : undefined),
      // The task's one tab, which closing empties the strip of and so shuts the panel, as the real one does.
      strip: at.panel.tab === undefined ? [] : [at.panel.tab],
      onClose: () => panel({ open: false, tab: undefined }),
    },
    // As the real one does, a panel filling the window is the nearer layer than the task.
    back: () => {
      if (at.panel.open) shut();
      return true;
    },
    leaveGuard,
    automationsView: {
      ...base.automationsView,
      open: at.automation?.open === true,
      place:
        at.automation?.open === true
          ? (at.automation.page ?? { kind: AUTOMATIONS_PAGE.EDIT, automationId: AUTOMATION })
          : { kind: AUTOMATIONS_PAGE.LIST },
      runs: at.automation?.runs === true,
      // As the real one does, opening a page is a way out its guard asks first, and opening it on a run's link stands its runs.
      onOpen: leaveGuard.guard((place: AutomationsPlace | undefined, runs?: boolean) => {
        const linked = place?.kind === AUTOMATIONS_PAGE.EDIT && place.runId !== undefined;
        patch((held) => ({
          ...held,
          automation: { open: true, runs: runs ?? linked, page: place },
        }));
      }),
      onRuns: (runs) =>
        patch((held) => ({
          ...held,
          automation: { open: true, runs, page: held.automation?.page },
        })),
      onClose: () => patch((held) => ({ ...held, automation: undefined })),
    },
    agentView: {
      ...base.agentView,
      agentId: at.agent,
      onOpen: (agent) => patch((held) => ({ ...held, agent })),
      onClose: () => patch((held) => ({ ...held, agent: undefined })),
    },
    inboxView: {
      ...base.inboxView,
      open: at.inbox.open,
      chosen: at.inbox.chosen,
      listed: at.inbox.listed,
      onOpen: () => inbox({ open: true }),
      onClose: () => inbox({ open: false }),
      onChoose: (chosen) => inbox({ chosen }),
      onListed: (listed) => inbox({ listed }),
    },
    chatView: {
      ...base.chatView,
      open: at.chat.open,
      place: at.chat.place,
      listed: at.chat.listed,
      onOpen: () => chat({ open: true }),
      onClose: () => chat({ open: false }),
      onList: () => chat({ listed: true }),
      onChoose: (place) => chat({ place, listed: false }),
      onShow: (place) => chat({ open: true, place, listed: false }),
    },
    history: {
      ...base.history,
      open: at.versions.open,
      selected: at.versions.revision,
      spot: at.versions.open ? { revision: at.versions.revision, opened: undefined } : undefined,
      listed: at.versions.listed,
      onSelect: (revision) => versions({ revision, listed: false }),
      onList: () => versions({ listed: true }),
      // As the real history does, the list stands over the version chosen, and a version is read again.
      onStand: (spot) =>
        versions(
          spot.listed === true ? { listed: true } : { revision: spot.revision, listed: false },
        ),
      onReturn: (_taskId, spot) =>
        versions({ open: true, revision: spot?.revision, listed: spot?.listed ?? false }),
      onClose: () => versions({ open: false }),
    },
  });
}

const roots: Root[] = [];

beforeEach(() => {
  handState(experimentsOn(EXPERIMENT.CHAT));
});

/** Takes down every window mounted so far, since a window's history is the one its root installed last. */
function unmountAll(): void {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
}

afterEach(unmountAll);

/** The window standing as `start` says in a room, its history held in memory, or in the history given, and its addresses written from its Copy link, as the root wires them. */
function mount(
  room: ShellRoom,
  start: Standing,
  held: Parameters<typeof installWindowHistory>[0] = memoryHistory(),
) {
  installWindowHistory(held);
  let history: WindowHistoryLists | undefined;
  let shown: TasksControl | undefined;
  let standing = start;
  let restand: ((move: (held: Standing) => Standing) => void) | undefined;
  function Probe() {
    const [at, setAt] = useState(start);
    standing = at;
    restand = setAt;
    const tasks = tasksTab(at, setAt, room);
    const settings = at.tab === PANEL_TAB.SETTINGS ? at.settings : undefined;
    const copyLink = useCopyLink(
      tasks,
      settings === undefined ? undefined : { ...settings, workspace: ACME },
      true,
      room,
    );
    history = useWindowHistory({
      known: true,
      link: copyLink.standing,
      tab: at.tab,
      onTabChange: (tab) =>
        setAt((was) => ({
          ...was,
          tab,
          // Arriving at Settings is arriving at its page list, as the root's tab change does.
          settings: tab === PANEL_TAB.SETTINGS ? ON_TASK.settings : was.settings,
        })),
      settingsView: at.settings.view,
      onSettingsViewChange: (view) =>
        setAt((was) => ({ ...was, settings: { view, listed: false } })),
      settingsListed: at.settings.listed,
      onSettingsList: () =>
        setAt((was) => ({ ...was, settings: { ...was.settings, listed: true } })),
      room,
      tasks,
    });
    // The Tasks tab as the shell is handed it, its ways back to the lists through the history.
    shown = throughHistory(tasks, history.lists);
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(onRegistry(AtomRegistry.make(), createElement(Probe))));
  return {
    history: () => history ?? assert.fail("the window's history stands"),
    /** The Tasks tab as the shell presses it. */
    shown: () => shown ?? assert.fail("the Tasks tab stands"),
    at: () => standing,
    /** Moves the window as a door other than the history would. */
    move: (to: (held: Standing) => Standing) => act(() => restand?.(to)),
    press: (press: () => void) => act(press),
    /** The address of every step held, oldest first, and the one standing. */
    addresses: () => held.current().entries.map((entry) => entry.address),
    standingAddress: () => held.current().entries[held.current().at]?.address,
    /** Moves the history by itself, as a browser's Back and Forward do, never through the window. */
    moveHistory: (delta: number) => act(() => held.go(delta)),
    held,
  };
}

type Window = ReturnType<typeof mount>;

/** Lets every promise settled so far run its continuations, the window's state among them. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** The path ⌥⌘C copies where the window stands. */
function copiedHere(): string {
  const copied: string[] = [];
  fakeAppPlatform({ ...QUIET_PANEL, ...copyingInto(copied) });
  act(() => runAppCommand(APP_COMMAND.COPY_LINK));
  const link = copied[0] ?? assert.fail("a link is copied");
  return new URL(link).pathname;
}

/** Back, then Forward, checking the window stands as each says. */
function backAndForth<Shown>(
  window: Window,
  list: (at: Standing) => Shown,
  expectedList: Shown,
  expectedItem: Shown,
): void {
  act(() => window.history().onBack());
  assert.deepEqual(list(window.at()), expectedList, "Back stands the screen before");
  assert.equal(window.history().canGoForward, true);
  act(() => window.history().onForward());
  assert.deepEqual(list(window.at()), expectedItem, "Forward stands the item again");
}

test("on a narrow stage the side panel opened over the plan is a step: Back shuts it, Forward opens it on its tab, and each step's address is its link", () => {
  const window = mount(SHELL_ROOM.NARROW, ON_TASK);
  assert.equal(window.standingAddress(), copiedHere());
  window.press(() => window.shown().sidePanel.onShow(DOCUMENT_TASK.id, PAGE_TAB));

  assert.deepEqual(window.addresses(), [TASK_PATH, `${TASK_PATH}/page/page-1`]);
  assert.equal(window.standingAddress(), copiedHere());
  backAndForth(
    window,
    (at) => at.panel,
    { open: false, tab: PAGE_TAB },
    {
      open: true,
      tab: PAGE_TAB,
    },
  );
});

test("on a narrow stage each of the side panel's ways out steps back to the plan, so Back does not open the panel again and no open and shut adds a step", () => {
  const waysOut: readonly [string, (shown: TasksControl) => void][] = [
    ["its Close", (shown) => shown.sidePanel.onToggle()],
    [
      "leaving full screen, as a row opening a tab of the task's column does",
      (shown) => shown.sidePanel.onToggleFullScreen(),
    ],
    ["Escape", (shown) => shown.back()],
  ];
  for (const [way, shut] of waysOut) {
    const window = mount(SHELL_ROOM.NARROW, ON_TASK);
    for (let round = 0; round < 2; round += 1) {
      window.press(() => window.shown().sidePanel.onShow(DOCUMENT_TASK.id, PAGE_TAB));
      window.press(() => shut(window.shown()));
      assert.equal(window.at().panel.open, false, `${way} shuts the panel`);
      assert.deepEqual(
        window.addresses(),
        [TASK_PATH, `${TASK_PATH}/page/page-1`],
        `${way} adds no step, however often the panel is opened and shut`,
      );
      assert.equal(window.standingAddress(), TASK_PATH);
      assert.equal(window.history().canGoBack, false, `after ${way}, Back has no panel to open`);
      assert.equal(window.history().canGoForward, true, "and Forward opens it again");
    }
    unmountAll();
  }
});

test("on a narrow stage closing the side panel's last tab shuts it by a step back to the plan, so Back does not open it again and Forward opens the tab again", () => {
  const window = mount(SHELL_ROOM.NARROW, ON_TASK);
  for (let round = 0; round < 2; round += 1) {
    window.press(() => window.shown().sidePanel.onShow(DOCUMENT_TASK.id, PAGE_TAB));
    window.press(() => window.shown().sidePanel.onClose(PAGE_TAB));
    assert.deepEqual(window.at().panel, { open: false, tab: undefined }, "the tab closes");
    assert.deepEqual(window.addresses(), [TASK_PATH, `${TASK_PATH}/page/page-1`], "adding no step");
    assert.equal(window.standingAddress(), TASK_PATH);
    assert.equal(window.history().canGoBack, false, "Back has no panel to open");
  }
  act(() => window.history().onForward());
  assert.deepEqual(window.at().panel, { open: true, tab: PAGE_TAB }, "Forward opens the tab again");
});

test("on a narrow stage a side panel the window opened with, as a link loaded on it opens it, shuts in its own step, leaving none behind or ahead", () => {
  const window = mount(SHELL_ROOM.NARROW, { ...ON_TASK, panel: { open: true, tab: PAGE_TAB } });
  assert.deepEqual(window.addresses(), [`${TASK_PATH}/page/page-1`]);

  window.press(() => window.shown().sidePanel.onToggle());
  assert.equal(window.at().panel.open, false);
  assert.deepEqual(window.addresses(), [TASK_PATH], "the plan takes the panel's step in place");
  assert.equal(window.history().canGoBack, false);
  assert.equal(window.history().canGoForward, false);
});

test("on a narrow stage a side panel shut over a page other than its plan's is no step: it neither steps back to the plan behind nor takes the step of the plan opened after it", () => {
  const window = mount(SHELL_ROOM.NARROW, ON_TASK);
  // A coding agent's page draws the task's side panel, which a narrow room holds full screen over it.
  window.move((held) => ({ ...held, agent: AGENT, panel: { open: true, tab: PAGE_TAB } }));
  assert.equal(window.addresses().length, 2);

  window.press(() => window.shown().sidePanel.onToggleFullScreen());
  assert.equal(window.at().panel.open, false);
  assert.equal(window.at().agent, AGENT, "shutting the panel leaves the agent's page standing");
  assert.equal(window.addresses().length, 2, "and is no step");

  window.move((held) => ({ ...held, agent: undefined }));
  assert.equal(window.addresses().length, 3, "the plan opened after it is a step of its own");
  assert.equal(window.standingAddress(), TASK_PATH);
  act(() => window.history().onBack());
  assert.equal(window.at().agent, AGENT, "Back returns to the agent's page");
});

test("on a narrow stage an Inbox item opened from its list is a step, and the Inbox's way back steps back to the list", () => {
  const window = mount(SHELL_ROOM.NARROW, {
    ...ON_TASK,
    inbox: { open: true, chosen: undefined, listed: true },
  });
  // A row pressed chooses its item and stands it alone, as the Inbox's columns do.
  window.press(() => {
    window.shown().inboxView.onChoose(ITEM);
    window.shown().inboxView.onListed(false);
  });

  assert.deepEqual(window.addresses(), ["/acme/inbox", `${TASK_PATH}/inbox/item-1`]);
  assert.equal(window.standingAddress(), copiedHere());
  const shownItem = (at: Standing) => (at.inbox.listed ? undefined : at.inbox.chosen);
  backAndForth(window, shownItem, undefined, ITEM);

  window.press(() => window.shown().inboxView.onListed(true));
  assert.equal(shownItem(window.at()), undefined, "the way back stands the list");
  assert.equal(window.history().canGoForward, true, "as a step back, the item ahead");
  assert.equal(window.standingAddress(), "/acme/inbox");
});

test("on a narrow stage a Settings page chosen from its list is a step, whose list stands at /settings", () => {
  const window = mount(SHELL_ROOM.NARROW, ON_TASK);
  window.move((held) => ({ ...held, tab: PANEL_TAB.SETTINGS, settings: ON_TASK.settings }));
  assert.equal(window.standingAddress(), "/acme/settings");
  assert.equal(window.standingAddress(), copiedHere());
  window.move((held) => ({
    ...held,
    settings: { view: SETTINGS_VIEW.APPEARANCE, listed: false },
  }));

  assert.deepEqual(window.addresses(), [TASK_PATH, "/acme/settings", "/acme/settings/appearance"]);
  assert.equal(window.standingAddress(), copiedHere());
  backAndForth(
    window,
    (at) => at.settings,
    { view: SETTINGS_VIEW.ACCOUNT, listed: true },
    { view: SETTINGS_VIEW.APPEARANCE, listed: false },
  );
});

test("on a narrow stage a version chosen from the list is a step, which Back leaves for the list as it stood", () => {
  const window = mount(SHELL_ROOM.NARROW, {
    ...ON_TASK,
    versions: { open: true, revision: undefined, listed: true },
  });
  window.press(() => window.shown().history.onSelect(2));

  assert.deepEqual(window.addresses(), [TASK_PATH, `${TASK_PATH}/version/2`]);
  assert.equal(window.standingAddress(), copiedHere());
  backAndForth(window, (at) => at.versions.listed, true, false);

  // The list has no link of its own, so its step is the task's, though a version stays chosen behind it.
  act(() => window.history().onBack());
  assert.equal(window.standingAddress(), TASK_PATH);
  assert.equal(window.standingAddress(), copiedHere());
  act(() => window.history().onForward());
  assert.equal(window.at().versions.revision, 2, "the version chosen comes back");
});

test("on a narrow stage a Chat place chosen from the rail is a step, and Chat's way back steps back to the rail", async () => {
  const window = mount(SHELL_ROOM.NARROW, {
    ...ON_TASK,
    chat: { open: true, place: FOR_YOU, listed: true },
  });
  // Chat is an experiment, whose word arrives with the window's state.
  await settle();
  window.press(() => window.shown().chatView.onChoose(CHANNEL));

  assert.equal(window.addresses().length, 2);
  const shownPlace = (at: Standing) => (at.chat.listed ? undefined : at.chat.place);
  backAndForth(window, shownPlace, undefined, CHANNEL);

  window.press(() => window.shown().chatView.onList());
  assert.equal(shownPlace(window.at()), undefined);
  assert.equal(window.history().canGoForward, true, "the way back was a step back");
});

test("on a narrow stage a Settings page a link opened has no list behind it, so the way back stands the list in the page's step and Back leaves Settings", () => {
  const window = mount(SHELL_ROOM.NARROW, ON_TASK);
  // A link turns to Settings and then to its page in one move, as `followSettingsLink` does.
  window.move((held) => ({
    ...held,
    tab: PANEL_TAB.SETTINGS,
    settings: { view: SETTINGS_VIEW.APPEARANCE, listed: false },
  }));
  assert.deepEqual(window.addresses(), [TASK_PATH, "/acme/settings/appearance"]);

  window.press(() => window.history().lists.settings());
  assert.equal(window.at().settings.listed, true);
  assert.deepEqual(window.addresses(), [TASK_PATH, "/acme/settings"]);
  assert.equal(window.history().canGoForward, false);

  act(() => window.history().onBack());
  assert.equal(window.at().tab, PANEL_TAB.TASKS, "Back leaves Settings for the task");
});

test("on the desktop's width none of a narrow room's panes is a step: the side panel, an Inbox item, a Settings page, a version, and a Chat place", () => {
  const moves: readonly [Standing, (window: Window) => void][] = [
    [
      ON_TASK,
      (window) => window.press(() => window.shown().sidePanel.onShow(DOCUMENT_TASK.id, PAGE_TAB)),
    ],
    [
      { ...ON_TASK, inbox: { open: true, chosen: undefined, listed: true } },
      (window) =>
        window.press(() => {
          window.shown().inboxView.onChoose(ITEM);
          window.shown().inboxView.onListed(false);
        }),
    ],
    [
      { ...ON_TASK, tab: PANEL_TAB.SETTINGS },
      (window) =>
        window.move((held) => ({
          ...held,
          settings: { view: SETTINGS_VIEW.APPEARANCE, listed: false },
        })),
    ],
    [
      { ...ON_TASK, versions: { open: true, revision: undefined, listed: true } },
      (window) => window.press(() => window.shown().history.onSelect(2)),
    ],
    [
      { ...ON_TASK, chat: { open: true, place: FOR_YOU, listed: true } },
      (window) => window.press(() => window.shown().chatView.onChoose(CHANNEL)),
    ],
  ];
  for (const [start, open] of moves) {
    const window = mount(SHELL_ROOM.WIDE, start);
    open(window);
    // Each screen's way back to its list, which a wide room draws no button for, stands nothing new either.
    window.press(() => {
      window.history().lists.settings();
      window.shown().inboxView.onListed(true);
      window.shown().chatView.onList();
      window.shown().history.onList();
    });
    assert.equal(window.addresses().length, 1, "one step, however the panes turn");
    assert.equal(window.history().canGoBack, false);
    unmountAll();
  }
});

test("a move the history makes by itself, as a browser's Back does, takes the window to the step before and keeps the step ahead, which its Forward opens again", () => {
  const window = mount(SHELL_ROOM.WIDE, ON_TASK);
  window.move((held) => ({ ...held, tab: PANEL_TAB.SETTINGS, settings: ON_TASK.settings }));
  const steps = window.addresses();
  assert.equal(steps.length, 2);

  window.moveHistory(-1);
  assert.equal(window.at().tab, PANEL_TAB.TASKS, "the window lands on the plan");
  assert.deepEqual(window.addresses(), steps, "and records no step");
  assert.equal(window.standingAddress(), TASK_PATH);
  assert.equal(window.history().canGoForward, true);

  window.moveHistory(1);
  assert.equal(window.at().tab, PANEL_TAB.SETTINGS, "Forward opens Settings again");
  assert.deepEqual(window.addresses(), steps);
});

test("on a narrow stage a move the history makes by itself back from the side panel shuts it, as the window's own Back does", () => {
  const window = mount(SHELL_ROOM.NARROW, ON_TASK);
  window.press(() => window.shown().sidePanel.onShow(DOCUMENT_TASK.id, PAGE_TAB));

  window.moveHistory(-1);
  assert.deepEqual(window.at().panel, { open: false, tab: PAGE_TAB });
  assert.deepEqual(window.addresses(), [TASK_PATH, `${TASK_PATH}/page/page-1`]);
  window.moveHistory(1);
  assert.deepEqual(window.at().panel, { open: true, tab: PAGE_TAB });
});

test("a window whose history already stands on a step when it opens, as a reloaded tab's does, opens that step rather than recording where it first stood", () => {
  const before = mount(SHELL_ROOM.NARROW, ON_TASK);
  before.press(() => before.shown().sidePanel.onShow(DOCUMENT_TASK.id, PAGE_TAB));
  const { held } = before;
  unmountAll();

  const reloaded = mount(SHELL_ROOM.NARROW, ON_TASK, held);
  assert.deepEqual(
    reloaded.at().panel,
    { open: true, tab: PAGE_TAB },
    "the side panel opens again",
  );
  assert.deepEqual(reloaded.addresses(), [TASK_PATH, `${TASK_PATH}/page/page-1`]);
  assert.equal(reloaded.history().canGoBack, true);
});

/** The automation's page, as a link to it or a press opens it, and as a link to one of its runs opens it. */
const AUTOMATION_PAGE: AutomationsPlace = { kind: AUTOMATIONS_PAGE.EDIT, automationId: AUTOMATION };
const LINKED_RUN: AutomationsPlace = { ...AUTOMATION_PAGE, runId: "run-1" };

/** The window on the automation's page over the task, its setup standing, with unsaved work in it. */
const ON_AUTOMATION: Standing = {
  ...ON_TASK,
  automation: { open: true, runs: false },
  unsaved: true,
};

test("on a narrow stage an automation's runs chosen from its setup are a step, whose way back steps back to the setup without asking to leave its unsaved work", () => {
  const window = mount(SHELL_ROOM.NARROW, ON_AUTOMATION);
  window.press(() => window.shown().automationsView.onRuns(true));
  assert.equal(window.addresses().length, 2);
  const runsAlone = (at: Standing) => at.automation?.runs;
  backAndForth(window, runsAlone, false, true);

  window.press(() => window.shown().automationsView.onRuns(false));
  assert.equal(runsAlone(window.at()), false);
  assert.equal(window.addresses().length, 2, "the way back added no step");
  assert.equal(window.history().canGoForward, true, "the way back was a step back");
});

test("on a narrow stage a move the history makes by itself back from an automation's runs stands its setup without asking to leave its unsaved work", () => {
  const window = mount(SHELL_ROOM.NARROW, ON_AUTOMATION);
  window.press(() => window.shown().automationsView.onRuns(true));
  window.moveHistory(-1);
  assert.equal(window.at().automation?.runs, false);
  assert.equal(window.history().canGoForward, true);
});

test("on a narrow stage an automation opened on its runs, as a run's link opens it, has no setup behind it, so the way back stands the setup in the runs' step", () => {
  const window = mount(SHELL_ROOM.NARROW, ON_TASK);
  window.move((held) => ({ ...held, automation: { open: true, runs: true } }));
  assert.equal(window.addresses().length, 2);

  window.press(() => window.shown().automationsView.onRuns(false));
  assert.equal(window.at().automation?.runs, false);
  assert.equal(window.addresses().length, 2, "the setup took the runs' step");
  assert.equal(window.history().canGoForward, false);
});

test("on the desktop's width an automation's runs are no step", () => {
  const window = mount(SHELL_ROOM.WIDE, ON_AUTOMATION);
  window.press(() => window.shown().automationsView.onRuns(true));
  assert.equal(window.addresses().length, 1);
});

test("on a narrow stage a step between an automation's setup and its runs a link opened on another run moves the window there without asking to leave its unsaved work", () => {
  const window = mount(SHELL_ROOM.NARROW, ON_AUTOMATION);
  // A run's link opens the same automation on its runs, as a door other than the history does.
  window.move((held) => ({ ...held, automation: { open: true, runs: true, page: LINKED_RUN } }));
  assert.equal(window.addresses().length, 2);

  act(() => window.history().onBack());
  assert.deepEqual(window.at().automation, { open: true, runs: false, page: AUTOMATION_PAGE });
  act(() => window.history().onForward());
  assert.deepEqual(window.at().automation, { open: true, runs: true, page: LINKED_RUN });
});

test("on a narrow stage a move back from a new automation's page to one opened from another suggestion asks to leave its unsaved work, and stays where it is refused", () => {
  const window = mount(SHELL_ROOM.NARROW, {
    ...ON_AUTOMATION,
    automation: {
      open: true,
      runs: false,
      page: { kind: AUTOMATIONS_PAGE.NEW, preset: AUTOMATION_PRESET.CODE_REVIEW },
    },
  });
  // An automation between the two, as a browser's Back passes over one deleted since.
  window.move((held) => ({
    ...held,
    automation: { open: true, runs: false, page: AUTOMATION_PAGE },
  }));
  const blank: AutomationsPlace = { kind: AUTOMATIONS_PAGE.NEW };
  window.move((held) => ({ ...held, automation: { open: true, runs: false, page: blank } }));
  assert.equal(window.addresses().length, 3);

  window.moveHistory(-2);
  assert.deepEqual(window.at().automation?.page, blank, "the blank draft stands");
  assert.equal(window.held.current().at, 2, "the history stands back on it");
});

test("on a narrow stage Back from an automation with unsaved work to another automation still asks, and stays where it is refused", () => {
  const window = mount(SHELL_ROOM.NARROW, {
    ...ON_AUTOMATION,
    automation: {
      open: true,
      runs: false,
      page: { kind: AUTOMATIONS_PAGE.EDIT, automationId: "automation-2" },
    },
  });
  window.move((held) => ({
    ...held,
    automation: { open: true, runs: false, page: AUTOMATION_PAGE },
  }));
  assert.equal(window.addresses().length, 2);

  act(() => window.history().onBack());
  assert.deepEqual(window.at().automation?.page, AUTOMATION_PAGE, "the draft's automation stands");
  window.moveHistory(-1);
  assert.deepEqual(window.at().automation?.page, AUTOMATION_PAGE, "and a browser's Back too");
  assert.equal(window.held.current().at, 1, "the history stands back on it");
});
