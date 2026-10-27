// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CHECK_SUMMARY, PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@luke/features/inbox-wire";
import { TASK_PRIORITY, TASK_STATUS, type TaskSummary } from "@luke/features/task-wire";
import type { Workspace } from "@luke/features/workspace-wire";
import type { AppInboxTask, AppInboxTaskHolding } from "@luke/host/app-state";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { type InboxSettler, useInboxSettler } from "../tasks/inbox-settling.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { tasksControl } from "../testing/tasks-control.js";
import { useTasksWaiting } from "./places-waiting.js";
import { PullRequestLine, TaskRowStatus, taskCardOf } from "./task-card.js";

/**
 * task-card.test.ts -- a task's hover card leads with where the task stands,
 * its key, its status, its priority, and who is on it, and keeps where it
 * lives, its repository, at its foot under what is moving on it; and a
 * task's row wears waiting on you exactly while the Inbox counts a question
 * waiting on the reader.
 */

const ACME = {
  id: "workspace-acme",
  name: "Acme",
  role: "owner",
  github: null,
  memberCount: 1,
} as const satisfies Workspace;

const TASK: TaskSummary = {
  id: "t-42",
  workspaceId: ACME.id,
  name: "Teammate invitations",
  repository: "acme/app",
  createdAt: 1,
  updatedAt: 2,
  status: TASK_STATUS.IN_PROGRESS,
  priority: TASK_PRIORITY.HIGH,
  number: 42,
};

const roots: Root[] = [];

beforeEach(() => {
  fakeAppPlatform(QUIET_PANEL);
  fakeAppBridge({});
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

/** The card of `task`, drawn alone, read under Acme. */
function drawn(task: TaskSummary): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const tasks = tasksControl({ workspace: ACME, workspaces: [ACME], tasks: [task] });
  act(() => root.render(onRegistry(AtomRegistry.make(), taskCardOf(tasks, task, 10))));
  const card = container.querySelector<HTMLElement>("[data-task-card]");
  assert.ok(card, "the card is drawn");
  return card;
}

test("a task's card leads with its key, its status, its priority, and who is on it, then its name, and keeps its repository at its foot", () => {
  const card = drawn(TASK);
  const parts = [...card.children];
  assert.deepEqual(
    [...(parts[0]?.children ?? [])].map((each) => [
      each.hasAttribute("data-task-key")
        ? "key"
        : each.classList.contains("luke-badge")
          ? "badge"
          : each.className,
      each.textContent,
    ]),
    [
      ["key", "ACME-42"],
      ["badge", "In progress"],
      ["badge", "High"],
      ["badge", "No assignee"],
    ],
    "the key as plain words, as every place draws a key, then the status, priority, and assignee chips",
  );
  assert.equal(
    parts[1]?.querySelector(".luke-hover-card-name")?.textContent,
    "Teammate invitations",
  );
  assert.match(parts.at(-1)?.textContent ?? "", /acme\/app/u, "the repository stands last");
});

test("a task's card says who is on it by face and name, or the dashed mark where no one is, as a fact rather than a picker", () => {
  const assignee = (task: TaskSummary) => {
    const chip = [
      ...drawn(task).querySelectorAll<HTMLElement>(".task-card-standing > .luke-badge"),
    ].at(-1);
    assert.ok(chip, "the assignee's chip stands");
    return [chip.textContent, chip.querySelector(".actor-mark")?.getAttribute("data-kind")];
  };

  assert.deepEqual(
    assignee({ ...TASK, assignee: { userId: "user-charles", name: "Charles Pan" } }),
    ["CCharles Pan", "person"],
  );
  assert.deepEqual(assignee(TASK), ["No assignee", "unassigned"]);
  assert.equal(document.querySelector("[data-task-card] button[aria-haspopup]"), null);
});

test("a task with no key, status, or priority leads with its name", () => {
  const { status: _status, priority: _priority, number: _number, ...bare } = TASK;
  const card = drawn(bare);
  assert.equal(card.querySelector(".task-card-standing"), null);
  assert.equal(
    card.firstElementChild?.querySelector(".luke-hover-card-name")?.textContent,
    bare.name,
  );
});

test("a pull request's line on the card counts its size as every figure is counted, green then red", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(PullRequestLine, {
        pullRequest: {
          number: 7,
          title: "Add invitations",
          state: PULL_REQUEST_STATE.OPEN,
          checks: CHECK_SUMMARY.PASSING,
          additions: 1234,
          deletions: 56,
        },
      }),
    ),
  );
  assert.deepEqual(
    [...container.querySelectorAll(".luke-count-part")].map((each) => [
      each.textContent,
      each.getAttribute("data-tone"),
    ]),
    [
      ["+1,234", "complete"],
      ["−56", "danger"],
    ],
  );
});

