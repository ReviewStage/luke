// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CHECK_SUMMARY, PULL_REQUEST_STATE } from "@repo/features/agent-wire";
import {
  DESCRIPTION_ACTOR,
  type DescriptionSectionEdit,
  type Task,
  type TaskAgentsSummary,
  type TaskSummary,
} from "@repo/features/task-wire";
import { ACT_KIND } from "@repo/host/acts";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { type AnyAct, FAKE_ANSWER, fakeActs } from "../testing/app-bridge.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { DOCUMENT_TASK } from "../testing/document-task.js";
import { NO_LOOKS, useAgentLook, useTaskLooks, useUnreadTasks } from "./use-task-looks.js";

/**
 * use-task-looks.test.ts -- the sections a reader is shown as changed since
 * they last looked: a teammate's saves, the app's and an agent's, never the
 * reader's own; a task read unread against the mark the account keeps; and a
 * plan's look sent as it opens, as its agents move, and as it is left, never
 * on each save.
 */

const DEAN = { userId: "user-dean", name: "Dean Stratakos" };
const CHARLES = { userId: "user-charles", name: "Charles Pan" };
const LOOKED_AT = 1_000;

const roots: Root[] = [];
/** Every read mark the window asked of the service, in order, as `<mark>:<task>`. */
let readMarks: string[] = [];

beforeEach(() => {
  readMarks = [];
  fakeActs({
    act: (request: AnyAct) => {
      if (request.kind === ACT_KIND.TASKS_MARK_READ) {
        readMarks.push(`${request.payload.readMark}:${request.payload.taskId}`);
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value: true });
      }
      if (request.kind === ACT_KIND.AGENTS_MARK_READ) {
        readMarks.push(`${request.payload.readMark}:${request.payload.agentId}`);
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value: { failure: "unanswered" } });
      }
      return Promise.resolve({ status: FAKE_ANSWER.REFUSED, reason: "Not in this test." });
    },
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
});

