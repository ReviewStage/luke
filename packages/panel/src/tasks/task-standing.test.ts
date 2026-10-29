// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  MERGE_POLICY,
  TASK_MODE,
  TASK_PRIORITY,
  TASK_STATUS,
  type Task,
  type TaskStanding,
} from "@luke/features/task-wire";
import { TASK_CALL_FAILURE } from "@luke/features/tasks-view";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { runAppCommand } from "../app-commands.js";
import { MemberDirectory } from "../member-directory.js";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { restOn } from "../testing/hint-rest.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import type { RepositoryChooser } from "./repository-chip.js";
import { TaskKeyLine, type TaskRepositoryDoor, TaskStandingChips } from "./task-standing.js";

/**
 * task-standing.test.ts -- a task's head names it by its key and says where
 * it stands and how much it matters: a pick from the status chip's menu is
 * handed to the page to send, the chips take no pick without a door to send
 * it through, the repository's chip stands among them where the page hands
 * its doors, and a task from a service before keys draws neither.
 */

const TASK: Task = {
  id: "0f6a2c4e-8b1d-4e3f-9a57-1c2b3d4e5f60",
  workspaceId: "workspace-acme",
  name: "Fix Safari login cookie",
  createdAt: 1,
  updatedAt: 2,
  repository: "acme/web",
  status: TASK_STATUS.TODO,
  priority: TASK_PRIORITY.HIGH,
  number: 42,
  document: { body: "", assumptions: [] },
};

const roots: Root[] = [];

beforeEach(() => {
  installScrollIntoView();
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  vi.restoreAllMocks();
});

/** Draws the task's key and its chips into the document, with the door a pick is sent through, and the repository chip's doors where handed. */
function drawn(
  task: Task,
  onSet: ((standing: TaskStanding) => void) | undefined,
  repository?: TaskRepositoryDoor,
): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render([
      createElement(TaskKeyLine, { key: "key", task, workspaceName: "Acme" }),
      createElement(TaskStandingChips, { key: "chips", task, onSet, repository }),
    ]),
  );
  return host;
}

/** A chooser whose read never lands, for a chip that only says. */
const UNREAD_CHOOSER: RepositoryChooser = {
  recent: [],
  read: () => Promise.resolve({ failure: TASK_CALL_FAILURE.UNANSWERED }),
  openGitHub: () => undefined,
  pictures: false,
  manages: true,
};

/** The chip a label names. */
function chip(host: HTMLElement, label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((button) =>
    (button.getAttribute("aria-label") ?? button.textContent ?? "").includes(label),
  );
  return found ?? assert.fail(`no ${label} chip`);
}

/** The Auto-merge switch a task's head draws. */
function autoMerge(host: HTMLElement): HTMLElement {
  return (
    host.querySelector<HTMLElement>('[role="switch"][aria-label="Auto-merge"]') ??
    assert.fail("no Auto-merge switch")
  );
}

test("names the task by its workspace's prefix and its number, with its status and priority on its chips", () => {
  const host = drawn(TASK, () => undefined);

  assert.ok(host.textContent?.includes("ACME-42"));
  assert.ok(chip(host, "Status").textContent?.includes("Todo"));
  assert.ok(chip(host, "Priority").textContent?.includes("High"));
});

test("the repository chip stands among the chips where the page hands its doors, reading the repository, or Choose a repository on a task with none, and an ask from elsewhere opens its menu", async () => {
  const picks: string[] = [];
  const door: TaskRepositoryDoor = {
    chooser: UNREAD_CHOOSER,
    onChoose: (pick) => picks.push(pick),
  };
  const named = drawn(TASK, () => undefined, door);
  await act(async () => undefined);
  const row = named.querySelector(".plan-task-standing");
  assert.ok(row?.textContent?.includes("acme/web"), "the chip reads the repository");
  assert.ok(row?.textContent?.includes("High"), "beside the standing chips");
  assert.equal(chip(named, "acme/web").getAttribute("aria-expanded"), "false");

  const bare = drawn({ ...TASK, repository: null }, () => undefined, { ...door, openRequest: 1 });
  await act(async () => undefined);
  const choose = chip(bare, "Choose a repository");
  assert.equal(choose.getAttribute("aria-expanded"), "true", "⌘K's ask opens its menu");

  const without = drawn(TASK, () => undefined);
  assert.equal(without.textContent?.includes("acme/web"), false, "no doors, no chip");

  // A task from a service before statuses draws no standing chip, and still its repository's.
  const { status: _status, priority: _priority, ...before } = TASK;
  const legacy = drawn(before, () => undefined, door);
  await act(async () => undefined);
  assert.ok(legacy.textContent?.includes("acme/web"), "the chip does not wait on the standing");
  assert.equal(legacy.querySelector('[aria-label^="Status"]'), null);
});

