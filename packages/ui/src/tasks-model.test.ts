import assert from "node:assert/strict";
import { TASK_BOUNDS, TASK_STATUS } from "@luke/features/task-wire";
import { TASKS_READ, type TasksView } from "@luke/features/tasks-view";
import { LIVE_STATUS } from "@luke/live";
import { MICROPHONE_STATUS } from "@luke/voice/audio";
import { VOICE_KEYLESS_NOTE } from "@luke/voice/microphone-access";
import { test } from "vitest";
import {
  agentPromptOf,
  CALL_LABEL,
  ISSUE_MATCH_LIMIT,
  linearIssuesAskOf,
  MICROPHONE_PRESS,
  markedView,
  microphoneButton,
  offeredIssues,
  pendingMark,
  positionedView,
  SETTLED_STATUS,
  settleChanges,
  settledNote,
  settleOffered,
  statusedView,
  TASK_MARK,
  taskNameOfIssue,
  undoStillDue,
  unsettledMarks,
  unsettledPinPositions,
  unsettledStatuses,
} from "./tasks-model.js";

const INVITES = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const _BILLING = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

function _view(patch: Partial<TasksView>): TasksView {
  return {
    tasks: [],
    listStatus: TASKS_READ.READY,
    workspaces: [],
    document: { status: TASKS_READ.IDLE },
    ...patch,
  };
}

test("an agent's Call button asks for the permission first, then calls the agent, or mutes and unmutes its own call", () => {
  const agentId = "0b5f8c1e-4d3a-4e6b-8f2c-9a1d7e3b5c40";
  const otherAgent = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
  const own = { taskId: INVITES, agentId };
  const input = {
    voiceAvailable: true,
    microphoneStatus: MICROPHONE_STATUS.GRANTED,
    agentId,
    archived: false,
    listening: false,
    call: undefined,
    voiceStatus: LIVE_STATUS.IDLE,
  };
  assert.deepEqual(microphoneButton({ ...input, voiceAvailable: false }), {
    press: MICROPHONE_PRESS.NONE,
    label: VOICE_KEYLESS_NOTE,
    muted: false,
  });
  assert.equal(
    microphoneButton({ ...input, microphoneStatus: MICROPHONE_STATUS.NOT_DETERMINED }).press,
    MICROPHONE_PRESS.ASK_ACCESS,
  );
  assert.equal(
    microphoneButton({ ...input, microphoneStatus: MICROPHONE_STATUS.DENIED }).press,
    MICROPHONE_PRESS.OPEN_SETTINGS,
  );
  assert.equal(microphoneButton({ ...input, archived: true }).press, MICROPHONE_PRESS.NONE);
  assert.deepEqual(microphoneButton(input), {
    press: MICROPHONE_PRESS.TALK,
    label: CALL_LABEL,
    muted: false,
  });
  assert.deepEqual(
    microphoneButton({ ...input, listening: true, call: own, voiceStatus: LIVE_STATUS.LISTENING }),
    { press: MICROPHONE_PRESS.TALK, label: "Mute the microphone", muted: false },
  );
  // The agent's own call standing unheard is muted, Luke speaking over it or not.
  for (const voiceStatus of [LIVE_STATUS.MUTED, LIVE_STATUS.SPEAKING]) {
    assert.deepEqual(microphoneButton({ ...input, call: own, voiceStatus }), {
      press: MICROPHONE_PRESS.TALK,
      label: "Unmute the microphone",
      muted: true,
    });
  }
  // A call still connecting, or another agent's muted call, is not this agent muted.
  assert.equal(
    microphoneButton({ ...input, call: own, voiceStatus: LIVE_STATUS.CONNECTING }).muted,
    false,
  );
  const other = { taskId: INVITES, agentId: otherAgent };
  assert.equal(
    microphoneButton({ ...input, call: other, voiceStatus: LIVE_STATUS.MUTED }).muted,
    false,
  );
  // Another agent's call heard is one the press hangs up, not one it mutes.
  assert.equal(microphoneButton({ ...input, listening: true, call: other }).label, CALL_LABEL);
});

/** A task's row of the list on a repository, last updated at `updatedAt`. */
function _onRepository(name: string, repository: string | null, updatedAt: number) {
  return { id: name, workspaceId: "workspace-personal", name, createdAt: 1, updatedAt, repository };
}

test("a plan started from a Linear issue is named by its title, cut to a name's bound, or by its key where the title is blank", () => {
  const long = "x".repeat(TASK_BOUNDS.MAX_NAME_CHARS + 20);

  assert.equal(taskNameOfIssue({ identifier: "ENG-1", title: "  Ship it  " }), "Ship it");
  assert.equal(
    taskNameOfIssue({ identifier: "ENG-2", title: long }).length,
    TASK_BOUNDS.MAX_NAME_CHARS,
  );
  assert.equal(taskNameOfIssue({ identifier: "ENG-3", title: "   " }), "ENG-3");
});

