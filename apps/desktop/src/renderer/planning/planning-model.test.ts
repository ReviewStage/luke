import assert from "node:assert/strict";
import { GITHUB_FAILURE } from "@sidecar/hosted/github-wire";
import type { Plan } from "@sidecar/hosted/plan-wire";
import { PLAN_CALL_FAILURE, PLANNING_READ, type PlanningView } from "@sidecar/hosted/planning-view";
import { LIVE_STATUS } from "@sidecar/live";
import { test } from "vitest";
import { MICROPHONE_STATUS } from "#shared/messages/audio";
import { IDLE_VOICE_VIEW } from "#shared/messages/voice-view";
import { VOICE_KEYLESS_NOTE } from "../microphone-access";
import {
  COPY_SHOWN,
  copyPlanDocument,
  copyShown,
  DOCUMENT_REGION,
  documentRegion,
  githubFailureNote,
  MICROPHONE_PRESS,
  microphoneButton,
  offersGitHubConnect,
  repositoriesMatching,
  repositoryLine,
  VOICE_LINE_TONE,
  voiceBarLine,
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

test("the voice bar shows the status word, a voice error in its place, and the newest words said", () => {
  assert.deepEqual(voiceBarLine({ ...IDLE_VOICE_VIEW, voiceStatus: LIVE_STATUS.LISTENING }), {
    status: { tone: VOICE_LINE_TONE.STATUS, text: "Listening" },
    caption: undefined,
  });
  assert.deepEqual(voiceBarLine(IDLE_VOICE_VIEW).status, undefined);
  assert.deepEqual(
    voiceBarLine({
      ...IDLE_VOICE_VIEW,
      voiceStatus: LIVE_STATUS.FAILED,
      voiceError: "The connection dropped.",
    }).status,
    { tone: VOICE_LINE_TONE.ERROR, text: "The connection dropped." },
  );
  // Luke being heard is the thing to read over words that already failed.
  const speaking = voiceBarLine({
    ...IDLE_VOICE_VIEW,
    voiceStatus: LIVE_STATUS.SPEAKING,
    lukeSpeaking: true,
    voiceError: "The connection dropped.",
    lukeCaptions: ["You already have a memberships table.", "I'd add a pending state."],
    developerCaptions: ["Sounds good"],
  });
  assert.deepEqual(speaking, {
    status: { tone: VOICE_LINE_TONE.STATUS, text: "Speaking" },
    caption: "I'd add a pending state.",
  });
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
    { text: "Members and admins can both invite.", confirmed: true },
    { text: "An invite expires after 7 days.", confirmed: false },
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

- [x] Members and admins can both invite.
- [ ] An invite expires after 7 days.
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
    assumptions: [...REVIEWED.assumptions, { text: "Invites are by email.", confirmed: false }],
  };

  assert.equal(copyShown(outcome, saved), COPY_SHOWN.IDLE);
  assert.equal(copyShown(undefined, REVIEWED), COPY_SHOWN.IDLE);
});
