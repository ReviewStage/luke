// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@luke/features/coding-agent-wire";
import type { TaskSummary } from "@luke/features/task-wire";
import { WORKSPACE_ROLE, type WorkspaceMember } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { EXPERIMENT } from "@luke/settings";
import { SETTINGS_VIEW } from "@luke/settings/settings-views";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { experimentsOn } from "@luke/settings/testing";
import { type HistoryAdapter, type HistorySnapshot, memoryHistory } from "@luke/ui/history-adapter";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { runAppCommand } from "./app-commands.js";
import { stepTitle } from "./history-titles.js";
import { useCopyLink } from "./links-at-hand.js";
import {
  installWindowHistory,
  MOUSE_BUTTON,
  type StepTitle,
  sameHistoryPage,
  throughHistory,
  useHistoryMouseButtons,
  useWindowHistory,
  type WindowHistoryLists,
} from "./navigation-history.js";
import { PANEL_TAB } from "./panel-tabs.js";
import { SHELL_ROOM } from "./shell-room.js";
import {
  type ChannelPlaceControl,
  chooseChannel,
  listChannelWorkspace,
  openChannelThread,
  useChannelPlace,
  useChannels,
} from "./tasks/use-channels.js";
import { SIDE_PANEL_TAB, type SidePanelTab } from "./tasks/use-side-panel.js";
import {
  AUTOMATIONS_PAGE,
  type AutomationsPlace,
  type LeaveAsk,
  type TasksControl,
} from "./tasks/use-tasks-tab.js";
import { fakeActPort, fakeAppBridge } from "./testing/app-bridge.js";
import { copyingInto, fakeAppPlatform, QUIET_PANEL } from "./testing/app-platform.js";
import { handState } from "./testing/app-state.js";
import { onRegistry } from "./testing/copy-feedback.js";
import { DOCUMENT_TASK } from "./testing/document-task.js";
import { codingAgentsControl, tasksControl } from "./testing/tasks-control.js";

/** A place as the window's history holds it. */
type HeldPlace = ReturnType<
  Parameters<typeof installWindowHistory>[0]["current"]
>["entries"][number]["state"];

const TASK_ID = "0f6a2c4e-8b1d-4e3f-9a57-1c2b3d4e5f60";
const AUTOMATION_ID = "5d1e7a9c-3b2f-4c6d-8e0a-9f1b2c3d4e5a";

const roots: Root[] = [];

/** Takes down every window mounted so far, and the commands each offered. */
function unmountAll(): void {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
}

afterEach(unmountAll);

