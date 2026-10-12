import assert from "node:assert/strict";
import type { Plan } from "@sidecar/hosted/plan-wire";
import {
  PLAN_CALL_FAILURE,
  PLANNING_READ,
  type PlanningView,
  VOICE_PHASE,
} from "@sidecar/hosted/planning-view";
import { LIVE_STATUS, type LiveStatus } from "@sidecar/live";
import { test } from "vitest";
import { MICROPHONE_STATUS } from "#shared/messages/audio";
import { IDLE_VOICE_VIEW } from "#shared/messages/voice-view";
import { VOICE_KEYLESS_NOTE } from "../microphone-access";
import {
  ARCHIVED_CALL_LABEL,
  callStatus,
  DOCUMENT_REGION,
  documentRegion,
  MICROPHONE_PRESS,
  microphoneButton,
  PLANS_PAGE,
  plansPage,
  recentRepositories,
  repositoryFailureNote,
  repositoryGroups,
  repositoryLabel,
  repositoryPageUrl,
  START_FAILED_NOTE,
} from "./planning-model";

const INVITES = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const BILLING = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

const PLAN: Plan = {
  id: INVITES,
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: null,
  document: { body: "# Teammate invitations", assumptions: [] },
  rollout: [],
};

function view(patch: Partial<PlanningView>): PlanningView {
  return {
    plans: [],
    listStatus: PLANNING_READ.READY,
    document: { status: PLANNING_READ.IDLE },
    ...patch,
  };
}

test("the document region draws only a document read for the active plan", () => {
  assert.deepEqual(documentRegion(view({})), { kind: DOCUMENT_REGION.NONE });
  assert.deepEqual(
    documentRegion(view({ activePlanId: INVITES, document: { status: PLANNING_READ.READING } })),
    { kind: DOCUMENT_REGION.READING },
  );
  assert.deepEqual(
    documentRegion(
      view({ activePlanId: INVITES, document: { status: PLANNING_READ.READY, plan: PLAN } }),
    ),
    { kind: DOCUMENT_REGION.READY, plan: PLAN },
  );
  // Another plan's copy is never drawn under this plan's name.
  assert.deepEqual(
    documentRegion(
      view({ activePlanId: BILLING, document: { status: PLANNING_READ.READY, plan: PLAN } }),
    ),
    { kind: DOCUMENT_REGION.READING },
  );
  assert.deepEqual(
    documentRegion(view({ activePlanId: INVITES, document: { status: PLANNING_READ.FAILED } })),
    { kind: DOCUMENT_REGION.FAILED },
  );
  assert.deepEqual(
    documentRegion(view({ activePlanId: INVITES, document: { status: PLANNING_READ.MISSING } })),
    { kind: DOCUMENT_REGION.MISSING },
  );
});

test("an open plan is the document page, and with none open the tab is the new-plan page", () => {
  assert.equal(plansPage(view({})), PLANS_PAGE.NEW);
  // A plan another panel opened, or one just started from the new-plan page, is the document page here too.
  assert.equal(plansPage(view({ activePlanId: INVITES })), PLANS_PAGE.DOCUMENT);
});

test("the recent repositories follow the plans' order, each once, skipping a plan with none, five at most", () => {
  const repositories = [
    "acme/relay",
    null,
    "acme/api",
    "acme/relay",
    "acme/web",
    "acme/docs",
    "acme/cli",
    "acme/infra",
  ];
  const plans = repositories.map((repository, index) => ({
    ...PLAN,
    id: String(index),
    repository,
  }));

  assert.deepEqual(recentRepositories(plans), [
    "acme/relay",
    "acme/api",
    "acme/web",
    "acme/docs",
    "acme/cli",
  ]);
  assert.deepEqual(recentRepositories([PLAN]), []);
});