test("an agent New task starts is handed a mention of each issue picked, one to a line, then a blank line and the words; the issues alone with no words, and the words alone with no issue", () => {
  const issue = {
    identifier: "ENG-1",
    title: " Fix [the] refresh ",
    url: "https://linear.app/acme/issue/ENG-1/fix-the-refresh",
  };

  assert.equal(
    agentPromptOf([issue], "  Reproduce it first.\n"),
    "[@ENG-1 Fix \\[the\\] refresh](https://linear.app/acme/issue/ENG-1/fix-the-refresh)\n\nReproduce it first.",
  );
  assert.equal(
    agentPromptOf([issue], "   "),
    "[@ENG-1 Fix \\[the\\] refresh](https://linear.app/acme/issue/ENG-1/fix-the-refresh)",
  );
  assert.equal(
    agentPromptOf([], " Make the sidebar keep its folds. "),
    "Make the sidebar keep its folds.",
  );
  assert.equal(
    agentPromptOf(
      [{ identifier: "ACME-7", title: "Invites expire", url: "https://tryluke.dev/a(b)/issue/7" }],
      "",
    ),
    "[@ACME-7 Invites expire](https://tryluke.dev/a%28b%29/issue/7)",
    "one of the workspace's own issues is mentioned by its Luke link, its target kept one target",
  );
  assert.equal(
    agentPromptOf(
      [
        {
          identifier: "acme/relay#7",
          title: "Invites expire",
          url: "https://github.com/acme/relay/issues/7",
        },
        issue,
      ],
      "Both.",
    ),
    "[@acme/relay#7 Invites expire](https://github.com/acme/relay/issues/7)\n[@ENG-1 Fix \\[the\\] refresh](https://linear.app/acme/issue/ENG-1/fix-the-refresh)\n\nBoth.",
  );
});

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
  const unpinned = markedView(
    _view({ tasks: [task] }),
    new Map([[INVITES, pendingMark(TASK_MARK.UNPIN, 4)]]),
  ).tasks[0];
  assert.equal(unpinned?.pinnedAt, undefined);
  assert.equal(unpinned?.pinPosition, undefined);
});

test("New task offers the Linear issues whose title or key holds every word typed, the key or number typed whole first, then word starts, then Linear's own order", () => {
  const issues = [
    { identifier: "ENG-9", title: "Handle 400 errors from Linear" },
    { identifier: "ENG-12", title: "Restack the deploy queue" },
    { identifier: "ENG-7", title: "Add support for stacked PRs" },
    { identifier: "ENG-3", title: "Show the merge queue" },
    { identifier: "OPS-40", title: "Rotate the deploy key" },
  ];
  const keys = (typed: string) => offeredIssues(issues, typed).map((issue) => issue.identifier);

  assert.deepEqual(keys("stack"), ["ENG-7", "ENG-12"]);
  assert.deepEqual(keys("DEPLOY q"), ["ENG-12"]);
  assert.deepEqual(keys("40"), ["OPS-40", "ENG-9"]);
  assert.deepEqual(keys("ops-40"), ["OPS-40"]);
  assert.deepEqual(keys("refactor billing"), []);
  assert.deepEqual(keys("   "), []);
});

test("New task also offers what Linear found for the words, after the listed issues that hold them, each issue once, and a pasted link's issue first", () => {
  const listed = [
    { identifier: "ENG-12", title: "Restack the deploy queue" },
    { identifier: "ENG-3", title: "Show the merge queue" },
  ];
  const found = [
    { identifier: "ENG-301", title: "Old: queue jumps on retry" },
    { identifier: "ENG-12", title: "Restack the deploy queue" },
    { identifier: "ENG-88", title: "Retries pile up" },
  ];
  const keys = (typed: string, answered: typeof found) =>
    offeredIssues(listed, typed, answered).map((issue) => issue.identifier);

  assert.deepEqual(keys("queue", found), ["ENG-12", "ENG-3", "ENG-301", "ENG-88"]);
  assert.deepEqual(keys("queue", []), ["ENG-12", "ENG-3"]);
  assert.deepEqual(
    keys("https://linear.app/acme/issue/ENG-88/retries-pile-up", [
      { identifier: "ENG-88", title: "Retries pile up" },
    ]),
    ["ENG-88"],
  );
});

test("New task asks Linear for the one issue a key or link names, searches for any other words, and asks nothing for a blank name", () => {
  assert.deepEqual(linearIssuesAskOf(" eng-42 "), { identifier: "ENG-42" });
  assert.deepEqual(linearIssuesAskOf("https://linear.app/acme/issue/OPS-7/rotate"), {
    identifier: "OPS-7",
  });
  assert.deepEqual(linearIssuesAskOf("  deploy queue "), { query: "deploy queue" });
  assert.equal(linearIssuesAskOf("x".repeat(500))?.query?.length, 200);
  assert.equal(linearIssuesAskOf("   "), undefined);
});

test("New task offers at most a handful of issues however many match", () => {
  const issues = Array.from({ length: ISSUE_MATCH_LIMIT + 4 }, (_, index) => ({
    identifier: `ENG-${index + 1}`,
    title: `Task ${index + 1}`,
  }));

  assert.equal(offeredIssues(issues, "task").length, ISSUE_MATCH_LIMIT);
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

test("a status given here is drawn on the task until the list carries it, then let go, apart from a pin given with it", () => {
  const listed = _view({ tasks: [standingTask(INVITES, TASK_STATUS.TODO)] });
  const statuses = new Map([[INVITES, { status: TASK_STATUS.DONE }]]);
  const pinned = new Map([[INVITES, pendingMark(TASK_MARK.PIN, 4)]]);

  assert.equal(statusedView(listed, statuses).tasks[0]?.status, TASK_STATUS.DONE);
  assert.equal(unsettledStatuses(statuses, listed).size, 1);
  const done = _view({ tasks: [standingTask(INVITES, TASK_STATUS.DONE)] });
  assert.equal(unsettledStatuses(statuses, done).size, 0);
  // Note that the status landing lets go of nothing the pin still waits on.
  assert.equal(unsettledMarks(pinned, done).size, 1);
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
