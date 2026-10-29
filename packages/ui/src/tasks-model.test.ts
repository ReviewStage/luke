import assert from "node:assert/strict";
import { TASK_STATUS } from "@luke/features/task-wire";
import { test } from "vitest";
import {
  SETTLED_STATUS,
  settleChanges,
  settledNote,
  settleOffered,
  undoStillDue,
} from "./tasks-model.js";

const INVITES = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

/** A listed task at a status, or with none, as a service before statuses lists it. */
function standingTask(id: string, status?: (typeof TASK_STATUS)[keyof typeof TASK_STATUS]) {
  return {
    id,
    workspaceId: "workspace-personal",
    name: "Teammate invitations",
    createdAt: 1,
    updatedAt: 2,
    repository: null,
    ...(status === undefined ? undefined : { status }),
  };
}

test("Mark done asks Done of the task, and its Undo puts back the status it stood at", () => {
  const working = standingTask(INVITES, TASK_STATUS.IN_PROGRESS);

  const { asked, undo } = settleChanges([working], SETTLED_STATUS.DONE);

  assert.deepEqual(asked, [{ taskId: INVITES, status: TASK_STATUS.DONE }]);
  assert.deepEqual(undo, [{ taskId: INVITES, status: TASK_STATUS.IN_PROGRESS }]);
  assert.equal(settledNote(SETTLED_STATUS.DONE, 1, 0), "Marked done");
});

test("a repository's Mark tasks done asks Done of every task, each Undo putting back its own status, and leaves one already done alone", () => {
  const tasks = [
    standingTask("task-backlog", TASK_STATUS.BACKLOG),
    standingTask("task-todo", TASK_STATUS.TODO),
    standingTask("task-before-statuses"),
    standingTask("task-done", TASK_STATUS.DONE),
  ];

  const { asked, undo } = settleChanges(tasks, SETTLED_STATUS.DONE);

  assert.deepEqual(
    asked.map(({ status }) => status),
    [TASK_STATUS.DONE, TASK_STATUS.DONE, TASK_STATUS.DONE],
  );
  assert.deepEqual(undo, [
    { taskId: "task-backlog", status: TASK_STATUS.BACKLOG },
    { taskId: "task-todo", status: TASK_STATUS.TODO },
    { taskId: "task-before-statuses", status: TASK_STATUS.TODO },
  ]);
  assert.equal(settledNote(SETTLED_STATUS.DONE, 3, 1), "3 tasks marked done, 1 could not be");
});

test("a task already done is offered no Mark done, and one already canceled no Cancel task", () => {
  assert.equal(settleOffered(standingTask(INVITES, TASK_STATUS.DONE), SETTLED_STATUS.DONE), false);
  assert.equal(
    settleOffered(standingTask(INVITES, TASK_STATUS.CANCELED), SETTLED_STATUS.DONE),
    true,
  );
  assert.equal(
    settleOffered(standingTask(INVITES, TASK_STATUS.CANCELED), SETTLED_STATUS.CANCELED),
    false,
  );
});

test("Mark done's Undo puts back only the tasks still done, leaving one given another status since as it was chosen", () => {
  const undo = [
    { taskId: "task-still-done", status: TASK_STATUS.TODO },
    { taskId: "task-moved-since", status: TASK_STATUS.TODO },
  ];
  const now = [
    standingTask("task-still-done", TASK_STATUS.DONE),
    standingTask("task-moved-since", TASK_STATUS.IN_PROGRESS),
  ];

  assert.deepEqual(undoStillDue(undo, SETTLED_STATUS.DONE, now), [
    { taskId: "task-still-done", status: TASK_STATUS.TODO },
  ]);
});