test("a refusal about a repository is said by its reason, and a repository's page is its GitHub address", () => {
  assert.match(repositoryFailureNote(PLAN_CALL_FAILURE.REPOSITORY_NOT_REACHABLE), /can't see/u);
  assert.match(
    repositoryFailureNote(PLAN_CALL_FAILURE.GITHUB_SIGN_IN_REQUIRED),
    /Sign in with GitHub/u,
  );
  assert.equal(repositoryFailureNote(PLAN_CALL_FAILURE.UNANSWERED), START_FAILED_NOTE);
  assert.equal(repositoryPageUrl("acme/relay"), "https://github.com/acme/relay");
});

test("the microphone's word is the open plan's call status with no backend line, and nothing for a desk call or another plan's", () => {
  const listening = { ...IDLE_VOICE_VIEW, voiceStatus: LIVE_STATUS.LISTENING };
  const open = { activePlanId: INVITES };
  assert.deepEqual(callStatus({ ...listening, callPlanId: INVITES }, open), {
    voiceWord: "Listening",
    backend: { planner: undefined, notes: false },
  });
  assert.equal(callStatus({ ...listening, callPlanId: undefined }, open), undefined);
  assert.equal(callStatus({ ...listening, callPlanId: BILLING }, open), undefined);
  assert.equal(callStatus({ ...listening, callPlanId: INVITES }, {}), undefined);
  // A failed call says nothing here: the panel's strip carries the error under the shape.
  assert.equal(
    callStatus({ ...IDLE_VOICE_VIEW, voiceStatus: LIVE_STATUS.FAILED, callPlanId: INVITES }, open),
    undefined,
  );
});

test("a listening or muted call reads the voice's wait, speaking, connecting, and closing keep their own word, and the backend is shown beside any of them", () => {
  const working = {
    activePlanId: INVITES,
    activity: { voice: VOICE_PHASE.HANDING_OFF, planner: { action: "ls src" }, notes: true },
  };
  const call = (voiceStatus: LiveStatus) => ({
    ...IDLE_VOICE_VIEW,
    voiceStatus,
    callPlanId: INVITES,
  });
  const backend = { planner: { action: "ls src" }, notes: true };
  assert.deepEqual(callStatus(call(LIVE_STATUS.LISTENING), working), {
    voiceWord: "Handing off",
    backend,
  });
  assert.equal(
    callStatus(call(LIVE_STATUS.MUTED), {
      ...working,
      activity: { voice: VOICE_PHASE.ABOUT_TO_ANSWER, notes: false },
    })?.voiceWord,
    "About to answer",
  );
  assert.deepEqual(callStatus(call(LIVE_STATUS.SPEAKING), working), {
    voiceWord: "Luke speaking",
    backend,
  });
  assert.equal(callStatus(call(LIVE_STATUS.CONNECTING), working)?.voiceWord, "Connecting");
  assert.equal(callStatus(call(LIVE_STATUS.CLOSING), working)?.voiceWord, "Closing");
});

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
    label: "Talk about this plan",
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
      "Talk about this plan",
    );
  }
});

test("an archived plan opens no call, and its own call still standing is still muted and heard again", () => {
  const input = {
    voiceAvailable: true,
    microphoneStatus: MICROPHONE_STATUS.GRANTED,
    activePlanId: INVITES,
    archived: true,
    listening: false,
    callPlanId: undefined,
    voiceStatus: LIVE_STATUS.IDLE,
  };
  assert.deepEqual(microphoneButton(input), {
    press: MICROPHONE_PRESS.NONE,
    label: ARCHIVED_CALL_LABEL,
    muted: false,
  });
  // Another plan's call heard would be hung up for this one, which an archive refuses too.
  assert.equal(
    microphoneButton({
      ...input,
      listening: true,
      callPlanId: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
    }).press,
    MICROPHONE_PRESS.NONE,
  );
  assert.deepEqual(
    microphoneButton({
      ...input,
      listening: true,
      callPlanId: INVITES,
      voiceStatus: LIVE_STATUS.LISTENING,
    }),
    { press: MICROPHONE_PRESS.TALK, label: "Mute the microphone", muted: false },
  );
});

/** A plan's row of the list on a repository, last updated at `updatedAt`. */
function onRepository(name: string, repository: string | null, updatedAt: number) {
  return { id: name, name, createdAt: 1, updatedAt, repository };
}

test("plans group by repository, the group updated last first and the plans with none last, each group keeping the order it was handed", () => {
  const groups = repositoryGroups([
    onRepository("Exports", "acme/ledger", 10),
    onRepository("Notes", null, 99),
    onRepository("Invites", "acme/relay", 30),
    onRepository("Billing", "acme/ledger", 40),
    onRepository("Search", "acme/relay", 20),
  ]);

  assert.deepEqual(
    groups.map(({ repository, plans }) => [repository, plans.map((plan) => plan.name)]),
    [
      ["acme/ledger", ["Exports", "Billing"]],
      ["acme/relay", ["Invites", "Search"]],
      [null, ["Notes"]],
    ],
  );
});

test("a group's header names its repository alone, and owner and name where another repository shares the name", () => {
  const groups = repositoryGroups([
    onRepository("Invites", "acme/relay", 3),
    onRepository("Fork", "dean/relay", 2),
    onRepository("Billing", "acme/ledger", 1),
  ]);

  assert.deepEqual(
    ["acme/relay", "dean/relay", "acme/ledger"].map((repository) =>
      repositoryLabel(repository, groups),
    ),
    ["acme/relay", "dean/relay", "ledger"],
  );
});
