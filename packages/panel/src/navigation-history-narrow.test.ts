// @vitest-environment jsdom

import assert from "node:assert/strict";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import type { AppStateDelivery, AppStateSnapshot } from "@repo/host/app-state";
import { EXPERIMENT } from "@repo/settings";
import { SETTINGS_VIEW, type SettingsLink } from "@repo/settings/settings-views";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { experimentsOn } from "@repo/settings/testing";
import { DOCUMENT_REGION, TASKS_PAGE } from "@repo/ui/tasks-model";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, onTestFinished, test } from "vitest";
import { useAdminRoute } from "./admin/admin-route.js";
import { runAppCommand } from "./app-commands.js";
import { type AutomationsRoute, useAutomationsRoute } from "./automations-route.js";
import { useCopyLink } from "./links-at-hand.js";
import {
  throughHistory,
  useRoutedStanding,
  useWindowHistory,
  type WindowHistoryLists,
} from "./navigation-history.js";
import { type SettingsRoute, useSettingsRoute } from "./settings-link.js";
import { SHELL_ROOM, type ShellRoom } from "./shell-room.js";
import { chooseInboxTask, leaveInboxTask } from "./tasks/use-inbox-task.js";
import { SIDE_PANEL_TAB, type SidePanelTab } from "./tasks/use-side-panel.js";
import {
  type AdminViewControl,
  AUTOMATIONS_PAGE,
  type AutomationsPlace,
  type InboxChoice,
  type TasksControl,
} from "./tasks/use-tasks-tab.js";
import { fakeAppBridge, fakeAppBridgeCalls } from "./testing/app-bridge.js";
import { copyingInto, fakeAppPlatform, QUIET_PANEL } from "./testing/app-platform.js";
import { deliveryOf, handState, registryWith, stateWith } from "./testing/app-state.js";
import { onRegistry } from "./testing/copy-feedback.js";
import { DOCUMENT_TASK } from "./testing/document-task.js";
import { tasksControl } from "./testing/tasks-control.js";
import { type TestWindowRouter, windowRouter } from "./testing/window-router.js";

/**
 * navigation-history-narrow.test.ts -- on a stage as narrow as a phone's,
 * each pane opened over another is a step of its own: the side panel over
 * the plan, an Inbox item, a Settings page, and a version over their lists, and an automation's runs over its setup. Back returns to the pane before, Forward opens it again, the
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

const TASK_PATH = `/acme/task/${DOCUMENT_TASK.id}`;

/** A page an agent wrote for the task, as its side panel tab names it. */
const PAGE_TAB: SidePanelTab = { page: "page-1" };

/** An Inbox item of the task. */
const ITEM: InboxChoice = { taskId: DOCUMENT_TASK.id, itemId: "item-1" };

/** A coding agent of the task's. */
const AGENT = "agent-1";

/** An automation of Acme's, whose page stands over the plan. */
const AUTOMATION = "automation-1";

/** Where the window stands, as the Tasks tab holds it; Settings and Admin are the router's (`settings-link.ts`, `admin-route.ts`). */
interface Standing {
  readonly panel: { readonly open: boolean; readonly tab: SidePanelTab | undefined };
  readonly inbox: {
    readonly open: boolean;
    readonly chosen: InboxChoice | undefined;
    /** Whether the Inbox shows one column by its own width, as one narrower than its split does in a room still wide. */
    readonly single?: boolean;
  };
  readonly versions: {
    readonly open: boolean;
    readonly revision: number | undefined;
    readonly listed: boolean;
  };
  /** The coding agent whose page stands, while one does. */
  readonly agent: string | undefined;
  /** Whether a page holds unsaved work whose ask refuses every way out, as Cancel would. */
  readonly unsaved?: boolean | undefined;
  /** How many times a door naming a thing opened it in the side panel, as the real one counts them. */
  readonly opened?: number | undefined;
  /** Whether the window stands on Home, no task open, rather than on the task. */
  readonly home?: boolean | undefined;
}

