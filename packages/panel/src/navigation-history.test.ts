// @vitest-environment jsdom

import assert from "node:assert/strict";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
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
import { useCopyLink } from "./links-at-hand.js";
import {
  installWindowHistory,
  MOUSE_BUTTON,
  useHistoryMouseButtons,
  useWindowHistory,
  type WindowHistory,
} from "./navigation-history.js";
import { PANEL_TAB } from "./panel-tabs.js";
import { SHELL_ROOM } from "./shell-room.js";
import {
  AUTOMATIONS_PAGE,
  type AutomationsPlace,
  type LeaveAsk,
  type TasksControl,
} from "./tasks/use-tasks-tab.js";
import { copyingInto, fakeAppPlatform, QUIET_PANEL } from "./testing/app-platform.js";
import { handState } from "./testing/app-state.js";
import { onRegistry } from "./testing/copy-feedback.js";
import { DOCUMENT_TASK } from "./testing/document-task.js";
import { tasksControl } from "./testing/tasks-control.js";

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
) {
  installWindowHistory(held);
  let history: WindowHistory | undefined;
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
      tasks,
    });
    useHistoryMouseButtons(history, true);
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

test("leaving a plan for the home page is a step Back returns from", () => {
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

/** The window with Chat standing or not, in the workspace given, each time Chat is asked to open counted in `opened`. */
function onChat(open: boolean, opened: string[], workspaceId = "workspace-acme"): TasksControl {
  const base = tasksControl();
  return tasksControl({
    workspace: { id: workspaceId, name: workspaceId, role: WORKSPACE_ROLE.MEMBER, github: null },
    chatView: { ...base.chatView, open, onOpen: () => opened.push(workspaceId) },
  });
}

test("Chat is the chat of the workspace it stood in, so Back returns to it in that workspace and passes over it once another is listed", async () => {
  handState(experimentsOn(EXPERIMENT.CHAT));
  const opened: string[] = [];
  const same = mount(onChat(true, opened));
  await settle();
  same.stand(onChat(false, opened));
  assert.equal(same.history().canGoBack, true);
  act(() => same.history().onBack());
  assert.deepEqual(opened, ["workspace-acme"]);

  const other = mount(onChat(true, opened));
  await settle();
  other.stand(onChat(false, opened, "workspace-platform"));
  assert.equal(other.history().canGoBack, false, "Chat of another workspace is no step back");
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

test("a place with no link stands at /app: the home page, and Chat though a task stands under it", () => {
  const window = mount(tasksControl({ workspaces: [ACME], workspace: ACME }));
  const task = onTask([ACME]);
  window.stand({ ...task, chatView: { ...task.chatView, open: true } });

  assert.deepEqual(window.addresses(), ["/app", "/app"]);
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
    tasksControl({ ...none, factoryView: { ...tasksControl().factoryView, open: true } }),
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
