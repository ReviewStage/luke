import assert from "node:assert/strict";
import { PLAN_BOUNDS } from "@luke/features/plan-wire";
import { PLANNING_READ, type PlanningView } from "@luke/features/planning-view";
import { LIVE_STATUS } from "@luke/live";
import { MICROPHONE_STATUS } from "@luke/voice/audio";
import { VOICE_KEYLESS_NOTE } from "@luke/voice/microphone-access";
import { test } from "vitest";
import { MICROPHONE_PRESS, microphoneButton, planNameOfIssue } from "./planning-model.js";

const INVITES = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const _BILLING = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

function _view(patch: Partial<PlanningView>): PlanningView {
  return {
    plans: [],
    listStatus: PLANNING_READ.READY,
    workspaces: [],
    document: { status: PLANNING_READ.IDLE },
    ...patch,
  };
}

test("the microphone asks for the permission first, then for a plan, and then talks about it or mutes", () => {
  const input = {
    voiceAvailable: true,
    microphoneStatus: MICROPHONE_STATUS.GRANTED,
    activePlanId: INVITES,
    archived: false,
    listening: false,
    callPlanId: undefined,
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
    microphoneButton({ ...input, activePlanId: undefined }).press,
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
      callPlanId: INVITES,
      voiceStatus: LIVE_STATUS.LISTENING,
    }),
    { press: MICROPHONE_PRESS.TALK, label: "Mute the microphone", muted: false },
  );
  // The plan's own call standing unheard is muted, Luke speaking over it or not.
  for (const voiceStatus of [LIVE_STATUS.MUTED, LIVE_STATUS.SPEAKING]) {
    assert.deepEqual(microphoneButton({ ...input, callPlanId: INVITES, voiceStatus }), {
      press: MICROPHONE_PRESS.TALK,
      label: "Unmute the microphone",
      muted: true,
    });
  }
  // A call still connecting, or another plan's muted call, is not this plan muted.
  assert.equal(
    microphoneButton({ ...input, callPlanId: INVITES, voiceStatus: LIVE_STATUS.CONNECTING }).muted,
    false,
  );
  assert.equal(
    microphoneButton({
      ...input,
      callPlanId: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
      voiceStatus: LIVE_STATUS.MUTED,
    }).muted,
    false,
  );
  // A desk call or another plan's call heard is one the press hangs up, not one it mutes.
  for (const callPlanId of [undefined, "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21"]) {
    assert.equal(
      microphoneButton({ ...input, listening: true, callPlanId }).label,
      "Talk about this task",
    );
  }
});

/** A plan's row of the list on a repository, last updated at `updatedAt`. */
function _onRepository(name: string, repository: string | null, updatedAt: number) {
  return { id: name, workspaceId: "workspace-personal", name, createdAt: 1, updatedAt, repository };
}

test("a plan started from a Linear issue is named by its title, cut to a name's bound, or by its key where the title is blank", () => {
  const long = "x".repeat(PLAN_BOUNDS.MAX_NAME_CHARS + 20);

  assert.equal(planNameOfIssue({ identifier: "ENG-1", title: "  Ship it  " }), "Ship it");
  assert.equal(
    planNameOfIssue({ identifier: "ENG-2", title: long }).length,
    PLAN_BOUNDS.MAX_NAME_CHARS,
  );
  assert.equal(planNameOfIssue({ identifier: "ENG-3", title: "   " }), "ENG-3");
});