test("a pilot task's Auto-merge switch is on while it merges on green, and a press sends the other policy", () => {
  const sent: TaskStanding[] = [];
  const pilot: Task = { ...TASK, mode: TASK_MODE.PILOT };
  const on = drawn(pilot, (standing) => sent.push(standing));
  const merging = autoMerge(on);
  assert.equal(merging.getAttribute("aria-checked"), "true");
  act(() => merging.click());

  const off = drawn({ ...pilot, mergePolicy: MERGE_POLICY.HOLD }, (standing) =>
    sent.push(standing),
  );
  const holding = autoMerge(off);
  assert.equal(holding.getAttribute("aria-checked"), "false");
  act(() => holding.click());

  assert.deepEqual(sent, [
    { mergePolicy: MERGE_POLICY.HOLD },
    { mergePolicy: MERGE_POLICY.MERGE_ON_GREEN },
  ]);
  assert.equal(drawn(TASK, () => undefined).querySelector('[role="switch"]'), null);
});

test("a status picked from the menu, opened by its chip or by S, is handed to the page, and the one standing is not picked again", () => {
  const sent: TaskStanding[] = [];
  const host = drawn(TASK, (standing) => sent.push(standing));

  const pick = (open: () => void, words: string) => {
    act(open);
    const row = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((each) =>
      each.textContent?.includes(words),
    );
    act(() => (row ?? assert.fail(`no ${words} row`)).click());
  };
  pick(() => chip(host, "Status").click(), "Todo");
  pick(() => {
    assert.ok(runAppCommand(APP_COMMAND.SET_STATUS), "the plan's chips answer S");
  }, "Done");

  assert.deepEqual(sent, [{ status: TASK_STATUS.DONE }]);
});

test("the chips take no pick without a door to send it, and a task from a service before keys draws neither", () => {
  const archived = drawn(TASK, undefined);
  assert.equal(chip(archived, "Status").disabled, true);
  assert.equal(chip(archived, "Priority").disabled, true);
  assert.equal(chip(archived, "Assignee").disabled, true);

  const { status: _status, priority: _priority, number: _number, ...older } = TASK;
  const before = drawn(older, () => undefined);
  assert.equal(before.textContent, "");
});

test("the assignee chip names who the task is assigned to, or no one, and No assignee picked is handed to the page as null", () => {
  const sent: TaskStanding[] = [];
  const unassigned = drawn(TASK, (standing) => sent.push(standing));
  assert.ok(chip(unassigned, "Assignee").textContent?.includes("No assignee"));

  const assigned = drawn(
    { ...TASK, assignee: { userId: "user-ada", name: "Ada Lovelace" } },
    (standing) => sent.push(standing),
  );
  assert.ok(chip(assigned, "Assignee").textContent?.includes("Ada Lovelace"));
  const pickNoAssignee = (host: HTMLElement) => {
    act(() => chip(host, "Assignee").click());
    const row = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((each) =>
      each.textContent?.includes("No assignee"),
    );
    act(() => (row ?? assert.fail("no No assignee row")).click());
  };
  pickNoAssignee(unassigned);
  pickNoAssignee(assigned);

  assert.deepEqual(sent, [{ assigneeId: null }]);
});

test("the assignee's menu lists No assignee, then the reader, then every other member by name, and a member picked is handed to the page by id", async () => {
  const member = (userId: string, name: string) => ({
    userId,
    name,
    email: `${userId}@acme.test`,
    role: WORKSPACE_ROLE.MEMBER,
  });
  fakeAppBridge({});
  fakeActPort({
    [ACT_KIND.WORKSPACE_MEMBERS_READ]: () =>
      Promise.resolve([
        member("user-grace", "Grace Hopper"),
        member("user-dean", "Dean"),
        member("user-ada", "Ada Lovelace"),
      ]),
    [ACT_KIND.WORKSPACE_FORMER_MEMBERS_READ]: () => Promise.resolve([]),
  });
  const sent: TaskStanding[] = [];
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      createElement(MemberDirectory, {
        workspace: { id: "workspace-acme", memberCount: 3 },
        readerId: "user-dean",
        children: createElement(TaskStandingChips, {
          task: TASK,
          onSet: (standing: TaskStanding) => sent.push(standing),
        }),
      }),
    );
  });

  act(() => chip(host, "Assignee").click());
  const rows = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
  assert.deepEqual(
    rows.map((row) => row.textContent),
    [
      "No assignee",
      "DDeanYou",
      "AAda Lovelaceuser-ada@acme.test",
      "GGrace Hopperuser-grace@acme.test",
    ],
  );
  restOn(rows[2] ?? assert.fail("no Ada row"));
  const card = document.querySelector('.luke-tooltip-card [data-actor-card="person"]');
  assert.equal(card?.querySelector(".luke-hover-card-name")?.textContent, "Ada Lovelace");
  assert.match(card?.textContent ?? "", /user-ada@acme\.test/u);
  act(() => (rows[2] ?? assert.fail("no Ada row")).click());

  assert.deepEqual(sent, [{ assigneeId: "user-ada" }]);
});

