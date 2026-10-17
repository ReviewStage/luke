// @vitest-environment jsdom

import assert from "node:assert/strict";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import { EXPERIMENT } from "@luke/settings";
import { SETTINGS_VIEW } from "@luke/settings/settings-views";
import { experimentsOn } from "@luke/settings/testing";
import { memoryHistory } from "@luke/ui/history-adapter";
import { TASKS_PAGE } from "@luke/ui/tasks-model";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, test } from "vitest";
import { handState } from "#testing/app-state";
import { onRegistry } from "#testing/copy-feedback";
import { tasksControl } from "#testing/tasks-control";
import { installWindowHistory, useWindowHistory, type WindowHistory } from "./navigation-history";
import { PANEL_TAB } from "./panel-tabs";
import {
  AUTOMATIONS_PAGE,
  type AutomationsPlace,
  ISSUES_PAGE,
  type IssuesPlace,
  type LeaveAsk,
  type TasksControl,
} from "./tasks/use-tasks-tab";

const TASK_ID = "0f6a2c4e-8b1d-4e3f-9a57-1c2b3d4e5f60";
const AUTOMATION_ID = "5d1e7a9c-3b2f-4c6d-8e0a-9f1b2c3d4e5a";

afterEach(() => {
  document.body.innerHTML = "";
});

/** The window's history over the Tasks tab as `plans` stands, restood by the returned setter, kept in a memory history of its own as a window's root installs one. */
function mount(initial: TasksControl) {
  const kept: Parameters<typeof installWindowHistory>[0] = memoryHistory();
  installWindowHistory(kept);
  let history: WindowHistory | undefined;
  let restand: ((tasks: TasksControl) => void) | undefined;
  function Probe() {
    const [tasks, setTasks] = useState(initial);
    restand = setTasks;
    history = useWindowHistory({
      known: true,
      tab: PANEL_TAB.TASKS,
      onTabChange: () => undefined,
      settingsView: SETTINGS_VIEW.ACCOUNT,
      onSettingsViewChange: () => undefined,
      tasks,
    });
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  // Each window reads its state under a registry of its own, as the window's root provides one.
  act(() => createRoot(container).render(onRegistry(AtomRegistry.make(), createElement(Probe))));
  return {
    history: () => {
      assert.ok(history);
      return history;
    },
    stand: (tasks: TasksControl) => act(() => restand?.(tasks)),
    /** The Luke link of the place the history stands on, where one names it. */
    address: () => kept.current().entries[kept.current().at]?.address,
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
  const atPlan = asking(
    tasksControl({
      page: TASKS_PAGE.DOCUMENT,
      activeTaskId: TASK_ID,
      boundFor: TASK_ID,
      onLeaveTask: () => homes.push("home"),
    }),
  );
  const window = mount(asking(tasksControl()));
  window.stand(atPlan);
  assert.equal(window.history().canGoBack, true);

  standing = ask;
  act(() => window.history().onBack());
  assert.deepEqual(homes, [], "the step waits on the ask");
  assert.equal(window.history().canGoBack, true, "and the trail has not moved");
  assert.equal(window.history().canGoForward, false);

  act(() => asked[0]?.());
  assert.deepEqual(homes, ["home"], "Leave takes the step it asked about");
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
  handState(experimentsOn(EXPERIMENT.AUTOMATIONS));
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
  handState(experimentsOn(EXPERIMENT.AUTOMATIONS));
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
  handState(experimentsOn(EXPERIMENT.AUTOMATIONS));
  const opened: (AutomationsPlace | undefined)[] = [];
  const window = mount(onAutomations({ kind: AUTOMATIONS_PAGE.LIST }, opened));
  await settle();
  window.stand(onAutomations({ kind: AUTOMATIONS_PAGE.NEW }, opened));
  window.stand(onAutomations({ kind: AUTOMATIONS_PAGE.EDIT, automationId: AUTOMATION_ID }, opened));

  act(() => window.history().onBack());

  assert.deepEqual(opened, [{ kind: AUTOMATIONS_PAGE.NEW }]);
});

test("an automation's page is of the workspace it stood in, so once another is listed Back passes over it", async () => {
  handState(experimentsOn(EXPERIMENT.AUTOMATIONS));
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
  handState(experimentsOn(EXPERIMENT.AUTOMATIONS));
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

test("the Issues page is its workspace's, so once another is listed Back passes over it", async () => {
  handState(experimentsOn(EXPERIMENT.ISSUES));
  let reopened = 0;
  const control = tasksControl();
  const acme = { id: "workspace-acme", name: "Acme", role: WORKSPACE_ROLE.MEMBER, github: null };
  const initech = { ...acme, id: "workspace-initech", name: "Initech" };
  const window = mount(
    tasksControl({
      workspace: acme,
      issuesView: { ...control.issuesView, open: true, onOpen: () => (reopened += 1) },
    }),
  );
  // The account's experiments arrive with the window's state, which the page is reachable by.
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  window.stand(
    tasksControl({
      workspace: initech,
      page: TASKS_PAGE.DOCUMENT,
      activeTaskId: TASK_ID,
      boundFor: TASK_ID,
    }),
  );

  assert.equal(window.history().canGoBack, false);
  assert.equal(reopened, 0);
});

test("an issue's page is a step of its own beside the Issues list, so Back from it opens the list and Forward the issue again", async () => {
  handState(experimentsOn(EXPERIMENT.ISSUES));
  const opened: (IssuesPlace | undefined)[] = [];
  const control = tasksControl();
  const standing = (place: IssuesPlace) =>
    tasksControl({
      issuesView: {
        ...control.issuesView,
        open: true,
        place,
        onOpen: (to) => opened.push(to),
      },
    });
  const issue = { kind: ISSUES_PAGE.ISSUE, issueId: "issue-1" } as const;
  const window = mount(standing({ kind: ISSUES_PAGE.LIST }));
  // The account's experiments arrive with the window's state, which the page is reachable by.
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  window.stand(standing(issue));

  act(() => window.history().onBack());
  window.stand(standing({ kind: ISSUES_PAGE.LIST }));
  act(() => window.history().onForward());

  assert.deepEqual(opened, [{ kind: ISSUES_PAGE.LIST }, issue]);
});

test("each place is held as the Luke link it is shared by under the workspace listed, and the home page, which no link names, as none", () => {
  const acme = {
    id: "workspace-acme",
    name: "Acme",
    slug: "acme",
    role: WORKSPACE_ROLE.MEMBER,
    github: null,
  };
  const window = mount(
    tasksControl({
      workspace: acme,
      page: TASKS_PAGE.DOCUMENT,
      activeTaskId: TASK_ID,
      boundFor: TASK_ID,
    }),
  );
  assert.equal(window.address(), `https://tryluke.dev/acme/plan/${TASK_ID}`);

  window.stand(tasksControl({ workspace: acme }));
  assert.equal(window.address(), undefined);

  window.stand(
    tasksControl({
      workspace: acme,
      automationsView: {
        open: true,
        place: { kind: AUTOMATIONS_PAGE.EDIT, automationId: AUTOMATION_ID, runId: "run-1" },
        onOpen: () => undefined,
        onClose: () => undefined,
      },
    }),
  );
  assert.equal(window.address(), `https://tryluke.dev/acme/automation/${AUTOMATION_ID}/run/run-1`);
});
