// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AGENT_STATUS, type AgentSummary } from "@repo/features/agent-wire";
import type { TaskSummary } from "@repo/features/task-wire";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { isAgentTab, isDraftTab, isFileTab, isPageTab } from "@repo/ui/tab-strip-model";
import { DOCUMENT_REGION, TASKS_PAGE } from "@repo/ui/tasks-model";
import { createMemoryHistory } from "@tanstack/react-router";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { useAdminRoute } from "./admin/admin-route.js";
import { ADMIN_PAGE, ADMIN_TAB, type AdminView } from "./admin/routing.js";
import { runAppCommand } from "./app-commands.js";
import { type AutomationsRoute, useAutomationsRoute } from "./automations-route.js";
import { stepTitle } from "./history-titles.js";
import { useCopyLink } from "./links-at-hand.js";
import {
  MOUSE_BUTTON,
  type StepTitle,
  sameHistoryPage,
  savesStep,
  throughHistory,
  useHistoryMouseButtons,
  useRoutedStanding,
  useWindowHistory,
  type WindowHistoryLists,
} from "./navigation-history.js";
import { SHELL_ROOM } from "./shell-room.js";
import { chooseInboxTask, leaveInboxTask, useInboxTask } from "./tasks/use-inbox-task.js";
import { SIDE_PANEL_TAB, type SidePanelTab } from "./tasks/use-side-panel.js";
import {
  type AdminViewControl,
  AUTOMATIONS_PAGE,
  type AutomationsPlace,
  type LeaveAsk,
  type TasksControl,
} from "./tasks/use-tasks-tab.js";
import { fakeActPort, fakeAppBridge } from "./testing/app-bridge.js";
import { copyingInto, fakeAppPlatform, QUIET_PANEL } from "./testing/app-platform.js";
import { handHostReads } from "./testing/app-state.js";
import { onRegistry, settleQueries } from "./testing/copy-feedback.js";
import { DOCUMENT_TASK } from "./testing/document-task.js";
import { agentsControl, tasksControl } from "./testing/tasks-control.js";
import { type TestWindowRouter, windowRouter } from "./testing/window-router.js";
import { useVersionHistoryRoute } from "./version-history-route.js";
import {
  type BoardRoute,
  type PersonRoute,
  useBoardRoute,
  usePersonRoute,
} from "./workspace-routes.js";

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

beforeEach(() => fakeAppPlatform(QUIET_PANEL));

afterEach(unmountAll);

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