/** A window drawing `open`, or no plan, for `readerId`, from the row the list carries: a render each call, on one registry. */
function windowOn(): {
  readonly draw: (
    open: Task | undefined,
    readerId: string | undefined,
    row?: Pick<TaskSummary, "readThrough" | "agents">,
  ) => void;
  readonly looks: () => typeof NO_LOOKS;
} {
  let looks = NO_LOOKS;
  function Reader({
    open,
    readerId,
    row,
  }: {
    open: Task | undefined;
    readerId: string | undefined;
    row: Pick<TaskSummary, "readThrough" | "agents"> | undefined;
  }) {
    looks = useTaskLooks(open, readerId, row);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  const registry = AtomRegistry.make();
  return {
    draw: (open, readerId, row) =>
      act(() => root.render(onRegistry(registry, createElement(Reader, { open, readerId, row })))),
    looks: () => looks,
  };
}

/** The sections `readerId` is shown as changed on a task whose row reads it through before every save here. */
function changedFor(
  readerId: string | undefined,
  edits: readonly Omit<DescriptionSectionEdit, "at" | "duringCall">[],
): string[] {
  const task: Task = {
    ...DOCUMENT_TASK,
    sectionEdits: edits.map((edit) => ({ ...edit, at: LOOKED_AT + 1, duringCall: false })),
  };
  const window = windowOn();
  window.draw(task, readerId, { readThrough: LOOKED_AT });
  return [...window.looks().changed].sort();
}

const EDITS = [
  { section: "Goal", actor: DESCRIPTION_ACTOR.DEVELOPER, by: DEAN },
  { section: "Approach", actor: DESCRIPTION_ACTOR.DEVELOPER, by: CHARLES },
  { section: "Context", actor: DESCRIPTION_ACTOR.NOTETAKER },
];

test("a teammate's saves are shown as changed, and the reader's own are not", () => {
  assert.deepEqual(changedFor(DEAN.userId, EDITS), ["Approach", "Context"]);
  assert.deepEqual(changedFor(CHARLES.userId, EDITS), ["Context", "Goal"]);
});

test("a developer's save the window cannot place counts as the reader's, as before saves named a member", () => {
  const unnamed = [{ section: "Goal", actor: DESCRIPTION_ACTOR.DEVELOPER }];

  assert.deepEqual(changedFor(DEAN.userId, unnamed), []);
  assert.deepEqual(changedFor(undefined, EDITS), ["Context"]);
});

test("a reader's id arriving while the plan stays open lights a teammate's saves read without it", () => {
  const task: Task = {
    ...DOCUMENT_TASK,
    sectionEdits: EDITS.map((edit) => ({ ...edit, at: LOOKED_AT + 1, duringCall: false })),
  };
  const window = windowOn();
  window.draw(task, undefined, { readThrough: LOOKED_AT });
  assert.deepEqual([...window.looks().changed].sort(), ["Context"]);

  window.draw(task, DEAN.userId, { readThrough: LOOKED_AT + 1 });
  assert.deepEqual([...window.looks().changed].sort(), ["Approach", "Context"]);
});

test("a reader's id arriving mid-stay lights neither a save that landed during the stay nor a section dismissed", () => {
  const charles = { section: "Approach", actor: DESCRIPTION_ACTOR.DEVELOPER, by: CHARLES };
  const task: Task = {
    ...DOCUMENT_TASK,
    updatedAt: LOOKED_AT + 1,
    sectionEdits: [{ ...charles, at: LOOKED_AT + 1, duringCall: false }],
  };
  const saved: Task = {
    ...task,
    updatedAt: LOOKED_AT + 2,
    sectionEdits: [
      { ...charles, at: LOOKED_AT + 1, duringCall: false },
      {
        section: "Context",
        actor: DESCRIPTION_ACTOR.NOTETAKER,
        at: LOOKED_AT + 2,
        duringCall: false,
      },
    ],
  };
  const stay = (dismissing: boolean) => {
    const window = windowOn();
    window.draw(task, undefined, { readThrough: LOOKED_AT });
    if (dismissing) act(() => window.looks().dismiss());
    window.draw(saved, undefined, { readThrough: LOOKED_AT });
    window.draw(saved, DEAN.userId, { readThrough: LOOKED_AT });
    return [...window.looks().changed];
  };

  assert.deepEqual(stay(false), ["Approach"]);
  assert.deepEqual(stay(true), []);
});

/** A task's agents as its row names them, one agent's pull request standing `state`, its agents' newest settled activity at `activityAt`. */
function agentsAt(
  activityAt: number,
  state: TaskAgentsSummary["pullRequests"][number]["state"] = PULL_REQUEST_STATE.OPEN,
): TaskAgentsSummary {
  return {
    total: 1,
    working: 0,
    activityAt,
    agents: [],
    pullRequestTotal: 1,
    pullRequests: [
      {
        number: 7,
        title: "Fix it",
        state,
        checks: CHECK_SUMMARY.PASSING,
        additions: 1,
        deletions: 1,
      },
    ],
  };
}

test("a plan's look is sent as it opens, as its agents move while it stays open, and as it is left, and never on a save", () => {
  const task: Task = { ...DOCUMENT_TASK, updatedAt: LOOKED_AT };
  const saved: Task = { ...task, updatedAt: LOOKED_AT + 1 };
  const window = windowOn();

  window.draw(task, DEAN.userId, { readThrough: LOOKED_AT, agents: agentsAt(LOOKED_AT) });
  window.draw(saved, DEAN.userId, { readThrough: LOOKED_AT, agents: agentsAt(LOOKED_AT) });
  window.draw(saved, DEAN.userId, { readThrough: LOOKED_AT, agents: agentsAt(LOOKED_AT + 2) });
  window.draw(undefined, DEAN.userId);

  assert.deepEqual(readMarks, [`read:${task.id}`, `seen:${task.id}`, `seen:${task.id}`]);
});

test("an agent with no task is looked at as its page opens, again as its row's time moves while it stays open, and as it is left", () => {
  const agent = { id: "agent-looked", activityAt: LOOKED_AT };
  function Page({ open }: { open: typeof agent | undefined }) {
    useAgentLook(open);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  const registry = AtomRegistry.make();
  const draw = (open: typeof agent | undefined) =>
    act(() => root.render(onRegistry(registry, createElement(Page, { open }))));

  draw(agent);
  draw({ ...agent, activityAt: LOOKED_AT + 5 });
  draw(undefined);

  assert.deepEqual(readMarks, [`read:${agent.id}`, `seen:${agent.id}`, `seen:${agent.id}`]);
});

test("a task reads unread while it changed after the reader's mark or stands marked so, never for a pull request merging alone, and never while it is the one open but by hand", () => {
  const read: TaskSummary = {
    ...DOCUMENT_TASK,
    updatedAt: LOOKED_AT,
    readThrough: LOOKED_AT + 1,
    agents: agentsAt(LOOKED_AT + 1, PULL_REQUEST_STATE.MERGED),
  };
  const finished: TaskSummary = { ...read, agents: agentsAt(LOOKED_AT + 2) };
  const marked: TaskSummary = { ...read, markedUnread: true };
  const drawn: { unread: (task: TaskSummary) => boolean } = { unread: () => false };
  function Sidebar({ open }: { open: Task | undefined }) {
    useTaskLooks(open, DEAN.userId);
    drawn.unread = useUnreadTasks({ staged: false });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  const registry = AtomRegistry.make();
  const draw = (open: Task | undefined) =>
    act(() => root.render(onRegistry(registry, createElement(Sidebar, { open }))));

  draw(undefined);
  assert.deepEqual([read, finished, marked].map(drawn.unread), [false, true, true]);

  draw(DOCUMENT_TASK);
  assert.deepEqual([finished, marked].map(drawn.unread), [false, true]);
});