test("the assignee's menu says it is reading while the members are unread, and never that none match", async () => {
  fakeAppBridge({});
  fakeActPort({
    [ACT_KIND.WORKSPACE_MEMBERS_READ]: () => new Promise(() => undefined),
    [ACT_KIND.WORKSPACE_FORMER_MEMBERS_READ]: () => new Promise(() => undefined),
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      createElement(MemberDirectory, {
        workspace: { id: "workspace-acme", memberCount: 3 },
        readerId: "user-dean",
        children: createElement(TaskStandingChips, { task: TASK, onSet: () => undefined }),
      }),
    );
  });

  act(() => chip(host, "Assignee").click());

  assert.match(
    document.querySelector(".luke-combobox-note")?.textContent ?? "",
    /Reading members/u,
  );
  assert.equal(document.querySelector(".luke-combobox-empty"), null);
});

test("the assignee's menu says No members match when a search finds nobody", async () => {
  fakeAppBridge({});
  fakeActPort({
    [ACT_KIND.WORKSPACE_MEMBERS_READ]: () =>
      Promise.resolve([
        {
          userId: "user-ada",
          name: "Ada Lovelace",
          email: "user-ada@acme.test",
          role: WORKSPACE_ROLE.MEMBER,
        },
      ]),
    [ACT_KIND.WORKSPACE_FORMER_MEMBERS_READ]: () => Promise.resolve([]),
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      createElement(MemberDirectory, {
        workspace: { id: "workspace-acme", memberCount: 1 },
        readerId: "user-dean",
        children: createElement(TaskStandingChips, { task: TASK, onSet: () => undefined }),
      }),
    );
  });

  act(() => chip(host, "Assignee").click());
  const input = document.querySelector<HTMLInputElement>('input[role="combobox"]');
  // Note that the value goes in through the prototype's setter, because React
  // tracks the field's own and would read a change made there as none.
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(input, "zzz");
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });

  assert.equal(document.querySelector(".luke-combobox-empty")?.textContent, "No members match");
});

test("the assignee's menu says the members could not be read, with Retry, never that none match, and Retry reads them again", async () => {
  let reads = 0;
  fakeAppBridge({});
  fakeActPort({
    [ACT_KIND.WORKSPACE_MEMBERS_READ]: () => {
      reads += 1;
      return reads === 1
        ? Promise.reject(new Error("offline"))
        : Promise.resolve([
            {
              userId: "user-ada",
              name: "Ada Lovelace",
              email: "ada@acme.test",
              role: WORKSPACE_ROLE.MEMBER,
            },
          ]);
    },
    [ACT_KIND.WORKSPACE_FORMER_MEMBERS_READ]: () => Promise.resolve([]),
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      createElement(MemberDirectory, {
        workspace: { id: "workspace-acme", memberCount: 1 },
        readerId: "user-dean",
        children: createElement(TaskStandingChips, { task: TASK, onSet: () => undefined }),
      }),
    );
  });

  act(() => chip(host, "Assignee").click());

  const note = document.querySelector(".luke-combobox-note");
  assert.match(note?.textContent ?? "", /Members could not be read\./u);
  assert.equal(document.querySelector(".luke-combobox-empty"), null);
  const retry =
    [...(note?.querySelectorAll("button") ?? [])].find((button) =>
      (button.textContent ?? "").includes("Retry"),
    ) ?? assert.fail("no Retry");
  await act(async () => retry.click());

  assert.equal(document.querySelector(".luke-combobox-note"), null);
  assert.ok(
    [...document.querySelectorAll('[role="option"]')].some((row) =>
      (row.textContent ?? "").includes("Ada Lovelace"),
    ),
  );
});