/** The window on the task, every pane over it shut. */
const ON_TASK: Standing = {
  panel: { open: false, tab: undefined },
  inbox: { open: false, chosen: undefined },
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
  const onTask = at.home !== true;
  return tasksControl({
    page: onTask ? TASKS_PAGE.DOCUMENT : TASKS_PAGE.HOME,
    activeTaskId: onTask ? DOCUMENT_TASK.id : undefined,
    boundFor: onTask ? DOCUMENT_TASK.id : undefined,
    region: onTask
      ? { kind: DOCUMENT_REGION.READY, task: { ...DOCUMENT_TASK, workspaceId: ACME.id } }
      : base.region,
    workspaces: [ACME],
    workspace: ACME,
    sidePanel: {
      ...base.sidePanel,
      open: at.panel.open,
      fullScreen: at.panel.open && narrow,
      fullScreenOnly: at.panel.open && narrow,
      tab: at.panel.tab,
      opened: at.opened ?? 0,
      onShow: (_taskId, tab) =>
        patch((held) => ({ ...held, panel: { open: true, tab }, opened: (held.opened ?? 0) + 1 })),
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
    agentView: {
      ...base.agentView,
      agentId: at.agent,
      onOpen: (agent) => patch((held) => ({ ...held, agent })),
      onClose: () => patch((held) => ({ ...held, agent: undefined })),
    },
    // As the real door does, it opens the Inbox on no item; the task it narrows to is the window's own store's.
    onShowInbox: () => inbox({ open: true, chosen: undefined }),
    inboxView: {
      ...base.inboxView,
      open: at.inbox.open,
      chosen: at.inbox.chosen,
      single: at.inbox.single ?? false,
      onOpen: () => inbox({ open: true, chosen: undefined }),
      onClose: () => inbox({ open: false }),
      onChoose: (chosen) => inbox({ chosen }),
      onClear: () => inbox({ chosen: undefined }),
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
  fakeAppPlatform(QUIET_PANEL);
  handState({}, { access: { admin: true } });
});

/** Takes down every window mounted so far, since a window's history is the one its root installed last. */
function unmountAll(): void {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
}

afterEach(unmountAll);

/** The window standing as `start` says in a room, under a router over a memory history, or over the history given, and its addresses written from its Copy link, as the root wires them. */
function mount(room: ShellRoom, start: Standing, held: TestWindowRouter = windowRouter()) {
  let history: WindowHistoryLists | undefined;
  let shown: TasksControl | undefined;
  let standing = start;
  let restand: ((move: (held: Standing) => Standing) => void) | undefined;
  let settings: SettingsRoute | undefined;
  let admin: AdminViewControl | undefined;
  let automations: AutomationsRoute | undefined;
  function Probe() {
    const [at, setAt] = useState(start);
    standing = at;
    restand = setAt;
    // Settings and Admin stand where the router does, as the window's root reads them.
    settings = useSettingsRoute({
      workspaces: [ACME],
      listedId: ACME.id,
      narrow: room === SHELL_ROOM.NARROW,
    });
    admin = useAdminRoute({ listedSlug: () => ACME.slug, onClose: () => undefined });
    automations = useAutomationsRoute({ onClose: () => undefined });
    const tab = tasksTab(at, setAt, room);
    const tasks: TasksControl = {
      ...tab,
      adminView: admin,
      // As the real one does, opening a page is a way out its guard asks first.
      automationsView: {
        open: automations.open,
        place: automations.place,
        runs: automations.runs,
        onOpen: tab.leaveGuard.guard((to = { kind: AUTOMATIONS_PAGE.LIST }) =>
          automations?.onOpen(to, ACME.slug),
        ),
        onRuns: automations.onRuns,
        onClose: automations.onClose,
      },
    };
    const copyLink = useCopyLink(
      tasks,
      settings.standing
        ? { view: settings.view, workspace: ACME, listed: settings.listed }
        : undefined,
      true,
      room,
      admin.open ? admin.view : undefined,
    );
    history = useWindowHistory({
      known: true,
      link: copyLink.placed,
      routed: useRoutedStanding(),
      settingsList: settings.listAddress,
      onSettingsList: settings.list,
      automations,
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
  act(() =>
    root.render(
      held.provide(
        onRegistry(registryWith(experimentsOn(EXPERIMENT.DESCRIPTIONS)), createElement(Probe)),
      ),
    ),
  );
  return {
    history: () => history ?? assert.fail("the window's history stands"),
    /** The Tasks tab as the shell presses it. */
    shown: () => shown ?? assert.fail("the Tasks tab stands"),
    at: () => standing,
    /** Settings as the router stands it, and the navigation a Settings link makes. */
    settings: () => settings ?? assert.fail("Settings stands"),
    /** Admin as the router stands it. */
    admin: () => admin ?? assert.fail("Admin stands"),
    /** The Automations pages as the router stands them. */
    automations: () => automations ?? assert.fail("the Automations route stands"),
    /** Opens an Automations page by the router, as a link or a press does, past the leave guard as the page it leaves let go. */
    openAutomation: (to: AutomationsPlace) => act(() => automations?.onOpen(to, ACME.slug)),
    /** Opens Settings where `link` names, as a Settings link does. */
    openSettings: (link: SettingsLink) => act(() => void settings?.open(link)),
    /** Moves the window as a door other than the history would. */
    move: (to: (held: Standing) => Standing) => act(() => restand?.(to)),
    /** Presses through the shell, as a press of the pointer lands before the door it opens. */
    press: (press: () => void) =>
      act(() => {
        window.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        press();
      }),
    /** The address of every entry the router's history holds, oldest first, and the one standing. */
    addresses: () => held.addresses(),
    standingAddress: () => held.history.location.href,
    /** Moves the history by itself, as a browser's Back and Forward do, never through the window. */
    moveHistory: (delta: number) => act(() => held.history.go(delta)),
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

/** The path ⇧⌘C copies where the window stands. */
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

test("on a narrow stage the window has no Home: standing there, it stands on the Inbox's list instead, which takes Home's step, so Back has nothing to land on; a wide one stands on Home as ever", () => {
  const phone = mount(SHELL_ROOM.NARROW, { ...ON_TASK, home: true });
  assert.equal(phone.at().inbox.open, true, "the Inbox stands");
  assert.deepEqual(phone.addresses(), ["/acme/inbox"]);
  assert.equal(phone.history().canGoBack, false);
  unmountAll();

  const wide = mount(SHELL_ROOM.WIDE, { ...ON_TASK, home: true });
  assert.equal(wide.at().inbox.open, false, "Home stands");
});

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

test("on a narrow stage a task opened from a list on its plan is one step, whose Close shows the task's column in that step, so Back returns to the list at once", () => {
  const window = mount(SHELL_ROOM.NARROW, {
    ...ON_TASK,
    inbox: { open: true, chosen: undefined },
  });
  // A task opened from a list lands on its plan, the side panel over it, in one move (`use-tasks-tab.ts`'s `onSelect`).
  window.move((held) => ({
    ...held,
    inbox: { ...held.inbox, open: false },
    panel: { open: true, tab: SIDE_PANEL_TAB.DESCRIPTION },
  }));
  assert.equal(window.addresses().length, 2, "landing on the plan is one step after the list");

  window.press(() => window.shown().sidePanel.onToggle());
  assert.deepEqual(
    window.at().panel,
    { open: false, tab: SIDE_PANEL_TAB.DESCRIPTION },
    "Close shuts the panel",
  );
  assert.equal(window.at().inbox.open, false, "and leaves the task standing");
  assert.equal(window.addresses().length, 2, "in the plan's own step");
  assert.equal(window.standingAddress(), TASK_PATH);

  act(() => window.history().onBack());
  assert.equal(window.at().inbox.open, true, "Back returns to the list in one step");
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
    inbox: { open: true, chosen: undefined },
  });
  // A row pressed chooses its item and stands it alone, as the Inbox's columns do.
  window.press(() => {
    window.shown().inboxView.onChoose(ITEM);
  });

  assert.deepEqual(window.addresses(), ["/acme/inbox", "/acme/inbox/item-1"]);
  assert.equal(window.standingAddress(), copiedHere());
  const shownItem = (at: Standing) => at.inbox.chosen;
  backAndForth(window, shownItem, undefined, ITEM);

  window.press(() => window.shown().inboxView.onClear());
  assert.equal(shownItem(window.at()), undefined, "the way back stands the list");
  assert.equal(window.history().canGoForward, true, "as a step back, the item ahead");
  assert.equal(window.standingAddress(), "/acme/inbox");
});

test("an Inbox narrowed to a task, showing one column, steps its item's way back to the task's list rather than adding a step after the item", () => {
  chooseInboxTask(DOCUMENT_TASK.id);
  onTestFinished(leaveInboxTask);
  const window = mount(SHELL_ROOM.WIDE, {
    ...ON_TASK,
    inbox: { open: true, chosen: undefined, single: true },
  });
  window.press(() => {
    window.shown().inboxView.onChoose(ITEM);
  });
  window.press(() => window.shown().inboxView.onClear());

  assert.equal(window.history().canGoForward, true, "a step back, the item ahead");
  assert.equal(window.standingAddress(), `/acme/inbox/task/${DOCUMENT_TASK.id}`);
});

test("in a room still wide, as a 700px stage is, an Inbox showing one column by its own width holds its item as a step after its list, and its way back steps back to the list", () => {
  const window = mount(SHELL_ROOM.WIDE, {
    ...ON_TASK,
    inbox: { open: true, chosen: undefined, single: true },
  });
  window.press(() => {
    window.shown().inboxView.onChoose(ITEM);
  });

  assert.deepEqual(window.addresses(), ["/acme/inbox", "/acme/inbox/item-1"]);
  const shownItem = (at: Standing) => at.inbox.chosen;
  backAndForth(window, shownItem, undefined, ITEM);

  window.press(() => window.shown().inboxView.onClear());
  assert.equal(shownItem(window.at()), undefined, "the way back stands the list");
  assert.equal(window.history().canGoForward, true, "as a step back, the item ahead");
  assert.equal(window.standingAddress(), "/acme/inbox");
});

test("on the desktop's width the step's link names the Inbox's item standing alone where the Inbox shows one column by its own width, as Copy link does, and the Inbox where it splits", () => {
  for (const single of [true, false]) {
    const window = mount(SHELL_ROOM.WIDE, {
      ...ON_TASK,
      inbox: { open: true, chosen: undefined, single },
    });
    window.press(() => window.shown().inboxView.onChoose(ITEM));
    assert.equal(window.standingAddress(), single ? "/acme/inbox/item-1" : "/acme/inbox");
    assert.equal(copiedHere(), "/acme/inbox/item-1", "Copy link names the item at hand");
    unmountAll();
  }
});

test("on a narrow stage a Settings page chosen from its list is a step, whose list stands at /settings", () => {
  const window = mount(SHELL_ROOM.NARROW, ON_TASK);
  window.openSettings({ page: SETTINGS_VIEW.ACCOUNT, listed: true });
  assert.equal(window.standingAddress(), "/acme/settings");
  assert.equal(window.standingAddress(), copiedHere());
  window.openSettings({ page: SETTINGS_VIEW.APPEARANCE });

  assert.deepEqual(window.addresses(), [TASK_PATH, "/acme/settings", "/acme/settings/appearance"]);
  assert.equal(window.standingAddress(), copiedHere());
  act(() => window.history().onBack());
  assert.equal(window.settings().listed, true, "Back stands the list before");
  assert.equal(window.history().canGoForward, true);
  act(() => window.history().onForward());
  assert.deepEqual(
    [window.settings().listed, window.settings().view],
    [false, SETTINGS_VIEW.APPEARANCE],
    "Forward stands the page again",
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

test("on a narrow stage a Settings page a link opened has no list behind it, so the way back stands the list in the page's step and Back leaves Settings", () => {
  const window = mount(SHELL_ROOM.NARROW, ON_TASK);
  // A link turns to Settings on its page in one navigation.
  window.openSettings({ page: SETTINGS_VIEW.APPEARANCE });
  assert.deepEqual(window.addresses(), [TASK_PATH, "/acme/settings/appearance"]);

  window.press(() => window.history().lists.settings());
  assert.equal(window.settings().listed, true);
  assert.deepEqual(window.addresses(), [TASK_PATH, "/acme/settings"]);
  assert.equal(window.history().canGoForward, false);

  act(() => window.history().onBack());
  assert.equal(window.settings().standing, false, "Back leaves Settings for the task");
  assert.equal(window.standingAddress(), TASK_PATH);
});

test("on the desktop's width none of a narrow room's panes is a step: the side panel opened by its toggle, the Inbox's first item, a Settings page, and a version", () => {
  const moves: readonly [Standing, (window: Window) => void][] = [
    [
      { ...ON_TASK, panel: { open: false, tab: PAGE_TAB } },
      (window) => window.press(() => window.shown().sidePanel.onToggle()),
    ],
    [
      { ...ON_TASK, inbox: { open: true, chosen: undefined } },
      (window) => window.press(() => window.shown().inboxView.onChoose(ITEM)),
    ],
    [
      ON_TASK,
      (window) => {
        window.openSettings({ page: SETTINGS_VIEW.ACCOUNT, listed: true });
        window.openSettings({ page: SETTINGS_VIEW.APPEARANCE });
      },
    ],
    [
      { ...ON_TASK, versions: { open: true, revision: undefined, listed: true } },
      (window) => window.press(() => window.shown().history.onSelect(2)),
    ],
  ];
  for (const [start, open] of moves) {
    const window = mount(SHELL_ROOM.WIDE, start);
    open(window);
    // Each screen's way back to its list, which a wide room draws no button for, stands nothing new either.
    window.press(() => {
      window.history().lists.settings();
      window.shown().inboxView.onClear();
      window.shown().history.onList();
    });
    // Note that Settings, entered, is a step of its own after the task, however its pages turn.
    const entered = window.settings().standing ? 1 : 0;
    assert.equal(window.addresses().length, 1 + entered, "one step, however the panes turn");
    assert.equal(window.history().canGoBack, entered === 1);
    unmountAll();
  }
});

test("a move the history makes by itself, as a browser's Back does, takes the window to the step before and keeps the step ahead, which its Forward opens again", () => {
  const window = mount(SHELL_ROOM.WIDE, ON_TASK);
  window.openSettings({ page: SETTINGS_VIEW.ACCOUNT, listed: true });
  const steps = window.addresses();
  assert.equal(steps.length, 2);

  window.moveHistory(-1);
  assert.equal(window.settings().standing, false, "the window lands on the plan");
  assert.deepEqual(window.addresses(), steps, "and records no step");
  assert.equal(window.standingAddress(), TASK_PATH);
  assert.equal(window.history().canGoForward, true);

  window.moveHistory(1);
  assert.equal(window.settings().standing, true, "Forward opens Settings again");
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

test("a reloaded window whose saved step is the Admin place opens it once the account is known for an admin, its access read a moment after it signs in", async () => {
  const before = mount(SHELL_ROOM.NARROW, ON_TASK);
  act(() => before.admin().onOpen({ kind: "cost" }));
  await settle();
  const { held } = before;
  unmountAll();

  // The reloaded window's first document holds no access yet, as main's does until the read answers.
  let deliver: ((snapshot: AppStateSnapshot) => void) | undefined;
  const unread = stateWith(
    {},
    {
      access: { admin: false, pending: true },
    },
  );
  fakeAppBridge({
    ...fakeAppBridgeCalls(),
    requestAppState: () => Promise.resolve(unread),
    onAppState: (heard: (delivery: AppStateDelivery) => void) => {
      const listener = (snapshot: AppStateSnapshot) => heard(deliveryOf(snapshot));
      deliver = listener;
      return () => undefined;
    },
  });
  const reloaded = mount(SHELL_ROOM.NARROW, ON_TASK, held);
  await settle();
  assert.deepEqual(
    [reloaded.admin().open, reloaded.admin().view, reloaded.standingAddress()],
    [true, { kind: "cost" }, "/acme/admin/cost"],
    "the place stands, waiting on the read, rather than being passed over",
  );

  act(() =>
    deliver?.({
      ...unread,
      version: unread.version + 1,
      access: { ...unread.access, admin: true },
    }),
  );
  await settle();
  assert.deepEqual([reloaded.admin().open, reloaded.admin().view], [true, { kind: "cost" }]);
});

/** The automation's page, as a link to it or a press opens it, and as a link to one of its runs opens it. */
const AUTOMATION_PAGE: AutomationsPlace = { kind: AUTOMATIONS_PAGE.EDIT, automationId: AUTOMATION };
const LINKED_RUN: AutomationsPlace = { ...AUTOMATION_PAGE, runId: "run-1" };

/** The window on the task, a page holding unsaved work, as an automation's editor holds a draft. */
const UNSAVED: Standing = { ...ON_TASK, unsaved: true };

test("on a narrow stage an automation's runs chosen from its setup are a step, whose way back steps back to the setup without asking to leave its unsaved work", async () => {
  const window = mount(SHELL_ROOM.NARROW, UNSAVED);
  window.openAutomation(AUTOMATION_PAGE);
  await settle();
  window.press(() => window.shown().automationsView.onRuns(true));
  await settle();
  assert.equal(window.automations().runs, true);
  assert.equal(window.addresses().length, 3);

  window.press(() => window.shown().automationsView.onRuns(false));
  await settle();
  assert.equal(window.automations().runs, false);
  assert.equal(window.addresses().length, 3, "the way back added no step");
  assert.equal(window.history().canGoForward, true, "the way back was a step back");
});

test("on a narrow stage an automation opened on its runs, as a run's link opens it, has no setup behind it, so the way back stands the setup in the runs' step", async () => {
  const window = mount(SHELL_ROOM.NARROW, ON_TASK);
  window.openAutomation(LINKED_RUN);
  await settle();
  assert.equal(window.automations().runs, true);
  assert.equal(window.addresses().length, 2);

  window.press(() => window.shown().automationsView.onRuns(false));
  await settle();
  assert.equal(window.automations().runs, false);
  assert.deepEqual(window.addresses(), [
    `/acme/task/${DOCUMENT_TASK.id}`,
    `/acme/automation/${AUTOMATION}`,
  ]);
  assert.equal(window.history().canGoForward, false);
});

test("on a narrow stage Back and Forward between an automation's setup and a run a link opened move the window there without asking to leave its unsaved work", async () => {
  const window = mount(SHELL_ROOM.NARROW, UNSAVED);
  window.openAutomation(AUTOMATION_PAGE);
  await settle();
  window.openAutomation(LINKED_RUN);
  await settle();

  act(() => window.history().onBack());
  await settle();
  assert.deepEqual(window.automations().place, AUTOMATION_PAGE);
  act(() => window.history().onForward());
  await settle();
  assert.deepEqual(window.automations().place, LINKED_RUN);
});

test("on a narrow stage Back from an automation with unsaved work to another automation still asks, and stays where it is refused", async () => {
  const window = mount(SHELL_ROOM.NARROW, UNSAVED);
  window.openAutomation({ kind: AUTOMATIONS_PAGE.EDIT, automationId: "automation-2" });
  await settle();
  window.openAutomation(AUTOMATION_PAGE);
  await settle();

  act(() => window.history().onBack());
  await settle();
  assert.deepEqual(window.automations().place, AUTOMATION_PAGE, "the draft's automation stands");
});

test("on a narrow stage another thing a link opens in the side panel standing over the plan is a step of its own, which Back shows again", () => {
  const window = mount(SHELL_ROOM.NARROW, ON_TASK);
  window.press(() => window.shown().sidePanel.onShow(DOCUMENT_TASK.id, PAGE_TAB));
  window.press(() => window.shown().sidePanel.onShow(DOCUMENT_TASK.id, SIDE_PANEL_TAB.DESCRIPTION));
  assert.equal(window.addresses().length, 3, "the plan, the page's tab, then the plan's tab");

  act(() => window.history().onBack());
  assert.deepEqual(window.at().panel, { open: true, tab: PAGE_TAB });
});

test("on a narrow stage a task's way out steps back past its own panes to the page it was opened from, pushing nothing, and Forward opens the task again", () => {
  const window = mount(SHELL_ROOM.NARROW, {
    ...ON_TASK,
    inbox: { open: true, chosen: undefined },
  });
  assert.equal(window.history().away, undefined, "the Inbox's list has nothing behind it");
  window.move((held) => ({
    ...held,
    inbox: { ...held.inbox, open: false },
    panel: { open: true, tab: SIDE_PANEL_TAB.DESCRIPTION },
  }));
  // The task's own panes, each a step of its own: the agents' column, then a page's tab.
  window.press(() => window.shown().sidePanel.onToggle());
  window.press(() => window.shown().sidePanel.onShow(DOCUMENT_TASK.id, PAGE_TAB));
  const steps = window.addresses();
  assert.equal(steps.length, 3);
  assert.ok(window.history().away, "the Inbox stands behind the task");

  act(() => window.history().onLeave());
  assert.equal(window.at().inbox.open, true, "the way out lands on the Inbox at once");
  assert.deepEqual(window.addresses(), steps, "and pushes nothing");
  assert.equal(window.held.at(), 0);

  act(() => window.history().onForward());
  assert.equal(window.at().inbox.open, false, "Forward opens the task again");
});

test("on a narrow stage a task with no page behind it, as one a link opened, names none for its way out", () => {
  const window = mount(SHELL_ROOM.NARROW, { ...ON_TASK, panel: { open: true, tab: PAGE_TAB } });
  window.press(() => window.shown().sidePanel.onShow(DOCUMENT_TASK.id, SIDE_PANEL_TAB.DESCRIPTION));
  assert.equal(window.history().canGoBack, true, "Back has the task's own pane behind it");
  assert.equal(window.history().away, undefined, "but the way out has no page to go back to");
});