/** A question of the task's agent's to Dean, its ask still open, as the window's Inbox holds it. */
const QUESTION: InboxItem = {
  id: "a1b2c3d4-0000-4000-8000-000000000001",
  agentId: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  key: "0001",
  revision: 1,
  version: INBOX_WIRE_VERSION,
  title: "Invite links: 7 days or 14?",
  needsReply: true,
  status: INBOX_STATUS.OPEN,
  thread: [
    {
      id: "d1b2c3d4-0000-4000-8000-000000000001",
      author: INBOX_MESSAGE_AUTHOR.AGENT,
      text: "Invite links: 7 days or 14?",
      ask: {
        type: INBOX_ASK.DECIDE,
        options: [{ label: "7 days" }, { label: "14 days" }],
        status: INBOX_ASK_STATUS.OPEN,
      },
      createdAt: 1_000,
    },
  ],
  postedAt: 1_000,
  updatedAt: 1_000,
};

/** Main's read of the task's open items: a notice and a teammate's question, which wait on no answer of Dean's, and `asked` beside them. */
function openItems(asked: readonly InboxItem[]): readonly AppInboxTask[] {
  const listed = (id: string, asking: boolean) => ({
    id,
    agentId: QUESTION.agentId,
    title: "Synthetic words",
    postedAt: 1_000,
    asking,
  });
  return [
    {
      taskId: TASK.id,
      items: [
        listed("a1b2c3d4-0000-4000-8000-000000000002", false),
        listed("a1b2c3d4-0000-4000-8000-000000000003", true),
        ...asked.map((item) => listed(item.id, true)),
      ],
    },
  ];
}

/** What main counts on the task as Dean's to do: `toDo` of its `items` open items. */
function holding(items: number, toDo: number): readonly AppInboxTaskHolding[] {
  return [{ taskId: TASK.id, items, toDo, updatedAt: 1_000 }];
}

test("a task's row wears waiting on you the moment main's Inbox read counts a question waiting on the reader, with no new read of the tasks, and drops it the moment the window answers, a notice and a teammate's question never wearing it", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const registry = AtomRegistry.make();
  const probe: { settler: InboxSettler | undefined } = { settler: undefined };
  function Row({ tasks }: { tasks: TasksControl }) {
    const waitingOn = useTasksWaiting(tasks);
    probe.settler = useInboxSettler();
    return createElement(TaskRowStatus, { task: TASK, waiting: waitingOn.get(TASK.id) ?? 0 });
  }
  // Note that the task's summary is the same object throughout, as no read of the task list lands.
  const draw = (inbox: readonly AppInboxTask[], inboxTasks: readonly AppInboxTaskHolding[]) =>
    act(() =>
      root.render(
        onRegistry(
          registry,
          createElement(Row, {
            tasks: tasksControl({ me: "user-dean", tasks: [TASK], inbox, inboxTasks }),
          }),
        ),
      ),
    );
  const wears = () =>
    container.querySelector('[role="img"]')?.getAttribute("aria-label") ?? undefined;

  draw(openItems([]), holding(2, 0));
  assert.equal(
    wears(),
    undefined,
    "a notice and a teammate's question wait on no answer of Dean's",
  );

  draw(openItems([QUESTION]), holding(3, 1));
  assert.equal(wears(), "Waiting on you");

  act(() => {
    probe.settler?.close(QUESTION);
  });
  assert.equal(wears(), undefined, "answered, though main still lists it open");
});
