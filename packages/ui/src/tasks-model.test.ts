import assert from "node:assert/strict";
import { TASK_BOUNDS } from "@luke/features/task-wire";
import { TASKS_READ, type TasksView } from "@luke/features/tasks-view";
import { LIVE_STATUS } from "@luke/live";
import { MICROPHONE_STATUS } from "@luke/voice/audio";
import { VOICE_KEYLESS_NOTE } from "@luke/voice/microphone-access";
import { test } from "vitest";
import {
  ISSUE_MATCH_LIMIT,
  MICROPHONE_PRESS,
  markedView,
  matchingIssues,
  microphoneButton,
  pendingMark,
  positionedView,
  TASK_MARK,
  taskNameOfIssue,
  unsettledPinPositions,
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

test("the microphone asks for the permission first, then for a plan, and then talks about it or mutes", () => {
  const input = {
    voiceAvailable: true,
    microphoneStatus: MICROPHONE_STATUS.GRANTED,
    activeTaskId: INVITES,
    archived: false,
    listening: false,
    callTaskId: undefined,
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
  assert.equal(
    microphoneButton({ ...input, activeTaskId: undefined }).press,
    MICROPHONE_PRESS.NONE,
  );
  assert.deepEqual(microphoneButton(input), {
    press: MICROPHONE_PRESS.TALK,
    label: "Talk about this task",
    muted: false,
  });
  assert.deepEqual(
    microphoneButton({
      ...input,
      listening: true,
      callTaskId: INVITES,
      voiceStatus: LIVE_STATUS.LISTENING,
    }),
    { press: MICROPHONE_PRESS.TALK, label: "Mute the microphone", muted: false },
  );
  // The plan's own call standing unheard is muted, Luke speaking over it or not.
  for (const voiceStatus of [LIVE_STATUS.MUTED, LIVE_STATUS.SPEAKING]) {
    assert.deepEqual(microphoneButton({ ...input, callTaskId: INVITES, voiceStatus }), {
      press: MICROPHONE_PRESS.TALK,
      label: "Unmute the microphone",
      muted: true,
    });
  }
  // A call still connecting, or another plan's muted call, is not this plan muted.
  assert.equal(
    microphoneButton({ ...input, callTaskId: INVITES, voiceStatus: LIVE_STATUS.CONNECTING }).muted,
    false,
  );
  assert.equal(
    microphoneButton({
      ...input,
      callTaskId: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
      voiceStatus: LIVE_STATUS.MUTED,
    }).muted,
    false,
  );
  // A desk call or another plan's call heard is one the press hangs up, not one it mutes.
  for (const callTaskId of [undefined, "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21"]) {
    assert.equal(
      microphoneButton({ ...input, listening: true, callTaskId }).label,
      "Talk about this task",
    );
  }
});

/** A plan's row of the list on a repository, last updated at `updatedAt`. */
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

test("a pin dragged here stands at its new place until the list carries it, and is let go once it does, the pin is gone, or the service answered", () => {
  const plan = {
    id: INVITES,
    workspaceId: "workspace-personal",
    name: "Teammate invitations",
    createdAt: 1,
    updatedAt: 2,
    repository: null,
    pinnedAt: 3,
    pinPosition: "a0",
  };
  const listed = _view({ tasks: [plan] });
  const dragged = new Map([[INVITES, { position: "a1", answered: false }]]);

  assert.equal(positionedView(listed, dragged).tasks[0]?.pinPosition, "a1");
  assert.equal(unsettledPinPositions(dragged, listed).size, 1);
  assert.equal(
    unsettledPinPositions(dragged, _view({ tasks: [{ ...plan, pinPosition: "a1" }] })).size,
    0,
  );
  const { pinnedAt: _pinnedAt, pinPosition: _pinPosition, ...unpinned } = plan;
  assert.equal(unsettledPinPositions(dragged, _view({ tasks: [unpinned] })).size, 0);
  // Once answered, a view placing the pin elsewhere is a later drag on another Mac, which it follows.
  const answered = new Map([[INVITES, { position: "a1", answered: true }]]);
  assert.equal(
    unsettledPinPositions(answered, _view({ tasks: [{ ...plan, pinPosition: "a2" }] })).size,
    0,
  );
});

test("an unpin given here takes the pin's place with it, so a pin made again stands on top", () => {
  const plan = {
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
    _view({ tasks: [plan] }),
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
  const keys = (typed: string) => matchingIssues(issues, typed).map((issue) => issue.identifier);

  assert.deepEqual(keys("stack"), ["ENG-7", "ENG-12"]);
  assert.deepEqual(keys("DEPLOY q"), ["ENG-12"]);
  assert.deepEqual(keys("40"), ["OPS-40", "ENG-9"]);
  assert.deepEqual(keys("ops-40"), ["OPS-40"]);
  assert.deepEqual(keys("refactor billing"), []);
  assert.deepEqual(keys("   "), []);
});

test("New task offers at most a handful of issues however many match", () => {
  const issues = Array.from({ length: ISSUE_MATCH_LIMIT + 4 }, (_, index) => ({
    identifier: `ENG-${index + 1}`,
    title: `Task ${index + 1}`,
  }));

  assert.equal(matchingIssues(issues, "task").length, ISSUE_MATCH_LIMIT);
});