/** The window's history over the Tasks tab as `plans` stands, restood by the returned setter, kept in a memory history of its own under the window's router as a window's root mounts one, and its addresses written from the window's own Copy link, as the root wires it. */
function mount(
  initial: TasksControl,
  held: TestWindowRouter = windowRouter(),
  titled?: (tasks: TasksControl) => StepTitle | undefined,
) {
  let history: WindowHistoryLists | undefined;
  let shown: TasksControl | undefined;
  let restand: ((tasks: TasksControl) => void) | undefined;
  let admin: AdminViewControl | undefined;
  let board: BoardRoute | undefined;
  let person: PersonRoute | undefined;
  let automations: AutomationsRoute | undefined;
  function Probe() {
    const [standing, setTasks] = useState(initial);
    restand = setTasks;
    // The Board and a person's page stand where the router does, as the window's root reads them, and are left for the state's place.
    board = useBoardRoute({
      onClose: () => history?.onLeaveRouted(),
      onStay: () => history?.onStayRouted(),
    });
    person = usePersonRoute({
      onClose: () => history?.onLeaveRouted(),
      onStay: () => history?.onStayRouted(),
    });
    automations = useAutomationsRoute({
      narrow: false,
      onClose: () => history?.onLeaveRouted(),
      onStay: () => history?.onStayRouted(),
    });
    const versions = useVersionHistoryRoute({
      narrow: false,
      onClose: () => history?.onLeaveRouted(),
      onStay: () => history?.onStayRouted(),
    });
    const listedStep = standing.workspaces.find((each) => each.id === standing.workspace?.id)?.slug;
    const tasks: TasksControl = {
      ...standing,
      automationsView: {
        open: automations.open,
        place: automations.place,
        runs: automations.runs,
        onOpen: (to = { kind: AUTOMATIONS_PAGE.LIST }) => {
          if (listedStep !== undefined) automations?.onOpen(to, listedStep);
        },
        onRuns: automations.onRuns,
        onClose: automations.onClose,
      },
      boardView: { ...standing.boardView, open: board.open },
      personView: {
        ...standing.personView,
        userId: person.userId,
        name: person.name,
        workspaceId:
          person.workspace === undefined
            ? undefined
            : standing.workspaces.find(
                (each) => each.slug === person?.workspace || each.id === person?.workspace,
              )?.id,
      },
    };
    // Admin stands where the router does, as the window's root reads it.
    admin = useAdminRoute({
      listedSlug: () => tasks.workspaces.find((each) => each.id === tasks.workspace?.id)?.slug,
      onClose: () => undefined,
    });
    const copyLink = useCopyLink(
      tasks,
      undefined,
      true,
      SHELL_ROOM.WIDE,
      admin.open ? admin.view : undefined,
    );
    history = useWindowHistory({
      known: true,
      link: copyLink.placed,
      routed: useRoutedStanding(),
      settingsList: undefined,
      onSettingsList: () => undefined,
      automations,
      versionHistory: versions,
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
  act(() => root.render(held.provide(onRegistry(AtomRegistry.make(), createElement(Probe)))));
  return {
    history: () => {
      assert.ok(history);
      return history;
    },
    stand: (tasks: TasksControl) => act(() => restand?.(tasks)),
    /** Opens the Board of the workspace at `workspace` by the router, as the Board's own doors do. */
    openBoard: (workspace: string) => act(() => board?.onOpen(workspace)),
    /** Opens a person's page by the router, as a press on their name does. */
    openPerson: (userId: string, name: string | undefined, workspace: string) =>
      act(() => person?.onOpen(userId, name, workspace)),
    /** Opens an Automations page by the router, as its own doors do. */
    openAutomations: (to?: AutomationsPlace) => act(() => shown?.automationsView.onOpen(to)),
    /** Stands the automation's runs alone, or its setup again, as its Runs and its way back do. */
    automationRuns: (runs: boolean) => act(() => shown?.automationsView.onRuns(runs)),
    /** The name the person's page standing was opened with. */
    personName: () => person?.name,
    /** Leaves the routed place standing for `tasks`, the place a door into the window's state opens, in one move as the door makes it. */
    leaveFor: (tasks: TasksControl) =>
      act(() => {
        history?.onLeaveRouted();
        restand?.(tasks);
      }),
    /** Where the router's history stands. */
    at: () => held.history.location.pathname,
    /** Opens an Admin view by the router, as Admin's own doors do. */
    openAdmin: (view: AdminView) => act(() => admin?.onOpen(view)),
    /** Presses Escape where it reaches the Tasks tab, as the window's own listener hands it on. */
    escape: () => act(() => void shown?.back()),
    /** The address of every entry the router's history holds, oldest first. */
    addresses: () => held.addresses(),
    /** Moves the history by itself, as a browser's Back and Forward do, never through the window. */
    moveHistory: (delta: number) => act(() => held.history.go(delta)),
  };
}

/** Lets every promise settled so far run its continuations, the window's state among them. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

test("leaving a plan for Home is a step Back returns from", () => {
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

test("a step back canceled at the leave ask leaves the trail where the window stands, so the next step is the same step", () => {
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
  const held = windowRouter();
  const window = mount(askingThrough(ask, tasksControl()), held);
  const home = held.history.location.state.step;
  assert.ok(home !== undefined);
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
  const [, task] = held.addresses();
  assert.ok(task !== undefined);

  ask.current = (leave) => asked.push(leave);
  // The home page's entry from a visit the trail no longer holds, as a browser lands on one long behind.
  act(() => held.history.push("/app", { step: { ...home, index: home.index + 10 } }));
  assert.deepEqual(homes, [], "the move waits on the ask");
  assert.deepEqual(
    window.addresses(),
    ["/app", task, "/app", task],
    "the plan's step is written again",
  );
  assert.equal(held.at(), 3);

  act(() => asked[0]?.());
  assert.deepEqual(homes, ["home"], "Leave goes home");
  assert.equal(held.at(), 2);
});

test("a move landing on an entry holding no step opens Home, as a page loaded there does, and Home writes its step on it", () => {
  const homes: string[] = [];
  // An entry no window wrote, as one the page first loaded on, behind the one the window opens on.
  const loaded = () =>
    createMemoryHistory({ initialEntries: ["/acme/inbox", "/app"], initialIndex: 1 });
  const held = windowRouter(loaded());
  const window = mount(tasksControl(), held);
  window.stand(
    tasksControl({
      page: TASKS_PAGE.DOCUMENT,
      activeTaskId: TASK_ID,
      boundFor: TASK_ID,
      onLeaveTask: () => homes.push("home"),
    }),
  );

  window.moveHistory(-2);
  assert.deepEqual(homes, ["home"], "the plan is left for Home");
  unmountAll();

  const home = windowRouter(loaded());
  mount(tasksControl(), home);
  act(() => home.history.go(-1));
  assert.equal(home.history.location.href, "/app", "the window on Home writes its step there");
  assert.ok(savesStep(home.history.location));
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

test("Escape on a task opened from a person's page returns to that page", async () => {
  const left: string[] = [];
  const listed = { workspaces: [ACME], workspace: ACME, onLeaveTask: () => left.push(TASK_ID) };
  const window = mount(tasksControl(listed));
  window.openPerson("user-charles", undefined, ACME.slug);
  await settle();
  window.leaveFor(
    tasksControl({
      ...listed,
      page: TASKS_PAGE.DOCUMENT,
      activeTaskId: TASK_ID,
      boundFor: TASK_ID,
    }),
  );

  window.escape();
  await settle();

  assert.equal(window.at(), "/acme/person/user-charles");
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

test("Escape on a task whose step back is canceled at the leave ask moves nothing, and Leave takes that step", () => {
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

test("a person's page is a step of its own, which Back from a plan opened after it returns to, and another person's is another step", async () => {
  const listed = { workspaces: [ACME], workspace: ACME };
  const window = mount(tasksControl(listed));
  window.openPerson("user-charles", undefined, ACME.slug);
  window.openPerson("user-maya", undefined, ACME.slug);
  await settle();
  window.leaveFor(
    tasksControl({
      ...listed,
      page: TASKS_PAGE.DOCUMENT,
      activeTaskId: TASK_ID,
      boundFor: TASK_ID,
    }),
  );

  act(() => window.history().onBack());
  await settle();
  assert.equal(window.at(), "/acme/person/user-maya");
  act(() => window.history().onBack());
  await settle();
  assert.equal(window.at(), "/acme/person/user-charles");
});

test("a person's page is theirs in the workspace it stood in, so once another is listed Back passes over it", async () => {
  const window = mount(tasksControl({ workspaces: [ACME, PLATFORM], workspace: ACME }));
  window.openPerson("user-charles", undefined, ACME.slug);
  await settle();
  window.leaveFor(tasksControl({ workspaces: [ACME, PLATFORM], workspace: PLATFORM }));

  act(() => window.history().onBack());
  await settle();

  assert.notEqual(window.at(), "/acme/person/user-charles");
});

test("a person's page opened again with a newer name keeps that name, which Back opens it with", async () => {
  const listed = { workspaces: [ACME], workspace: ACME };
  const window = mount(tasksControl(listed));
  window.openPerson("user-lee", "Lee Park", ACME.slug);
  window.openPerson("user-lee", "Lee Chen", ACME.slug);
  await settle();
  window.leaveFor(
    tasksControl({
      ...listed,
      page: TASKS_PAGE.DOCUMENT,
      activeTaskId: TASK_ID,
      boundFor: TASK_ID,
    }),
  );

  act(() => window.history().onBack());
  await settle();

  assert.equal(window.at(), "/acme/person/user-lee");
  assert.equal(window.personName(), "Lee Chen");
});

test("an automation opened from the Automations list is a step of its own, which Back leaves for the list", async () => {
  const window = mount(tasksControl({ workspaces: [ACME], workspace: ACME }));
  window.openAutomations();
  await settle();
  window.openAutomations({ kind: AUTOMATIONS_PAGE.EDIT, automationId: AUTOMATION_ID });
  await settle();

  act(() => window.history().onBack());
  await settle();

  assert.equal(window.at(), "/acme/automations");
});

test("the automation a new automation's page made takes that page's step, so Back from it returns to the list it was opened from", async () => {
  const window = mount(tasksControl({ workspaces: [ACME], workspace: ACME }));
  window.openAutomations();
  await settle();
  window.openAutomations({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();
  window.openAutomations({
    kind: AUTOMATIONS_PAGE.EDIT,
    automationId: AUTOMATION_ID,
    created: true,
  });
  await settle();

  act(() => window.history().onBack());
  await settle();
  assert.equal(window.at(), "/acme/automations");
  act(() => window.history().onForward());
  await settle();
  assert.equal(window.at(), `/acme/automation/${AUTOMATION_ID}`);
});

test("on the desktop's width an automation's runs, stood alone by an editor narrower than its split, take its setup's step rather than a step of their own", async () => {
  const window = mount(tasksControl({ workspaces: [ACME], workspace: ACME }));
  window.openAutomations({ kind: AUTOMATIONS_PAGE.EDIT, automationId: AUTOMATION_ID });
  await settle();
  const behind = window.history().steps.back.length;

  window.automationRuns(true);
  await settle();

  assert.equal(window.at(), `/acme/automation/${AUTOMATION_ID}/runs`);
  assert.equal(window.history().steps.back.length, behind, "the runs took the setup's step");
});

test("another automation opened over a new automation's page, as a notification opens one, is a visit after it, which Back leaves for the new page", async () => {
  const window = mount(tasksControl({ workspaces: [ACME], workspace: ACME }));
  window.openAutomations({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();
  window.openAutomations({ kind: AUTOMATIONS_PAGE.EDIT, automationId: AUTOMATION_ID });
  await settle();

  act(() => window.history().onBack());
  await settle();

  assert.equal(window.at(), "/acme/automations/new");
});

test("an automation's page is of the workspace it stood in, so once another is listed Back passes over it", async () => {
  const window = mount(tasksControl({ workspaces: [ACME, PLATFORM], workspace: ACME }));
  window.openAutomations({ kind: AUTOMATIONS_PAGE.EDIT, automationId: AUTOMATION_ID });
  await settle();
  window.leaveFor(tasksControl({ workspaces: [ACME, PLATFORM], workspace: PLATFORM }));
  await settle();

  act(() => window.history().onBack());
  await settle();

  assert.notEqual(window.at(), `/acme/automation/${AUTOMATION_ID}`);
});

test("a deleted automation's page is passed over by Back, which returns to the page before it", async () => {
  const window = mount(tasksControl({ workspaces: [ACME], workspace: ACME }));
  window.openAutomations({ kind: AUTOMATIONS_PAGE.EDIT, automationId: "automation-kept" });
  await settle();
  window.openAutomations({ kind: AUTOMATIONS_PAGE.EDIT, automationId: AUTOMATION_ID });
  await settle();
  window.openAutomations({ kind: AUTOMATIONS_PAGE.LIST, deleted: AUTOMATION_ID });
  await settle();

  act(() => window.history().onBack());
  await settle();

  assert.equal(window.at(), "/acme/automation/automation-kept");
});

test("the Board is its workspace's tasks, so Back returns to it in that workspace and passes over it once another is listed", async () => {
  const same = mount(tasksControl({ workspaces: [ACME, PLATFORM], workspace: ACME }));
  same.openBoard(ACME.slug);
  await settle();
  same.leaveFor(onTask([ACME, PLATFORM]));
  act(() => same.history().onBack());
  await settle();
  assert.equal(same.at(), "/acme/tasks");
  unmountAll();

  const other = mount(tasksControl({ workspaces: [ACME, PLATFORM], workspace: ACME }));
  other.openBoard(ACME.slug);
  await settle();
  other.leaveFor(tasksControl({ workspaces: [ACME, PLATFORM], workspace: PLATFORM }));
  act(() => other.history().onBack());
  await settle();
  assert.notEqual(other.at(), "/acme/tasks", "the Board of another workspace is no step back");
});

const ACME = {
  id: "workspace-acme",
  name: "Acme",
  slug: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
};

const PLATFORM = {
  id: "workspace-platform",
  name: "Platform",
  slug: "platform",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
};

/** A task drawn in Acme, the workspaces as `workspaces` lists them, numbered `number` in it where given. */
function onTask(workspaces: TasksControl["workspaces"], number?: number): TasksControl {
  const task = { ...DOCUMENT_TASK, workspaceId: ACME.id };
  return tasksControl({
    page: TASKS_PAGE.DOCUMENT,
    activeTaskId: DOCUMENT_TASK.id,
    boundFor: DOCUMENT_TASK.id,
    region: {
      kind: DOCUMENT_REGION.READY,
      task: number === undefined ? task : { ...task, number },
    },
    workspaces,
    workspace: ACME,
  });
}

test("each step's address is the path of the link ⇧⌘C copies there", async () => {
  const copied: string[] = [];
  fakeAppPlatform({ ...QUIET_PANEL, ...copyingInto(copied) });
  const listed = { workspaces: [ACME], workspace: ACME };
  const places: TasksControl[] = [
    onTask([ACME], 42),
    tasksControl(listed),
    tasksControl({ ...listed, inboxView: { ...tasksControl().inboxView, open: true } }),
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
  assert.equal(copied[0], "https://vespin.dev/acme/task/42");
  assert.deepEqual(
    addresses,
    copied.map((link) => new URL(link).pathname),
  );
});

test("the Board stands at its workspace's /tasks and a person's page at /person/<id> though a task stands under them, as Copy link copies each", async () => {
  const copied: string[] = [];
  fakeAppPlatform({ ...QUIET_PANEL, ...copyingInto(copied) });
  const window = mount(onTask([ACME]));
  window.openBoard(ACME.slug);
  await settle();
  act(() => runAppCommand(APP_COMMAND.COPY_LINK));
  window.openPerson("user-charles", undefined, ACME.slug);
  await settle();
  act(() => runAppCommand(APP_COMMAND.COPY_LINK));
  await settle();

  assert.deepEqual(window.addresses().slice(1), ["/acme/tasks", "/acme/person/user-charles"]);
  assert.deepEqual(copied, [
    "https://vespin.dev/acme/tasks",
    "https://vespin.dev/acme/person/user-charles",
  ]);
});

test("the Admin place stands at its workspace's /admin though a task stands under it, a section at /admin/<section> in place, and an account's page at /admin/user/<id> as a step, as Copy link copies each", async () => {
  const copied: string[] = [];
  fakeAppPlatform({ ...QUIET_PANEL, ...copyingInto(copied) });
  const task = onTask([ACME]);
  const window = mount(task);
  window.openAdmin({ kind: ADMIN_TAB.DASHBOARD });
  window.openAdmin({ kind: ADMIN_TAB.COST });
  window.openAdmin({ kind: ADMIN_PAGE.ACCOUNT, id: "user-ada" });
  act(() => runAppCommand(APP_COMMAND.COPY_LINK));
  await settle();

  assert.deepEqual(window.addresses(), [
    `/acme/task/${DOCUMENT_TASK.id}`,
    "/acme/admin/cost",
    "/acme/admin/user/user-ada",
  ]);
  assert.deepEqual(copied, ["https://vespin.dev/acme/admin/user/user-ada"]);
});

test("Copy link copies the Admin view while Admin stands over the Inbox, the place its state still holds under it", async () => {
  const copied: string[] = [];
  fakeAppPlatform({ ...QUIET_PANEL, ...copyingInto(copied) });
  const window = mount(
    tasksControl({
      workspaces: [ACME],
      workspace: ACME,
      inboxView: { ...tasksControl().inboxView, open: true },
    }),
  );
  window.openAdmin({ kind: ADMIN_TAB.COST });
  act(() => runAppCommand(APP_COMMAND.COPY_LINK));
  await settle();

  assert.deepEqual(copied, ["https://vespin.dev/acme/admin/cost"]);
});

test("with no workspace listed, a place in a workspace has no link, so it stands at /app as Copy link offers nothing", async () => {
  const copied: string[] = [];
  fakeAppPlatform({ ...QUIET_PANEL, ...copyingInto(copied) });
  const none = { workspaces: [], workspace: undefined };
  const places: TasksControl[] = [
    tasksControl({ ...none, inboxView: { ...tasksControl().inboxView, open: true } }),
    tasksControl({ ...none, agentView: { ...tasksControl().agentView, agentId: "agent-1" } }),
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

test("a workspace's slug or a task's number read after the visit moves the standing step to its address, without a step of its own, as the home page a tab opened at /app moves to the workspace's", () => {
  for (const [unread, read, from, to] of [
    [
      onTask([]),
      onTask([ACME]),
      `/workspace-acme/task/${DOCUMENT_TASK.id}`,
      `/acme/task/${DOCUMENT_TASK.id}`,
    ],
    [onTask([ACME]), onTask([ACME], 42), `/acme/task/${DOCUMENT_TASK.id}`, "/acme/task/42"],
    [tasksControl(), tasksControl({ workspaces: [ACME], workspace: ACME }), "/app", "/acme"],
  ] as const) {
    const window = mount(unread);
    const before = window.addresses();
    window.stand(read);

    assert.deepEqual(before, [from]);
    assert.deepEqual(window.addresses(), [to]);
    assert.equal(window.history().canGoBack, false);
    unmountAll();
  }
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
  assert.equal(addresses.at(-1), `/acme/inbox/${ITEM.itemId}`);
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

/** The task open on the column's tab and the side panel's tab given, or the panel shut, its strips holding `agents`, every tab each strip is asked to show recorded in `shown`, and the panel shut as `side:shut`; `opened` counts the things a link opened in the panel. */
function onTabs(input: {
  column: typeof AGENT_A | undefined;
  side?: SidePanelTab | undefined;
  agents?: readonly (typeof AGENT_A)[];
  shown?: string[];
  opened?: number;
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
        input.shown?.push(
          `column:${isAgentTab(tab) ? tab.agent : isDraftTab(tab) ? tab.draft : tab}`,
        ),
    },
    sidePanel: {
      ...base.sidePanel,
      open: input.side !== undefined,
      tab: input.side ?? SIDE_PANEL_TAB.INBOX,
      opened: input.opened ?? 0,
      onShow: (_taskId, tab) => input.shown?.push(`side:${isFileTab(tab) ? tab.file : tab}`),
      onSetOpen: (open) => {
        if (!open) input.shown?.push("side:shut");
      },
    },
  });
}

/** Each step named as the window's root names the one it stands on (`stepTitle`). */
const namedAsShown = (tasks: TasksControl): StepTitle | undefined => stepTitle(undefined, tasks);

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
    status: AGENT_STATUS.COMPLETED,
  };
  const agents = { total: 1, working: 0, agents: [line], pullRequestTotal: 0, pullRequests: [] };
  return { ...task, agents };
}

/** Agent A as the open task's agents read it, under `title`. */
function openAgent(title: string): AgentSummary {
  return {
    id: AGENT_A.agent,
    planId: TASK_ID,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title,
    createdAt: 1,
    status: AGENT_STATUS.COMPLETED,
    turnId: null,
  };
}

test("Back's list names a task and its agent's tab by the names they go by now, and an agent named nowhere now as the window called it there", () => {
  const open = onTabs({ column: AGENT_A });
  const window = mount(
    {
      ...open,
      tasks: [listedTask("Auth refactor")],
      agents: agentsControl({ agents: [openAgent("Token refresh")] }),
    },
    windowRouter(),
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
      agents: agentsControl({ agents: [openAgent("Token refresh")] }),
      pages: [{ id: page.page, title: "Notes", version: 1, at: 1 }],
    },
    windowRouter(),
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
  fakeAppBridge({});
  fakeActPort({});
  const reads = handHostReads({});
  const workspace = {
    id: "workspace-acme",
    name: "Acme",
    role: WORKSPACE_ROLE.MEMBER,
    github: null,
  };
  const window = mount(
    tasksControl({ workspaces: [workspace], workspace }),
    windowRouter(),
    namedAsShown,
  );
  press();
  window.openPerson("user-lee", "Lee Park", workspace.id);
  await settle();
  window.leaveFor(
    tasksControl({
      workspaces: [workspace],
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
  reads.deliverMembers({
    [workspace.id]: { rows: { members: [{ ...lee, role: WORKSPACE_ROLE.MEMBER }] } },
  });
  await settle();
  // Note that the members are read through Query, which tells its readers on its own queue.
  await settleQueries();
  assert.equal(window.history().steps.back[0]?.title?.label, "Lee Chen");
});

test("a tab chosen in the task's column by a press is a step of its own, which Back goes back to on that tab, while one chosen in the side panel's strip takes the standing step in place", () => {
  const shown: string[] = [];
  const notes = { file: "docs/notes.md" };
  const beside = (column: typeof AGENT_A, side: SidePanelTab) => {
    const tasks = onTabs({ column, side, shown });
    return { ...tasks, sidePanel: { ...tasks.sidePanel, strip: [SIDE_PANEL_TAB.COMMENTS, notes] } };
  };
  const window = mount(beside(AGENT_A, SIDE_PANEL_TAB.COMMENTS));
  press();
  window.stand(beside(AGENT_B, SIDE_PANEL_TAB.COMMENTS));
  press();
  window.stand(beside(AGENT_B, notes));
  assert.equal(window.addresses().length, 2, "the column's tab is a step, the panel's is not");

  act(() => window.history().onBack());
  assert.deepEqual(shown, ["column:agent-a", "side:comments"]);
  assert.equal(window.history().canGoBack, false);
  assert.equal(window.history().canGoForward, true);
});

test("a page a link opens in the side panel is one step, which Back undoes, shutting the panel it opened, and Forward opens again", () => {
  const shown: string[] = [];
  const notes = { file: "docs/notes.md" };
  const window = mount(onTabs({ column: AGENT_A, shown }));
  press();
  window.stand(onTabs({ column: AGENT_A, side: notes, opened: 1, shown }));
  assert.equal(window.addresses().length, 2);

  act(() => window.history().onBack());
  assert.deepEqual(shown, ["column:agent-a", "side:shut"]);
  act(() => window.history().onForward());
  assert.deepEqual(shown.slice(2), ["column:agent-a", "side:docs/notes.md"]);
});

test("an Inbox item's step holds the panel beside it, so Back from the next item opens it again on what a link opened there, and Back again stands the item shut", () => {
  const OTHER_TASK = "7e8f9a0b-0000-4000-8000-0000000000c3";
  const done: string[] = [];
  const page = { page: "page-plan" };
  const onItem = (taskId: string, itemId: string, side: SidePanelTab | undefined, opened = 0) => {
    const base = tasksControl();
    return tasksControl({
      inboxView: {
        ...base.inboxView,
        open: true,
        chosen: { itemId, taskId },
        onChoose: (choice) => done.push(`item:${choice.itemId}`),
      },
      sidePanel: {
        ...base.sidePanel,
        open: side !== undefined,
        tab: side,
        opened,
        onShow: (holder, tab) => done.push(`side:${holder}:${isPageTab(tab) ? tab.page : tab}`),
        onSetOpen: (open) => done.push(open ? "side:open" : "side:shut"),
      },
    });
  };
  const window = mount(onItem(TASK_ID, "item-a", undefined));
  press();
  window.stand(onItem(TASK_ID, "item-a", page, 1));
  press();
  window.stand(onItem(OTHER_TASK, "item-b", undefined, 1));
  assert.equal(
    window.addresses().length,
    3,
    "the item, the page a link opened beside it, the next item",
  );

  act(() => window.history().onBack());
  assert.deepEqual(done, ["item:item-a", `side:${TASK_ID}:page-plan`]);
  window.stand(onItem(TASK_ID, "item-a", page, 2));
  act(() => window.history().onBack());
  assert.deepEqual(done.slice(2), ["item:item-a", "side:shut"]);
});

test("a tab the window chooses by itself, with no press leading to it, takes the step standing in place", () => {
  const window = mount(onTabs({ column: AGENT_A, side: SIDE_PANEL_TAB.INBOX }));
  window.stand(onTabs({ column: AGENT_B, side: SIDE_PANEL_TAB.INBOX }));
  window.stand(onTabs({ column: AGENT_B, side: SIDE_PANEL_TAB.COMMENTS }));
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
  window.stand(onTabs({ column: AGENT_A, side: SIDE_PANEL_TAB.COMMENTS }));
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
  assert.deepEqual(shown, ["column:agent-a", "side:shut"], "B's step is passed over");
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

test("the side panel's tabs a link opens are steps though the task's agents are not read, as a task with none never reads them in a fixture run", () => {
  const shown: string[] = [];
  const unread = (side: SidePanelTab, opened: number) => {
    const tasks = onTabs({ column: undefined, side, shown, opened });
    return { ...tasks, mainTabs: { ...tasks.mainTabs, tabs: [], openAgents: undefined } };
  };
  const window = mount(unread(SIDE_PANEL_TAB.COMMENTS, 0));
  press();
  window.stand(unread({ file: "docs/notes.md" }, 1));
  assert.equal(window.addresses().length, 2);

  act(() => window.history().onBack());
  assert.deepEqual(shown, ["side:comments"]);
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
  assert.deepEqual(
    shown,
    ["column:agent-c", "side:shut", "column:agent-a", "side:shut"],
    "home, then C, then A past B",
  );
});

test("Back's and Forward's steps are listed the nearest first, each named as the window called it there, passing over a step it cannot reach, and a step listed is gone to at once", () => {
  const shown: string[] = [];
  const titled = (tasks: TasksControl): StepTitle | undefined => {
    const column = tasks.mainTabs.tab;
    return column === undefined || !isAgentTab(column)
      ? { label: "Home" }
      : { label: "Auth refactor", detail: column.agent };
  };
  const window = mount(tasksControl(), windowRouter(), titled);
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
  assert.deepEqual(shown, ["column:agent-a", "side:shut"], "the step listed is gone to at once");
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

/** Each step named as the window's root names the one it stands on. */
function stepTitleOf(tasks: TasksControl): StepTitle | undefined {
  return stepTitle(undefined, tasks);
}

test("a task the Inbox is narrowed to is a step linked by it, which Back leaves for the Inbox and Forward narrows to again", async () => {
  const workspace = {
    id: "workspace-acme",
    name: "Acme",
    slug: "acme",
    role: WORKSPACE_ROLE.MEMBER,
    github: null,
  };
  const taskId = "a1000001-0000-4000-8000-0000000000b1";
  leaveInboxTask();
  let narrowed: string | undefined;
  const Reader = () => {
    narrowed = useInboxTask();
    return null;
  };
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  act(() => root.render(createElement(Reader)));
  const base = tasksControl();
  const onInbox = tasksControl({
    workspace,
    workspaces: [workspace],
    inboxView: { ...base.inboxView, open: true, onOpen: leaveInboxTask, onChoose: () => undefined },
  });
  const window = mount(onInbox, windowRouter(), stepTitleOf);
  await settle();
  press();
  act(() => chooseInboxTask(taskId));

  assert.deepEqual(window.addresses(), ["/acme/inbox", `/acme/inbox/task/${taskId}`]);
  act(() => window.history().onBack());
  assert.equal(narrowed, undefined, "Back shows every task's items");
  act(() => window.history().onForward());
  assert.equal(narrowed, taskId, "Forward narrows to the task again");
});

test("each surface the window opens is counted once, by its kind and layout alone, and not again while it stands", () => {
  const counted: unknown[] = [];
  fakeAppPlatform({
    ...QUIET_PANEL,
    recordSurfaceEvent: (name, properties) => counted.push([name, properties]),
  });
  const opened = (surface: string) => ["surface:open", { surface, layout: "wide" }];
  const file = { file: "src/relay.ts" };
  const window = mount(onTabs({ column: undefined }));
  assert.deepEqual(counted, [opened("task")]);

  // The same place drawn again, as a render or a state patch does, counts nothing.
  window.stand(onTabs({ column: undefined }));
  assert.equal(counted.length, 1);

  // The column keeps its plan while the side panel opens a file: one more surface, and only that.
  window.stand(onTabs({ column: undefined, side: file }));
  assert.deepEqual(counted.slice(1), [opened("files")]);

  // The column moving to an agent opens it; the file stays open and is not counted again.
  window.stand(onTabs({ column: AGENT_A, side: file }));
  assert.deepEqual(counted.slice(2), [opened("agent")]);

  window.stand(tasksControl({ inboxView: { ...tasksControl().inboxView, open: true } }));
  assert.deepEqual(counted.slice(3), [opened("inbox")]);

  // The task's Overview in the column and its Inbox in the side panel are two panes, each counted.
  window.stand(onTabs({ column: undefined, side: SIDE_PANEL_TAB.INBOX }));
  assert.deepEqual(counted.slice(4), [opened("task"), opened("inbox")]);
});
