import assert from "node:assert/strict";
import { GITHUB_FAILURE } from "@sidecar/hosted/github-wire";
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
  COPY_SHOWN,
  callStatus,
  copyPlanDocument,
  copyShown,
  DOCUMENT_REGION,
  documentRegion,
  githubFailureNote,
  MICROPHONE_PRESS,
  microphoneButton,
  newestReadOnly,
  offersGitHubConnect,
  onEachReturn,
  PLANS_PAGE,
  planningCallHoldsPanel,
  plansPage,
  repositoriesMatching,
  repositoryLine,
} from "./planning-model";

const INVITES = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const BILLING = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

const PLAN: Plan = {
  id: INVITES,
  name: "Teammate invitations",
  repository: {
    owner: "acme",
    name: "relay",
    branch: "main",
    commit: "4f2c9e1a0b3d5c7e9f1a2b3c4d5e6f708192a3b4",
  },
  createdAt: 1,
  updatedAt: 2,
  openedAt: 3,
  document: { body: "# Teammate invitations", assumptions: [] },
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

test("the header names the repository, its branch, and the commit it was started at", () => {
  assert.equal(repositoryLine(PLAN.repository), "acme/relay · main @ 4f2c9e1");
});

test("an account with no usable GitHub connection is offered Connect GitHub, anything else Try again", () => {
  assert.equal(offersGitHubConnect(GITHUB_FAILURE.NOT_CONNECTED), true);
  assert.equal(offersGitHubConnect(GITHUB_FAILURE.ACCESS_DENIED), true);
  assert.equal(offersGitHubConnect(GITHUB_FAILURE.RATE_LIMITED), false);
  assert.equal(offersGitHubConnect(PLAN_CALL_FAILURE.UNANSWERED), false);
  assert.match(githubFailureNote(GITHUB_FAILURE.EMPTY_REPOSITORY), /no commits/u);
});

test("the repository filter narrows by owner and name, case-blind", () => {
  const repositories = [
    { owner: "acme", name: "relay", private: true },
    { owner: "acme", name: "ledger", private: false },
    { owner: "Other", name: "Relay-Docs", private: false },
  ];
  assert.deepEqual(
    repositoriesMatching(repositories, " relay ").map((repository) => repository.name),
    ["relay", "Relay-Docs"],
  );
  assert.equal(repositoriesMatching(repositories, "acme/l").length, 1);
  assert.equal(repositoriesMatching(repositories, "").length, 3);
});

test("an open plan is the document page whatever this panel was doing, and the form shows only with none open", () => {
  assert.equal(plansPage(view({}), false), PLANS_PAGE.LIST);
  assert.equal(plansPage(view({}), true), PLANS_PAGE.NEW);
  // A plan another panel opened, or one just started from this form, is the document page here too.
  assert.equal(plansPage(view({ activePlanId: INVITES }), true), PLANS_PAGE.DOCUMENT);
  assert.equal(plansPage(view({ activePlanId: INVITES }), false), PLANS_PAGE.DOCUMENT);
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
    voiceWord: "Speaking",
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
    listening: false,
    callPlanId: undefined,
  };
  assert.deepEqual(microphoneButton({ ...input, voiceAvailable: false }), {
    press: MICROPHONE_PRESS.NONE,
    label: VOICE_KEYLESS_NOTE,
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
  });
  assert.deepEqual(microphoneButton({ ...input, listening: true, callPlanId: INVITES }), {
    press: MICROPHONE_PRESS.TALK,
    label: "Mute the microphone",
  });
  // A desk call or another plan's call heard is one the press hangs up, not one it mutes.
  for (const callPlanId of [undefined, "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21"]) {
    assert.equal(
      microphoneButton({ ...input, listening: true, callPlanId }).label,
      "Talk about this plan",
    );
  }
});

