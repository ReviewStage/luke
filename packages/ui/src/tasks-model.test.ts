import assert from "node:assert/strict";
import { TASK_PRIORITY, TASK_STATUS } from "@luke/features/task-wire";
import { TASKS_READ, type TasksView } from "@luke/features/tasks-view";
import { test } from "vitest";
import {
  markAsked,
  markedView,
  NO_PENDING_STANDINGS,
  positionedView,
  renameAsked,
  SETTLED_STATUS,
  settleChanges,
  settledMarks,
  settledNote,
  settledRenames,
  settledStandings,
  settleOffered,
  standingAsked,
  standingView,
  standingWithout,
  TASK_MARK,
  undoStillDue,
  unsettledPinPositions,
  withStanding,
} from "./tasks-model.js";

const INVITES = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const BILLING = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

function _view(patch: Partial<TasksView>): TasksView {
  return {
    tasks: [],
    listStatus: TASKS_READ.READY,
    workspaces: [],
    document: { status: TASKS_READ.IDLE },
    ...patch,
  };
}

/** A task's row of the list on a repository, last updated at `updatedAt`. */
function _onRepository(name: string, repository: string | null, updatedAt: number) {
  return { id: name, workspaceId: "workspace-personal", name, createdAt: 1, updatedAt, repository };
}

test("a pin dragged here stands at its new place until the list carries it, and is let go once it does, the pin is gone, or the service answered", () => {
  const task = {
    id: INVITES,
    workspaceId: "workspace-personal",
    name: "Teammate invitations",
    createdAt: 1,
    updatedAt: 2,
    repository: null,
    pinnedAt: 3,
    pinPosition: "a0",
  };
  const listed = _view({ tasks: [task] });
  const dragged = new Map([[INVITES, { position: "a1", answered: false }]]);

  assert.equal(positionedView(listed, dragged).tasks[0]?.pinPosition, "a1");
  assert.equal(unsettledPinPositions(dragged, listed).size, 1);
  assert.equal(
    unsettledPinPositions(dragged, _view({ tasks: [{ ...task, pinPosition: "a1" }] })).size,
    0,
  );
  const { pinnedAt: _pinnedAt, pinPosition: _pinPosition, ...unpinned } = task;
  assert.equal(unsettledPinPositions(dragged, _view({ tasks: [unpinned] })).size, 0);
  // Once answered, a view placing the pin elsewhere is a later drag on another Mac, which it follows.
  const answered = new Map([[INVITES, { position: "a1", answered: true }]]);
  assert.equal(
    unsettledPinPositions(answered, _view({ tasks: [{ ...task, pinPosition: "a2" }] })).size,
    0,
  );
});

test("an unpin given here takes the pin's place with it, so a pin made again stands on top", () => {
  const task = {
    id: INVITES,
    workspaceId: "workspace-personal",
    name: "Teammate invitations",
    createdAt: 1,
    updatedAt: 2,
    repository: null,
    pinnedAt: 3,
    pinPosition: "a0",
  };
  const view = _view({ tasks: [task] });
  const unpinned = markedView(
    view,
    new Map([[INVITES, markAsked(new Map(), view, INVITES, TASK_MARK.UNPIN, 4)]]),
  ).tasks[0];
  assert.equal(unpinned?.pinnedAt, undefined);
  assert.equal(unpinned?.pinPosition, undefined);
});

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

/** The pending standings with what `standing` asks of the task given drawn over `view`, and the ask itself. */
function asked(view: TasksView, taskId: string, standing: Parameters<typeof standingAsked>[3]) {
  const ask = standingAsked(NO_PENDING_STANDINGS, view, taskId, standing);
  return { ask, standings: withStanding(NO_PENDING_STANDINGS, taskId, ask) };
}

test("a status given here is drawn on the task until the list carries it, then let go, apart from a pin given with it", () => {
  const listed = _view({ tasks: [standingTask(INVITES, TASK_STATUS.TODO)] });
  const { standings } = asked(listed, INVITES, { status: TASK_STATUS.DONE });
  const pinned = new Map([[INVITES, markAsked(new Map(), listed, INVITES, TASK_MARK.PIN, 4)]]);

  assert.equal(standingView(listed, standings).tasks[0]?.status, TASK_STATUS.DONE);
  assert.equal(settledStandings(standings, listed, undefined).status.size, 1);
  const done = _view({ tasks: [standingTask(INVITES, TASK_STATUS.DONE)] });
  assert.equal(settledStandings(standings, done, undefined).status.size, 0);
  // Note that the status landing lets go of nothing the pin still waits on.
  assert.equal(settledMarks(pinned, done, undefined).size, 1);
});

test("a priority or an assignee given here is drawn on the task at once, the assignee by the name the list knows them by, and a refusal puts the task back", () => {
  const charles = { userId: "user-charles", name: "Charles Pan" };
  const other = { ...standingTask(BILLING, TASK_STATUS.TODO), assignee: charles };
  const listed = _view({ tasks: [standingTask(INVITES, TASK_STATUS.TODO), other] });
  const { ask, standings } = asked(listed, INVITES, {
    priority: TASK_PRIORITY.URGENT,
    assigneeId: charles.userId,
  });

  const drawn = standingView(listed, standings).tasks[0];
  assert.equal(drawn?.priority, TASK_PRIORITY.URGENT);
  assert.deepEqual(drawn?.assignee, charles);
  const refused = standingWithout(standings, INVITES, ask);
  assert.deepEqual(standingView(listed, refused).tasks[0], standingTask(INVITES, TASK_STATUS.TODO));
});

test("a member the list names on no task is drawn by the name the press knows them by", () => {
  const listed = _view({ tasks: [standingTask(INVITES, TASK_STATUS.TODO)] });
  const ask = standingAsked(
    NO_PENDING_STANDINGS,
    listed,
    INVITES,
    { assigneeId: "user-charles" },
    "Charles Pan",
  );
  const standings = withStanding(NO_PENDING_STANDINGS, INVITES, ask);

  assert.deepEqual(standingView(listed, standings).tasks[0]?.assignee, {
    userId: "user-charles",
    name: "Charles Pan",
  });
});

test("a task sent to no one is drawn unassigned until the list carries it", () => {
  const assigned = {
    ...standingTask(INVITES, TASK_STATUS.TODO),
    assignee: { userId: "user-dean", name: "Dean Stratakos" },
  };
  const listed = _view({ tasks: [assigned] });
  const { standings } = asked(listed, INVITES, { assigneeId: null });

  assert.equal(standingView(listed, standings).tasks[0]?.assignee, undefined);
  const carried = _view({ tasks: [standingTask(INVITES, TASK_STATUS.TODO)] });
  assert.equal(settledStandings(standings, carried, undefined).assignee.size, 0);
});

test("a name the service trims, or a status a teammate set first, gives way to the list rather than standing over it", () => {
  const listed = _view({ tasks: [standingTask(INVITES, TASK_STATUS.TODO)] });
  const renames = new Map([[INVITES, renameAsked(new Map(), listed, INVITES, "Invites  ")]]);
  const { standings } = asked(listed, INVITES, { status: TASK_STATUS.DONE });
  const answered = _view({
    tasks: [{ ...standingTask(INVITES, TASK_STATUS.IN_PROGRESS), name: "Invites" }],
  });

  assert.equal(settledRenames(renames, answered, undefined).size, 0);
  assert.equal(settledStandings(standings, answered, undefined).status.size, 0);
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