/** A history the test stands on any trail, as a browser's lands on entries the window never held, or on one holding no step. */
function landingHistory<State>(): HistoryAdapter<State> & {
  land: (trail: HistorySnapshot<State>) => void;
} {
  let snapshot: HistorySnapshot<State> = { entries: [], at: -1 };
  const listeners = new Set<() => void>();
  const stand = (next: HistorySnapshot<State>) => {
    snapshot = next;
    for (const listener of [...listeners]) listener();
  };
  return {
    current: () => snapshot,
    push: (entry) => {
      const entries = [...snapshot.entries.slice(0, snapshot.at + 1), entry];
      stand({ entries, at: entries.length - 1 });
    },
    replace: (entry) =>
      stand(
        snapshot.at < 0
          ? { entries: [entry], at: 0 }
          : { entries: snapshot.entries.with(snapshot.at, entry), at: snapshot.at },
      ),
    go: (delta) => {
      const at = snapshot.at + delta;
      if (delta !== 0 && at >= 0 && at < snapshot.entries.length) {
        stand({ entries: snapshot.entries, at });
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    land: stand,
  };
}

/** The leave ask a test stands while a page holds unsaved work, or nothing. */
interface LeaveAskHolder {
  current: LeaveAsk | undefined;
}

/** The Tasks tab whose leave guard asks through whatever `ask` holds as a door is taken, and passes while it holds nothing. */
function askingThrough(ask: LeaveAskHolder, base: TasksControl): TasksControl {
  return {
    ...base,
    leaveGuard: {
      stand: () => () => undefined,
      pass: (leave) => leave(),
      guard:
        (leave) =>
        (...args) => {
          if (ask.current === undefined) leave(...args);
          else ask.current(() => leave(...args));
        },
    },
  };
}

/** The window's history over the Tasks tab as `plans` stands, restood by the returned setter, kept in a memory history of its own as a window's root installs one, and its addresses written from the window's own Copy link, as the root wires it. */
function mount(
  initial: TasksControl,
  held: Parameters<typeof installWindowHistory>[0] = memoryHistory(),
  titled?: (tasks: TasksControl) => StepTitle | undefined,
) {
  installWindowHistory(held);
  let history: WindowHistoryLists | undefined;
  let shown: TasksControl | undefined;
  let restand: ((tasks: TasksControl) => void) | undefined;
  function Probe() {
    const [tasks, setTasks] = useState(initial);
    restand = setTasks;
    const copyLink = useCopyLink(tasks, undefined, true);
    history = useWindowHistory({
      known: true,
      link: copyLink.standing,
      tab: PANEL_TAB.TASKS,
      onTabChange: () => undefined,
      settingsView: SETTINGS_VIEW.ACCOUNT,
      onSettingsViewChange: () => undefined,
      settingsListed: true,
      onSettingsList: () => undefined,
      room: SHELL_ROOM.WIDE,
      title: titled?.(tasks),
      tasks,
    });
    useHistoryMouseButtons(history, true);
    // The Tasks tab as the shell hands it on, its Escape through the history.
    shown = throughHistory(tasks, history.lists);
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  // Each window reads its state under a registry of its own, as the window's root provides one.
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(onRegistry(AtomRegistry.make(), createElement(Probe))));
  return {
    history: () => {
      assert.ok(history);
      return history;
    },
    stand: (tasks: TasksControl) => act(() => restand?.(tasks)),
    /** Presses Escape where it reaches the Tasks tab, as the window's own listener hands it on. */
    escape: () => act(() => void shown?.back()),
    /** The address of every step held, oldest first. */
    addresses: () => held.current().entries.map((entry) => entry.address),
    /** Moves the history by itself, as a browser's Back and Forward do, never through the window. */
    moveHistory: (delta: number) => act(() => held.go(delta)),
  };
}

/** Lets every promise settled so far run its continuations, the window's state among them. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** The window on the Automations page given, of the workspace given, each page it is asked to open recorded in `opened`. */
function onAutomations(
  page: AutomationsPlace | undefined,
  opened: (AutomationsPlace | undefined)[],
  workspaceId = "workspace-acme",
): TasksControl {
  return tasksControl({
    workspace: { id: workspaceId, name: workspaceId, role: WORKSPACE_ROLE.MEMBER, github: null },
    automationsView: {
      ...tasksControl().automationsView,
      open: page !== undefined,
      place: page ?? { kind: AUTOMATIONS_PAGE.LIST },
      onOpen: (place) => opened.push(place),
      onClose: () => undefined,
    },
  });
}

test("a launch that reopens the plan last open leaves nothing behind it to go back to", () => {
  const window = mount(tasksControl({ restoring: true }));
  window.stand(
    tasksControl({ page: TASKS_PAGE.DOCUMENT, activeTaskId: TASK_ID, boundFor: TASK_ID }),
  );
  assert.equal(window.history().canGoBack, false);
});

test("the Inbox the window rests on with no plan open is no step of its own, so resting on it after the plan is one step, and opening the Inbox past it is another", () => {
  const window = mount(
    tasksControl({ page: TASKS_PAGE.DOCUMENT, activeTaskId: TASK_ID, boundFor: TASK_ID }),
  );
  const inboxOpen = { ...tasksControl().inboxView, open: true };
  window.stand(tasksControl());
  window.stand(tasksControl({ resting: true, inboxView: inboxOpen }));
  assert.equal(window.history().canGoBack, true, "Back returns to the plan");

  act(() => window.history().onBack());
  assert.equal(window.history().canGoBack, false, "resting took no second step");

  const opened = mount(tasksControl({ resting: true, inboxView: inboxOpen }));
  opened.stand(tasksControl({ inboxView: inboxOpen }));
  assert.equal(opened.history().canGoBack, true, "the Inbox opened is a step of its own");
});

test("leaving a plan for the page with no plan open is a step Back returns from", () => {
  const window = mount(
    tasksControl({ page: TASKS_PAGE.DOCUMENT, activeTaskId: TASK_ID, boundFor: TASK_ID }),
  );
  window.stand(tasksControl());
  assert.equal(window.history().canGoBack, true);
});

test("a press of the mouse's Back or Forward button takes one step and cancels the browser's own, so a browser tab takes no second step", () => {
  const window = mount(
    tasksControl({ page: TASKS_PAGE.DOCUMENT, activeTaskId: TASK_ID, boundFor: TASK_ID }),
  );
  window.stand(tasksControl());
  const press = (button: number) => {
    const release = new MouseEvent("mouseup", { button, bubbles: true, cancelable: true });
    act(() => {
      document.body.dispatchEvent(release);
    });
    return release;
  };

  assert.equal(press(MOUSE_BUTTON.BACK).defaultPrevented, true);
  assert.equal(window.history().canGoBack, false, "Back took one step, to the plan");
  assert.equal(press(MOUSE_BUTTON.FORWARD).defaultPrevented, true);
  assert.equal(window.history().canGoForward, false, "Forward took one step, home again");
  assert.equal(press(0).defaultPrevented, false, "any other button keeps its own");
});

test("a step back cancelled at the leave ask leaves the trail where the window stands, so the next step is the same step", () => {
  const asked: (() => void)[] = [];
  const ask: LeaveAsk = (leave) => asked.push(leave);
  let standing: LeaveAsk | undefined;
  const asking = (base: TasksControl): TasksControl => ({
    ...base,
    leaveGuard: {
      stand: () => () => undefined,
      pass: (leave) => leave(),
      guard:
        (leave) =>
        (...args) => {
          if (standing === undefined) leave(...args);
          else standing(() => leave(...args));
        },
    },
  });
  const homes: string[] = [];
  const atTask = asking(
    tasksControl({
      page: TASKS_PAGE.DOCUMENT,
      activeTaskId: TASK_ID,
      boundFor: TASK_ID,
      onLeaveTask: () => homes.push("home"),
    }),
  );
  const window = mount(asking(tasksControl()));
  window.stand(atTask);
  assert.equal(window.history().canGoBack, true);

  standing = ask;
  act(() => window.history().onBack());
  assert.deepEqual(homes, [], "the step waits on the ask");
  assert.equal(window.history().canGoBack, true, "and the trail has not moved");
  assert.equal(window.history().canGoForward, false);

  act(() => asked[0]?.());
  assert.deepEqual(homes, ["home"], "Leave takes the step it asked about");
});

test("a move the history makes by itself while a page holds unsaved work stands the history back on the window's step and asks, and Leave makes the move again", () => {
  const asked: (() => void)[] = [];
  const ask: LeaveAskHolder = { current: undefined };
  const homes: string[] = [];
  const window = mount(askingThrough(ask, tasksControl()));
  window.stand(
    askingThrough(
      ask,
      tasksControl({
        page: TASKS_PAGE.DOCUMENT,
        activeTaskId: TASK_ID,
        boundFor: TASK_ID,
        onLeaveTask: () => homes.push("home"),
      }),
    ),
  );

  ask.current = (leave) => asked.push(leave);
  window.moveHistory(-1);
  assert.deepEqual(homes, [], "the move waits on the ask");
  assert.equal(window.history().canGoBack, true, "and the history stands back on the plan");
  assert.equal(window.history().canGoForward, false);

  act(() => asked[0]?.());
  assert.deepEqual(homes, ["home"], "Leave takes the move it asked about");
  assert.equal(window.history().canGoBack, false);
  assert.equal(window.history().canGoForward, true);
});

test("a move landing where the history no longer holds the window's step, while a page holds unsaved work, writes that step again after it and asks, and Leave goes back to where it landed", () => {
  const asked: (() => void)[] = [];
  const ask: LeaveAskHolder = { current: undefined };
  const homes: string[] = [];
  const held = landingHistory<HeldPlace>();
  const window = mount(askingThrough(ask, tasksControl()), held);
  window.stand(
    askingThrough(
      ask,
      tasksControl({
        page: TASKS_PAGE.DOCUMENT,
        activeTaskId: TASK_ID,
        boundFor: TASK_ID,
        onLeaveTask: () => homes.push("home"),
      }),
    ),
  );
  const [home, task] = held.current().entries;
  assert.ok(home !== undefined && task !== undefined);

  ask.current = (leave) => asked.push(leave);
  // The home page's entry read back afresh, as a browser hands one over after a reload.
  act(() => held.land({ entries: [{ ...home }], at: 0 }));
  assert.deepEqual(homes, [], "the move waits on the ask");
  assert.deepEqual(window.addresses(), ["/app", task.address], "the plan's step is written again");
  assert.equal(held.current().at, 1);

  act(() => asked[0]?.());
  assert.deepEqual(homes, ["home"], "Leave goes home");
  assert.equal(held.current().at, 0);
});

test("a move landing on an entry holding no step opens Home, as a page loaded there does, and Home writes its step on it", () => {
  const homes: string[] = [];
  const held = landingHistory<HeldPlace>();
  const window = mount(tasksControl(), held);
  window.stand(
    tasksControl({
      page: TASKS_PAGE.DOCUMENT,
      activeTaskId: TASK_ID,
      boundFor: TASK_ID,
      onLeaveTask: () => homes.push("home"),
    }),
  );

  act(() => held.land({ entries: [], at: -1 }));
  assert.deepEqual(homes, ["home"], "the plan is left for Home");

  window.stand(tasksControl());
  act(() => held.land({ entries: [], at: -1 }));
  assert.deepEqual(window.addresses(), ["/app"], "the window on Home writes its step there");
});

/** The window on the Inbox, or on the task `onTask` stands, each Inbox opened recorded in `inboxes` and each task left in `left`. */
function inboxOrTask(
  onTask: boolean,
  inboxes: string[],
  left: string[],
  ask: LeaveAskHolder = { current: undefined },
): TasksControl {
  const base = tasksControl();
  return askingThrough(
    ask,
    tasksControl({
      ...(onTask ? { page: TASKS_PAGE.DOCUMENT, activeTaskId: TASK_ID, boundFor: TASK_ID } : {}),
      onLeaveTask: () => left.push(TASK_ID),
      inboxView: {
        ...base.inboxView,
        open: !onTask,
        onOpen: () => inboxes.push("inbox"),
      },
    }),
  );
}

test("Escape on a task opened from the Inbox returns to the Inbox, as Back does, rather than leaving the task for the home page", () => {
  const inboxes: string[] = [];
  const left: string[] = [];
  const window = mount(inboxOrTask(false, inboxes, left));
  window.stand(inboxOrTask(true, inboxes, left));

  window.escape();

  assert.deepEqual(inboxes, ["inbox"]);
  assert.deepEqual(left, [], "the task is not left for the home page");
  assert.equal(window.history().canGoBack, false, "Escape took the one step back");
  assert.equal(window.history().canGoForward, true, "which Forward takes again");
});

test("Escape on a task opened from a person's page returns to that page", () => {
  const reopened: string[] = [];
  const left: string[] = [];
  const standing = (userId: string | undefined, rest: Partial<TasksControl> = {}) =>
    tasksControl({
      ...rest,
      onLeaveTask: () => left.push(TASK_ID),
      personView: {
        userId,
        name: undefined,
        workspaceId: undefined,
        onOpen: (id) => reopened.push(id),
        onClose: () => undefined,
      },
    });
  const window = mount(standing("user-charles"));
  window.stand(
    standing(undefined, { page: TASKS_PAGE.DOCUMENT, activeTaskId: TASK_ID, boundFor: TASK_ID }),
  );

  window.escape();

  assert.deepEqual(reopened, ["user-charles"]);
  assert.deepEqual(left, []);
});

test("Escape on a task with no step behind it, as a launch or a link opens one on, leaves the task once", () => {
  const left: string[] = [];
  const window = mount(
    tasksControl({
      page: TASKS_PAGE.DOCUMENT,
      activeTaskId: TASK_ID,
      boundFor: TASK_ID,
      onLeaveTask: () => left.push(TASK_ID),
    }),
  );

  window.escape();

  assert.deepEqual(left, [TASK_ID]);
});

test("Escape on a task whose step back is cancelled at the leave ask moves nothing, and Leave takes that step", () => {
  const asked: (() => void)[] = [];
  const ask: LeaveAskHolder = { current: undefined };
  const inboxes: string[] = [];
  const left: string[] = [];
  const window = mount(inboxOrTask(false, inboxes, left, ask));
  window.stand(inboxOrTask(true, inboxes, left, ask));

  ask.current = (leave) => asked.push(leave);
  window.escape();
  assert.deepEqual(inboxes, [], "the step waits on the ask");
  assert.deepEqual(left, [], "and the task is not left in its place");
  assert.equal(window.history().canGoBack, true, "and the trail has not moved");

  act(() => asked[0]?.());
  assert.deepEqual(inboxes, ["inbox"], "Leave takes the step it asked about");
  assert.deepEqual(left, []);
});

test("a person's page is a step of its own, which Back from a plan opened after it returns to, and another person's is another step", () => {
  const reopened: string[] = [];
  // Every control the window stands on opens a person's page the same way, recorded.
  const standing = (userId: string | undefined, rest: Partial<TasksControl> = {}) =>
    tasksControl({
      ...rest,
      personView: {
        userId,
        name: undefined,
        workspaceId: undefined,
        onOpen: (id) => reopened.push(id),
        onClose: () => undefined,
      },
    });
  const window = mount(standing("user-charles"));
  window.stand(standing("user-maya"));
  window.stand(
    standing(undefined, { page: TASKS_PAGE.DOCUMENT, activeTaskId: TASK_ID, boundFor: TASK_ID }),
  );

  act(() => window.history().onBack());
  window.stand(standing("user-maya"));
  act(() => window.history().onBack());

  assert.deepEqual(reopened, ["user-maya", "user-charles"]);
});

test("a person's page is theirs in the workspace it stood in, so once another is listed Back passes over it", () => {
  const reopened: string[] = [];
  const standing = (workspaceId: string, userId: string | undefined) =>
    tasksControl({
      workspace: { id: workspaceId, name: workspaceId, role: WORKSPACE_ROLE.MEMBER, github: null },
      personView: {
        userId,
        name: undefined,
        workspaceId: undefined,
        onOpen: (id) => reopened.push(id),
        onClose: () => undefined,
      },
    });
  const window = mount(standing("workspace-acme", undefined));
  window.stand(standing("workspace-acme", "user-charles"));
  window.stand(standing("workspace-platform", undefined));

  act(() => window.history().onBack());

  assert.deepEqual(reopened, []);
});

test("a person's page opened again with a newer name keeps that name in its step, which Back opens it with", () => {
  const reopened: (string | undefined)[] = [];
  const standing = (userId: string | undefined, name?: string, rest: Partial<TasksControl> = {}) =>
    tasksControl({
      ...rest,
      personView: {
        userId,
        name,
        workspaceId: undefined,
        onOpen: (_id, opened) => reopened.push(opened),
        onClose: () => undefined,
      },
    });
  const window = mount(standing("user-lee", "Lee Park"));
  window.stand(standing("user-lee", "Lee Chen"));
  window.stand(
    standing(undefined, undefined, {
      page: TASKS_PAGE.DOCUMENT,
      activeTaskId: TASK_ID,
      boundFor: TASK_ID,
    }),
  );

  act(() => window.history().onBack());

  assert.deepEqual(reopened, ["Lee Chen"]);
});

test("an automation opened from the Automations list is a step of its own, which Back leaves for the list", async () => {
  handState({});
  const opened: (AutomationsPlace | undefined)[] = [];
  const window = mount(
    tasksControl({ page: TASKS_PAGE.DOCUMENT, activeTaskId: TASK_ID, boundFor: TASK_ID }),
  );
  await settle();
  window.stand(onAutomations({ kind: AUTOMATIONS_PAGE.LIST }, opened));
  window.stand(onAutomations({ kind: AUTOMATIONS_PAGE.EDIT, automationId: AUTOMATION_ID }, opened));

  act(() => window.history().onBack());

  assert.deepEqual(opened, [{ kind: AUTOMATIONS_PAGE.LIST }]);
});

test("the automation a new automation's page made takes that page's step, so Back from it returns to the list it was opened from", async () => {
  handState({});
  const opened: (AutomationsPlace | undefined)[] = [];
  const window = mount(onAutomations({ kind: AUTOMATIONS_PAGE.LIST }, opened));
  await settle();
  window.stand(onAutomations({ kind: AUTOMATIONS_PAGE.NEW }, opened));
  const made = { kind: AUTOMATIONS_PAGE.EDIT, automationId: AUTOMATION_ID, created: true } as const;
  window.stand(onAutomations(made, opened));

  act(() => window.history().onBack());
  window.stand(onAutomations({ kind: AUTOMATIONS_PAGE.LIST }, opened));
  act(() => window.history().onForward());

  assert.deepEqual(opened, [{ kind: AUTOMATIONS_PAGE.LIST }, made]);
});

test("another automation opened over a new automation's page, as a notification opens one, is a visit after it, which Back leaves for the new page", async () => {
  handState({});
  const opened: (AutomationsPlace | undefined)[] = [];
  const window = mount(onAutomations({ kind: AUTOMATIONS_PAGE.LIST }, opened));
  await settle();
  window.stand(onAutomations({ kind: AUTOMATIONS_PAGE.NEW }, opened));
  window.stand(onAutomations({ kind: AUTOMATIONS_PAGE.EDIT, automationId: AUTOMATION_ID }, opened));

  act(() => window.history().onBack());

  assert.deepEqual(opened, [{ kind: AUTOMATIONS_PAGE.NEW }]);
});

test("an automation's page is of the workspace it stood in, so once another is listed Back passes over it", async () => {
  handState({});
  const opened: (AutomationsPlace | undefined)[] = [];
  const window = mount(onAutomations({ kind: AUTOMATIONS_PAGE.LIST }, opened));
  await settle();
  window.stand(onAutomations({ kind: AUTOMATIONS_PAGE.EDIT, automationId: AUTOMATION_ID }, opened));
  const linked = { kind: AUTOMATIONS_PAGE.EDIT, automationId: "automation-of-platform" } as const;
  window.stand(onAutomations(linked, opened, "workspace-platform"));

  act(() => window.history().onBack());

  assert.deepEqual(opened, [{ kind: AUTOMATIONS_PAGE.LIST }]);
});

test("a deleted automation's page is passed over by Back, which returns to the page before it", async () => {
  handState({});
  const opened: (AutomationsPlace | undefined)[] = [];
  const window = mount(onAutomations({ kind: AUTOMATIONS_PAGE.LIST }, opened));
  await settle();
  const kept = { kind: AUTOMATIONS_PAGE.EDIT, automationId: "automation-kept" } as const;
  window.stand(onAutomations(kept, opened));
  window.stand(onAutomations({ kind: AUTOMATIONS_PAGE.EDIT, automationId: AUTOMATION_ID }, opened));
  window.stand(onAutomations({ kind: AUTOMATIONS_PAGE.LIST, deleted: AUTOMATION_ID }, opened));

  act(() => window.history().onBack());

  assert.deepEqual(opened, [kept]);
});

/** The window with the Board standing or not, in the workspace given, each time the Board is asked to open counted in `opened`. */
function onBoard(open: boolean, opened: string[], workspaceId = "workspace-acme"): TasksControl {
  const base = tasksControl();
  return tasksControl({
    workspace: { id: workspaceId, name: workspaceId, role: WORKSPACE_ROLE.MEMBER, github: null },
    boardView: { ...base.boardView, open, onOpen: () => opened.push(workspaceId) },
  });
}

test("the Board is its workspace's tasks, so Back returns to it in that workspace and passes over it once another is listed", async () => {
  const opened: string[] = [];
  const same = mount(onBoard(true, opened));
  await settle();
  same.stand(onBoard(false, opened));
  assert.equal(same.history().canGoBack, true);
  act(() => same.history().onBack());
  assert.deepEqual(opened, ["workspace-acme"]);

  const other = mount(onBoard(true, opened));
  await settle();
  other.stand(onBoard(false, opened, "workspace-platform"));
  assert.equal(other.history().canGoBack, false, "the Board of another workspace is no step back");
});

const ACME = {
  id: "workspace-acme",
  name: "Acme",
  slug: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
};

/** A task drawn in Acme, the workspaces as `workspaces` lists them. */
function onTask(workspaces: TasksControl["workspaces"]): TasksControl {
  return tasksControl({
    page: TASKS_PAGE.DOCUMENT,
    activeTaskId: DOCUMENT_TASK.id,
    boundFor: DOCUMENT_TASK.id,
    region: { kind: DOCUMENT_REGION.READY, task: { ...DOCUMENT_TASK, workspaceId: ACME.id } },
    workspaces,
    workspace: ACME,
  });
}

test("each step's address is the path of the link ⌥⌘C copies there", async () => {
  const copied: string[] = [];
  fakeAppPlatform({ ...QUIET_PANEL, ...copyingInto(copied) });
  const listed = { workspaces: [ACME], workspace: ACME };
  const places: TasksControl[] = [
    onTask([ACME]),
    tasksControl({ ...listed, inboxView: { ...tasksControl().inboxView, open: true } }),
    tasksControl({
      ...listed,
      automationsView: {
        ...tasksControl().automationsView,
        open: true,
        place: { kind: AUTOMATIONS_PAGE.EDIT, automationId: AUTOMATION_ID },
      },
    }),
    tasksControl({
      ...listed,
      personView: { ...tasksControl().personView, userId: "user-charles", workspaceId: ACME.id },
    }),
  ];
  const addresses: string[] = [];
  for (const tasks of places) {
    const window = mount(tasks);
    act(() => runAppCommand(APP_COMMAND.COPY_LINK));
    await settle();
    addresses.push(...window.addresses());
    unmountAll();
  }

  assert.equal(copied.length, places.length);
  assert.deepEqual(
    addresses,
    copied.map((link) => new URL(link).pathname),
  );
});

test("a new automation's page has no link, so it stands at /app beside the list it was opened from", () => {
  const window = mount(onAutomations({ kind: AUTOMATIONS_PAGE.LIST }, []));
  window.stand(onAutomations({ kind: AUTOMATIONS_PAGE.NEW }, []));

  assert.deepEqual(window.addresses(), ["/workspace-acme/automations", "/app"]);
});

test("a place with no link stands at /app: the home page, and the Board though a task stands under it", () => {
  const window = mount(tasksControl({ workspaces: [ACME], workspace: ACME }));
  const task = onTask([ACME]);
  window.stand({ ...task, boardView: { ...task.boardView, open: true } });

  assert.deepEqual(window.addresses(), ["/app", "/app"]);
});

test("the Admin place stands at its workspace's /admin though a task stands under it, a section at /admin/<section> in place, and an account's page at /admin/user/<id> as a step, as Copy link copies each", async () => {
  const copied: string[] = [];
  fakeAppPlatform({ ...QUIET_PANEL, ...copyingInto(copied) });
  const task = onTask([ACME]);
  const admin = (view: TasksControl["adminView"]["view"]): TasksControl => ({
    ...task,
    adminView: { ...task.adminView, open: true, view },
  });
  const window = mount(task);
  window.stand(admin({ kind: "dashboard" }));
  window.stand(admin({ kind: "cost" }));
  window.stand(admin({ kind: "account", id: "user-ada" }));
  act(() => runAppCommand(APP_COMMAND.COPY_LINK));
  await settle();

  assert.deepEqual(window.addresses(), [
    `/acme/plan/${DOCUMENT_TASK.id}`,
    "/acme/admin/cost",
    "/acme/admin/user/user-ada",
  ]);
  assert.deepEqual(copied, ["https://tryluke.dev/acme/admin/user/user-ada"]);
});

test("with no workspace listed, a place in a workspace has no link, so it stands at /app as Copy link offers nothing", async () => {
  const copied: string[] = [];
  fakeAppPlatform({ ...QUIET_PANEL, ...copyingInto(copied) });
  const none = { workspaces: [], workspace: undefined };
  const places: TasksControl[] = [
    tasksControl({
      ...none,
      automationsView: { ...tasksControl().automationsView, open: true },
    }),
    tasksControl({
      ...none,
      automationsView: {
        ...tasksControl().automationsView,
        open: true,
        place: { kind: AUTOMATIONS_PAGE.EDIT, automationId: AUTOMATION_ID },
      },
    }),
    tasksControl({ ...none, inboxView: { ...tasksControl().inboxView, open: true } }),
    tasksControl({ ...none, agentView: { ...tasksControl().agentView, agentId: "agent-1" } }),
    tasksControl({
      ...none,
      personView: { ...tasksControl().personView, userId: "user-charles" },
    }),
  ];
  const addresses: string[] = [];
  for (const tasks of places) {
    const window = mount(tasks);
    act(() => runAppCommand(APP_COMMAND.COPY_LINK));
    await settle();
    addresses.push(...window.addresses());
    unmountAll();
  }

  assert.deepEqual(
    addresses,
    places.map(() => "/app"),
  );
  assert.deepEqual(copied, []);
});

test("a workspace's slug read after the visit moves the standing step to its address, without a step of its own", () => {
  const window = mount(onTask([]));
  const before = window.addresses();
  window.stand(onTask([ACME]));

  assert.deepEqual(before, [`/workspace-acme/plan/${DOCUMENT_TASK.id}`]);
  assert.deepEqual(window.addresses(), [`/acme/plan/${DOCUMENT_TASK.id}`]);
  assert.equal(window.history().canGoBack, false);
});

test("an Inbox told no column of its own until an item stands alone in it takes that item's step, so Back from the item leaves the Inbox rather than landing on a list no column shows", async () => {
  const ITEM = {
    taskId: "3c4d5e6f-0000-4000-8000-0000000000a1",
    itemId: "3c4d5e6f-0000-4000-8000-0000000000b2",
  };
  const base = tasksControl({ workspace: ACME, workspaces: [ACME] });
  const inbox = (chosen: typeof ITEM | undefined) =>
    tasksControl({
      workspace: ACME,
      workspaces: [ACME],
      inboxView: {
        ...base.inboxView,
        open: true,
        chosen,
        single: chosen !== undefined,
        listed: false,
      },
    });
  const window = mount(base);
  await settle();
  window.stand(inbox(undefined));
  await settle();
  window.stand(inbox(ITEM));
  await settle();
  const addresses = window.addresses();
  assert.equal(addresses.length, 2, "the Inbox and its first item are one step");
  assert.match(addresses.at(-1) ?? "", new RegExp(ITEM.itemId, "u"));
});

/** A press of the pointer, as lands before whatever door it opens. */
function press(): void {
  act(() => {
    globalThis.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
}

const AGENT_A = { agent: "agent-a" };
const AGENT_B = { agent: "agent-b" };
const AGENT_C = { agent: "agent-c" };

/** The task open on the column's tab and the side panel's tab given, its strips holding `agents`, every tab each strip is asked to show recorded in `shown`. */
function onTabs(input: {
  column: typeof AGENT_A | undefined;
  side?: SidePanelTab | undefined;
  agents?: readonly (typeof AGENT_A)[];
  shown?: string[];
}): TasksControl {
  const base = tasksControl();
  const agents = input.agents ?? [AGENT_A, AGENT_B, AGENT_C];
  return tasksControl({
    page: TASKS_PAGE.DOCUMENT,
    activeTaskId: TASK_ID,
    boundFor: TASK_ID,
    mainTabs: {
      ...base.mainTabs,
      tabs: agents,
      tab: input.column,
      openAgents: agents.map((tab) => tab.agent),
      onShow: (_taskId, tab) =>
        input.shown?.push(`column:${"agent" in tab ? tab.agent : tab.draft}`),
    },
    sidePanel: {
      ...base.sidePanel,
      open: input.side !== undefined,
      tab: input.side ?? SIDE_PANEL_TAB.PLAN,
      onShow: (_taskId, tab) => input.shown?.push(`side:${String(tab)}`),
    },
  });
}

/** Each step named as the window's root names the one it stands on (`stepTitle`). */
const namedAsShown = (tasks: TasksControl): StepTitle | undefined =>
  stepTitle(PANEL_TAB.TASKS, tasks);

/** The task the window lists, under `name`, its row naming agent A under `agentTitle` where one is given. */
function listedTask(name: string, agentTitle?: string): TaskSummary {
  const task: TaskSummary = {
    id: TASK_ID,
    workspaceId: "workspace",
    name,
    createdAt: 1,
    updatedAt: 2,
    repository: "acme/relay",
  };
  if (agentTitle === undefined) return task;
  const line = {
    id: AGENT_A.agent,
    title: agentTitle,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    status: CODING_AGENT_STATUS.COMPLETED,
  };
  const agents = { total: 1, working: 0, agents: [line], pullRequestTotal: 0, pullRequests: [] };
  return { ...task, agents };
}

/** Agent A as the open task's agents read it, under `title`. */
function openAgent(title: string): CodingAgentSummary {
  return {
    id: AGENT_A.agent,
    planId: TASK_ID,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title,
    createdAt: 1,
    status: CODING_AGENT_STATUS.COMPLETED,
    turnId: null,
  };
}

test("Back's list names a task and its agent's tab by the names they go by now, and an agent named nowhere now as the window called it there", () => {
  const open = onTabs({ column: AGENT_A });
  const window = mount(
    {
      ...open,
      tasks: [listedTask("Auth refactor")],
      agents: codingAgentsControl({ agents: [openAgent("Token refresh")] }),
    },
    memoryHistory(),
    namedAsShown,
  );
  press();
  window.stand(tasksControl({ tasks: [listedTask("Auth rewrite", "Token renewal")] }));
  assert.deepEqual(window.history().steps.back[0]?.title, {
    label: "Auth rewrite",
    detail: "Token renewal",
  });

  // The task's row no longer names the agent: its tab keeps the name it had.
  window.stand(tasksControl({ tasks: [listedTask("Auth rewrite")] }));
  assert.deepEqual(window.history().steps.back[0]?.title, {
    label: "Auth rewrite",
    detail: "Token refresh",
  });
});

test("Back's list names a renamed agent's tab by its name now beside a page's tab named as the window called it there, whose page is read only while its task is open", () => {
  const page = { page: "page-notes" };
  const open = onTabs({ column: AGENT_A, side: page });
  const window = mount(
    {
      ...open,
      sidePanel: { ...open.sidePanel, strip: [page] },
      tasks: [listedTask("Auth refactor")],
      agents: codingAgentsControl({ agents: [openAgent("Token refresh")] }),
      pages: [{ id: page.page, title: "Notes", version: 1, at: 1 }],
    },
    memoryHistory(),
    namedAsShown,
  );
  press();
  window.stand(tasksControl({ tasks: [listedTask("Auth refactor", "Token renewal")] }));
  assert.deepEqual(window.history().steps.back[0]?.title, {
    label: "Auth refactor",
    detail: "Token renewal · Notes",
  });
});

test("Back's list names a person's page by the name the workspace's members give them now, and by the name it was opened with while they are unread", async () => {
  let answer: (members: readonly WorkspaceMember[]) => void = () => undefined;
  fakeAppBridge({});
  fakeActPort({
    [ACT_KIND.WORKSPACE_MEMBERS_READ]: () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  });
  const workspace = {
    id: "workspace-acme",
    name: "Acme",
    role: WORKSPACE_ROLE.MEMBER,
    github: null,
  };
  const base = tasksControl();
  const window = mount(
    tasksControl({
      workspace,
      personView: {
        ...base.personView,
        userId: "user-lee",
        name: "Lee Park",
        workspaceId: workspace.id,
      },
    }),
    memoryHistory(),
    namedAsShown,
  );
  press();
  window.stand(
    tasksControl({
      workspace,
      page: TASKS_PAGE.DOCUMENT,
      activeTaskId: TASK_ID,
      boundFor: TASK_ID,
      tasks: [listedTask("Auth refactor")],
    }),
  );
  await settle();
  assert.equal(window.history().steps.back[0]?.title?.label, "Lee Park");

  const lee = { userId: "user-lee", name: "Lee Chen", email: "lee@example.com" };
  answer([{ ...lee, role: WORKSPACE_ROLE.MEMBER }]);
  await settle();
  assert.equal(window.history().steps.back[0]?.title?.label, "Lee Chen");
});

test("a tab chosen in the task's column or its side panel by a press is a step of its own, which Back goes back to on that tab", () => {
  const shown: string[] = [];
  const window = mount(onTabs({ column: AGENT_A, side: SIDE_PANEL_TAB.PLAN, shown }));
  press();
  window.stand(onTabs({ column: AGENT_B, side: SIDE_PANEL_TAB.PLAN, shown }));
  press();
  window.stand(onTabs({ column: AGENT_B, side: SIDE_PANEL_TAB.CODE, shown }));
  assert.equal(window.addresses().length, 3, "each tab chosen is a step");

  act(() => window.history().onBack());
  assert.deepEqual(shown, ["column:agent-b", "side:plan"], "Back shows the panel's tab before");
  act(() => window.history().onBack());
  assert.deepEqual(shown.slice(2), ["column:agent-a", "side:plan"], "and then the column's");
  assert.equal(window.history().canGoBack, false);
  assert.equal(window.history().canGoForward, true);
});

test("a tab the window chooses by itself, with no press leading to it, takes the step standing in place", () => {
  const window = mount(onTabs({ column: AGENT_A, side: SIDE_PANEL_TAB.PLAN }));
  window.stand(onTabs({ column: AGENT_B, side: SIDE_PANEL_TAB.PLAN }));
  window.stand(onTabs({ column: AGENT_B, side: SIDE_PANEL_TAB.CODE }));
  assert.equal(
    window.addresses().length,
    1,
    "an agent's tab shown as it starts, or a task's tabs arriving, adds nothing",
  );
  assert.equal(window.history().canGoBack, false);
});

test("a task's tabs arriving after it opens, and the side panel opening on its tab, fill in the task's step rather than adding one", () => {
  const window = mount(tasksControl());
  press();
  window.stand(
    tasksControl({ page: TASKS_PAGE.DOCUMENT, activeTaskId: TASK_ID, boundFor: TASK_ID }),
  );
  press();
  window.stand(onTabs({ column: AGENT_A }));
  press();
  window.stand(onTabs({ column: AGENT_A, side: SIDE_PANEL_TAB.CODE }));
  assert.equal(window.addresses().length, 2, "home, then the task on its tabs");
});

test("a step on a tab since closed is passed over by Back, which goes back to the tab before it", () => {
  const shown: string[] = [];
  const window = mount(onTabs({ column: AGENT_A, shown }));
  press();
  window.stand(onTabs({ column: AGENT_B, shown }));
  press();
  window.stand(onTabs({ column: AGENT_C, shown }));
  // Agent B's tab closed from the strip, leaving the column on C.
  window.stand(onTabs({ column: AGENT_C, agents: [AGENT_A, AGENT_C], shown }));

  act(() => window.history().onBack());
  assert.deepEqual(shown, ["column:agent-a"], "B's step is passed over");
  assert.equal(window.history().canGoBack, false);
});

test("an Inbox item chosen by a press where the Inbox splits is a step of its own, which Back chooses again", () => {
  const chosen: string[] = [];
  const onInbox = (itemId: string) =>
    tasksControl({
      inboxView: {
        ...tasksControl().inboxView,
        open: true,
        chosen: { itemId, taskId: TASK_ID },
        onChoose: (choice) => chosen.push(choice.itemId),
      },
    });
  const window = mount(onInbox("item-1"));
  press();
  window.stand(onInbox("item-2"));
  press();
  window.stand(onInbox("item-3"));
  assert.equal(window.addresses().length, 3);

  act(() => window.history().onBack());
  assert.deepEqual(chosen, ["item-2"]);
});

test("the side panel's tabs are steps though the task's agents are not read, as a task with none never reads them in a fixture run", () => {
  const shown: string[] = [];
  const unread = (side: SidePanelTab) => {
    const tasks = onTabs({ column: undefined, side, shown });
    return { ...tasks, mainTabs: { ...tasks.mainTabs, tabs: [], openAgents: undefined } };
  };
  const window = mount(unread(SIDE_PANEL_TAB.CODE));
  press();
  window.stand(unread(SIDE_PANEL_TAB.PLAN));
  assert.equal(window.addresses().length, 2);

  act(() => window.history().onBack());
  assert.deepEqual(shown, ["side:code"]);
});

test("a task opened again before its agents are read keeps the column it was last seen with, so a step on an agent's tab since closed is still passed over", () => {
  const shown: string[] = [];
  const window = mount(onTabs({ column: AGENT_A, shown }));
  press();
  window.stand(onTabs({ column: AGENT_B, shown }));
  press();
  window.stand(onTabs({ column: AGENT_C, shown }));
  // Agent B's tab closed from the strip, then the window goes home.
  window.stand(onTabs({ column: AGENT_C, agents: [AGENT_A, AGENT_C], shown }));
  press();
  window.stand(tasksControl());
  // The task opened again, its agents on their way.
  press();
  const unread = onTabs({ column: undefined, shown });
  window.stand({ ...unread, mainTabs: { ...unread.mainTabs, tabs: [], openAgents: undefined } });

  act(() => window.history().onBack());
  act(() => window.history().onBack());
  act(() => window.history().onBack());
  assert.deepEqual(shown, ["column:agent-c", "column:agent-a"], "home, then C, then A past B");
});

test("Back's and Forward's steps are listed the nearest first, each named as the window called it there, passing over a step it cannot reach, and a step listed is gone to at once", () => {
  const shown: string[] = [];
  const titled = (tasks: TasksControl): StepTitle | undefined => {
    const column = tasks.mainTabs.tab;
    return column === undefined || !("agent" in column)
      ? { label: "Home" }
      : { label: "Auth refactor", detail: column.agent };
  };
  const window = mount(tasksControl(), memoryHistory(), titled);
  press();
  window.stand(onTabs({ column: AGENT_A, shown }));
  press();
  window.stand(onTabs({ column: AGENT_B, shown }));
  press();
  window.stand(onTabs({ column: AGENT_C, shown }));

  const listed = window.history().steps.back;
  assert.deepEqual(
    listed.map((step) => step.title),
    [
      { label: "Auth refactor", detail: "agent-b" },
      { label: "Auth refactor", detail: "agent-a" },
      { label: "Home", detail: undefined },
    ],
  );
  const [first, second, third] = listed;
  assert.ok(first !== undefined && second !== undefined && third !== undefined);
  assert.ok(sameHistoryPage(first.page, second.page), "a task's steps are one page's");
  assert.ok(!sameHistoryPage(second.page, third.page));
  assert.deepEqual(window.history().steps.forward, []);

  const toA = listed[1]?.at;
  assert.ok(toA !== undefined);
  act(() => window.history().onGoTo(toA));
  assert.deepEqual(shown, ["column:agent-a"], "the step listed is gone to at once");
  assert.deepEqual(
    window.history().steps.forward.map((step) => step.title?.detail),
    ["agent-b", "agent-c"],
    "and the steps passed lie ahead, the nearest first",
  );

  // Agent B's tab closed: its step is no longer listed.
  window.stand(onTabs({ column: AGENT_A, agents: [AGENT_A, AGENT_C], shown }));
  assert.deepEqual(
    window.history().steps.forward.map((step) => step.title?.detail),
    ["agent-c"],
  );
});

/** What reads a workspace's channels as the sidebar does, so the window holds them, and its channel place as a surface drawing it reads it. */
async function channelsRead(workspaceId: string): Promise<() => ChannelPlaceControl> {
  let seen: ChannelPlaceControl | undefined;
  const Reader = () => {
    useChannels(workspaceId, true);
    seen = useChannelPlace();
    return null;
  };
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  act(() => root.render(onRegistry(AtomRegistry.make(), createElement(Reader))));
  await settle();
  return () => seen ?? assert.fail("the channel place is read");
}

test("with Channels on, a channel chosen and a thread opened in it are each a step, named and linked by the channel, which Back goes back through, closing the thread", async () => {
  handState(experimentsOn(EXPERIMENT.CHANNELS));
  const workspace = {
    id: "workspace-acme",
    name: "Acme",
    slug: "acme",
    role: WORKSPACE_ROLE.MEMBER,
    github: null,
  };
  const general = { id: "a1000001-0000-4000-8000-000000000001", name: "general" };
  const app = { id: "a1000001-0000-4000-8000-000000000002", name: "app" };
  fakeActPort({
    [ACT_KIND.CHANNELS_LIST]: () =>
      Promise.resolve({
        channels: [general, app].map((each) => ({
          ...each,
          purpose: "",
          project: false,
          createdAt: 1,
          waiting: 0,
        })),
      }),
  });
  listChannelWorkspace(workspace.id);
  const place = await channelsRead(workspace.id);
  const item = { itemId: "item-1", taskId: TASK_ID };
  const onInbox = (chosen: typeof item | undefined) => {
    const base = tasksControl();
    return tasksControl({
      workspace,
      workspaces: [workspace],
      inboxView: {
        ...base.inboxView,
        open: true,
        chosen,
        onOpen: () => undefined,
        onChoose: () => undefined,
      },
    });
  };
  const window = mount(onInbox(undefined), memoryHistory(), stepTitleOf);
  await settle();
  press();
  act(() => chooseChannel(app.id));
  press();
  act(() => openChannelThread(item.itemId, app.id));
  window.stand(onInbox(item));

  assert.deepEqual(window.addresses(), [
    `/acme/channel/${general.id}`,
    `/acme/channel/${app.id}`,
    `/acme/plan/${TASK_ID}/inbox/item-1`,
  ]);
  assert.deepEqual(
    window.history().steps.back.map((step) => step.title?.label),
    ["#app", "#general"],
  );
  act(() => window.history().onBack());
  assert.deepEqual(
    { channelId: place().channelId, threadId: place().threadId },
    { channelId: app.id, threadId: undefined },
  );
  act(() => window.history().onBack());
  assert.equal(place().channelId, general.id);
  handState({});
});

/** Each step named as the window's root names the one it stands on. */
function stepTitleOf(tasks: TasksControl): StepTitle | undefined {
  return stepTitle(PANEL_TAB.TASKS, tasks);
}