const REVIEWED = {
  body: "# Teammate invitations\n\n## Handoff prompt\n\nYou are implementing invitations.",
  assumptions: [
    { text: "Members and admins can both invite." },
    { text: "An invite expires after 7 days." },
  ],
};

test("Copy hands the clipboard the whole document, and shows the check mark for that document", async () => {
  const clipboard: string[] = [];

  const outcome = await copyPlanDocument(REVIEWED, async (words) => {
    clipboard.push(words);
  });

  assert.deepEqual(clipboard, [
    `${REVIEWED.body}

## Assumptions

- Members and admins can both invite.
- An invite expires after 7 days.
`,
  ]);
  assert.equal(copyShown(outcome, REVIEWED), COPY_SHOWN.COPIED);
  // A fresh snapshot of the same saved document still holds what was copied.
  assert.equal(copyShown(outcome, structuredClone(REVIEWED)), COPY_SHOWN.COPIED);
});

test("a clipboard that refuses the copy shows the failure rather than the check mark", async () => {
  const outcome = await copyPlanDocument(REVIEWED, async () => {
    throw new Error("Could not copy that to the clipboard on this system.");
  });

  assert.equal(copyShown(outcome, REVIEWED), COPY_SHOWN.FAILED);
});

test("once a save changes the document, Copy returns to rest until pressed again", async () => {
  const outcome = await copyPlanDocument(REVIEWED, async () => undefined);
  const saved = {
    ...REVIEWED,
    assumptions: [...REVIEWED.assumptions, { text: "Invites are by email." }],
  };

  assert.equal(copyShown(outcome, saved), COPY_SHOWN.IDLE);
  assert.equal(copyShown(undefined, REVIEWED), COPY_SHOWN.IDLE);
});

test("the sheet reads again on every return from the browser until the wait is cancelled", () => {
  const window = new EventTarget();
  let reads = 0;
  const cancel = onEachReturn(window, () => {
    reads += 1;
  });

  // Back once mid-way through GitHub's page, then again once the link landed.
  window.dispatchEvent(new Event("focus"));
  window.dispatchEvent(new Event("focus"));
  cancel();
  window.dispatchEvent(new Event("focus"));

  assert.equal(reads, 2);
});

/** A read whose answer the test hands over when it chooses. */
function heldRead() {
  let answer: (value: string) => void = () => undefined;
  const promise = new Promise<string>((resolve) => {
    answer = resolve;
  });
  return { promise, resolve: (value: string) => answer(value) };
}

test("a list read that another read replaced is dropped when it lands late", async () => {
  const applyNewest = newestReadOnly<string>();
  const drawn: string[] = [];
  const older = heldRead();
  const newer = heldRead();

  applyNewest(older.promise, (answer) => drawn.push(answer));
  applyNewest(newer.promise, (answer) => drawn.push(answer));
  newer.resolve("connected");
  await newer.promise;
  older.resolve("not-connected");
  await older.promise;
  await Promise.resolve();

  assert.deepEqual(drawn, ["connected"]);
});

test("a planning call in progress holds the panel open, and a desk call or a finished one does not", () => {
  const on = (voiceStatus: LiveStatus, callPlanId: string | undefined) =>
    planningCallHoldsPanel({ ...IDLE_VOICE_VIEW, voiceStatus, callPlanId });
  assert.equal(on(LIVE_STATUS.CONNECTING, INVITES), true);
  assert.equal(on(LIVE_STATUS.LISTENING, INVITES), true);
  assert.equal(on(LIVE_STATUS.SPEAKING, INVITES), true);
  assert.equal(on(LIVE_STATUS.MUTED, INVITES), true);
  assert.equal(on(LIVE_STATUS.LISTENING, undefined), false);
  assert.equal(on(LIVE_STATUS.CLOSING, INVITES), false);
  assert.equal(on(LIVE_STATUS.FAILED, INVITES), false);
  assert.equal(on(LIVE_STATUS.IDLE, undefined), false);
});
