// @vitest-environment jsdom

import assert from "node:assert/strict";
import { TASK_PRIORITY, TASK_STATUS, type Task, type TaskStanding } from "@luke/features/task-wire";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { MemberDirectory } from "../member-directory.js";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { layContainersAt } from "../testing/container-width.js";
import { restOn } from "../testing/hint-rest.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { TaskKeyLine, TaskStandingChips } from "./task-standing.js";

/**
 * task-standing.test.ts -- a task's head names it by its key and says where
 * it stands and how much it matters: a pick from the status chip's menu is
 * handed to the page to send, the chips take no pick without a door to send
 * it through, and a task from a service before keys draws neither.
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

/** Draws the task's key and its chips into the document, with the door a pick is sent through. */
function drawn(task: Task, onSet: ((standing: TaskStanding) => void) | undefined): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render([
      createElement(TaskKeyLine, { key: "key", task, workspaceName: "Acme" }),
      createElement(TaskStandingChips, { key: "chips", task, onSet }),
    ]),
  );
  return host;
}

/** The chip a label names. */
function chip(host: HTMLElement, label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((button) =>
    (button.getAttribute("aria-label") ?? button.textContent ?? "").includes(label),
  );
  return found ?? assert.fail(`no ${label} chip`);
}

test("names the task by its workspace's prefix and its number, with its status and priority on its chips", () => {
  const host = drawn(TASK, () => undefined);

  assert.ok(host.textContent?.includes("ACME-42"));
  assert.ok(chip(host, "Status").textContent?.includes("Todo"));
  assert.ok(chip(host, "Priority").textContent?.includes("High"));
});

test("a status picked from the menu is handed to the page, and the one standing is not picked again", () => {
  const sent: TaskStanding[] = [];
  const host = drawn(TASK, (standing) => sent.push(standing));

  const pick = (words: string) => {
    act(() => chip(host, "Status").click());
    const row = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((each) =>
      each.textContent?.includes(words),
    );
    act(() => (row ?? assert.fail(`no ${words} row`)).click());
  };
  pick("Todo");
  pick("Done");

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

/**
 * A length the stylesheet draws, in pixels: its one `var()` read off what
 * `element` inherits, or its fallback, since jsdom resolves none.
 */
function drawnPixels(element: Element, value: string): number {
  const read = value.replace(
    /var\((--[\w-]+),\s*([^()]*)\)/u,
    (_, name: string, fallback: string) => {
      const inherited = getComputedStyle(element).getPropertyValue(name).trim();
      return inherited === "" ? fallback : inherited;
    },
  );
  return read === "none" ? Number.POSITIVE_INFINITY : Number.parseFloat(read);
}

test("the assignee's menu opened near the panel's right edge stands inside the panel rather than scrolling it sideways", () => {
  const panel = 390;
  const chipLeft = 300;
  const chipWidth = 80;
  const menuWidth = 280;
  layContainersAt({});
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(panel);
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
  // jsdom lays nothing out, so the chip's place and the menu's own width are answered as the panel would lay them.
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains("settings-picker-menu") ? menuWidth : 0;
  });
  const host = drawn(TASK, () => undefined);
  const assignee = chip(host, "Assignee");
  vi.spyOn(assignee, "getBoundingClientRect").mockReturnValue(
    new DOMRect(chipLeft, 100, chipWidth, 28),
  );

  act(() => assignee.click());
  const menu = document.querySelector(".settings-picker-menu") ?? assert.fail("the menu opens");
  const style = getComputedStyle(menu);
  const width = Math.min(menuWidth, drawnPixels(menu, style.maxWidth));
  const start =
    style.left === "auto"
      ? chipLeft + chipWidth - drawnPixels(menu, style.right) - width
      : chipLeft + drawnPixels(menu, style.left);

  assert.ok(
    start >= 0 && start + width <= panel,
    `the menu stands from ${start} to ${start + width}`,
  );
  assert.equal(width, menuWidth, "the menu keeps its whole width");
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
