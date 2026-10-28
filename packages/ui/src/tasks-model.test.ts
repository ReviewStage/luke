import assert from "node:assert/strict";
import { TASK_PRIORITY, TASK_STATUS } from "@luke/features/task-wire";
import { TASKS_READ, type TasksView } from "@luke/features/tasks-view";
import { VOICE_FAILURE, VOICE_FAILURE_WORDS } from "@luke/features/words";
import { LIVE_STATUS } from "@luke/live";
import { MICROPHONE_STATUS } from "@luke/voice/audio";
import { VOICE_KEYLESS_NOTE } from "@luke/voice/microphone-access";
import { test } from "vitest";
import {
  CALL_LABEL,
  MICROPHONE_PRESS,
  markAsked,
  markedView,
  microphoneButton,
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
  standingCallStatus,
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
    { press: MICROPHONE_PRESS.TALK, label: "Mute microphone", muted: false },
  );
  // The agent's own call standing unheard is muted, Luke speaking over it or not.
  for (const voiceStatus of [LIVE_STATUS.MUTED, LIVE_STATUS.SPEAKING]) {
    assert.deepEqual(microphoneButton({ ...input, call: own, voiceStatus }), {
      press: MICROPHONE_PRESS.TALK,
      label: "Unmute microphone",
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

test("a voice window given up on for the run says so on the Call button, and how to get voice back, in place of a press", () => {
  const input = {
    voiceAvailable: true,
    microphoneStatus: MICROPHONE_STATUS.GRANTED,
    agentId: "0b5f8c1e-4d3a-4e6b-8f2c-9a1d7e3b5c40",
    listening: false,
    call: undefined,
    voiceStatus: LIVE_STATUS.IDLE,
  };
  assert.deepEqual(microphoneButton({ ...input, voiceLost: true }), {
    press: MICROPHONE_PRESS.NONE,
    label: VOICE_FAILURE_WORDS[VOICE_FAILURE.VOICE_WINDOW_LOST].words,
    muted: false,
  });
  // Signed out still says so first: no window would make a call run then.
  assert.equal(
    microphoneButton({ ...input, voiceAvailable: false, voiceLost: true }).label,
    VOICE_KEYLESS_NOTE,
  );
  assert.equal(microphoneButton({ ...input, voiceLost: false }).label, CALL_LABEL);
});

test("a call that failed still has a word on its bar, where an idle voice has none", () => {
  assert.equal(
    standingCallStatus({ voiceStatus: LIVE_STATUS.FAILED }, undefined)?.voiceWord,
    "Call failed",
  );
  assert.equal(standingCallStatus({ voiceStatus: LIVE_STATUS.IDLE }, undefined), undefined);
});

test("a call's bar says what Luke is doing without naming him, and draws no notetaker whatever an older service sent", () => {
  const speaking = standingCallStatus({ voiceStatus: LIVE_STATUS.SPEAKING }, undefined);
  assert.equal(speaking?.voiceWord, "Speaking");
  const working = standingCallStatus(
    { voiceStatus: LIVE_STATUS.LISTENING },
    { planner: { action: "ls src" }, notes: true },
  );
  assert.deepEqual(working?.backend, { agent: { action: "ls src" } });
});

test("an account known to have no OpenAI API key is sent to add one before the microphone is asked for, unknown asks nothing, and its own standing call keeps its mute", () => {
  const agentId = "0b5f8c1e-4d3a-4e6b-8f2c-9a1d7e3b5c40";
  const own = { taskId: INVITES, agentId };
  const input = {
    voiceAvailable: true,
    microphoneStatus: MICROPHONE_STATUS.GRANTED,
    agentId,
    listening: false,
    call: undefined,
    voiceStatus: LIVE_STATUS.IDLE,
  };
  const addKey = {
    press: MICROPHONE_PRESS.ADD_OPENAI_KEY,
    label: "Add an OpenAI key in settings",
    muted: false,
  };
  assert.deepEqual(microphoneButton({ ...input, openAiKeyMissing: true }), addKey);
  assert.deepEqual(
    microphoneButton({
      ...input,
      microphoneStatus: MICROPHONE_STATUS.NOT_DETERMINED,
      openAiKeyMissing: true,
    }),
    addKey,
  );
  // Signed out says so first, since no key of any account's is in reach.
  assert.equal(
    microphoneButton({ ...input, voiceAvailable: false, openAiKeyMissing: true }).press,
    MICROPHONE_PRESS.NONE,
  );
  // A key saved, or not known either way, calls.
  assert.equal(
    microphoneButton({ ...input, openAiKeyMissing: false }).press,
    MICROPHONE_PRESS.TALK,
  );
  assert.equal(microphoneButton(input).label, CALL_LABEL);
  assert.deepEqual(
    microphoneButton({
      ...input,
      listening: true,
      call: own,
      voiceStatus: LIVE_STATUS.LISTENING,
      openAiKeyMissing: true,
    }),
    { press: MICROPHONE_PRESS.TALK, label: "Mute microphone", muted: false },
  );
});

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
