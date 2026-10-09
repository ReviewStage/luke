import assert from "node:assert/strict";
import type { Plan } from "@sidecar/hosted/plan-wire";
import { PLANNING_READ, type PlanningView, VOICE_PHASE } from "@sidecar/hosted/planning-view";
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
  folderLine,
  folderName,
  MICROPHONE_PRESS,
  microphoneButton,
  PLANS_PAGE,
  planningCallInProgress,
  plansPage,
  recentFolders,
} from "./planning-model";

const INVITES = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const BILLING = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

const PLAN: Plan = {
  id: INVITES,
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  document: { body: "# Teammate invitations", assumptions: [] },
};

function view(patch: Partial<PlanningView>): PlanningView {
  return {
    plans: [],
    listStatus: PLANNING_READ.READY,
    document: { status: PLANNING_READ.IDLE },
    folders: {},
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

test("the header names the plan's folder, with the home folder as ~", () => {
  assert.equal(folderLine("/Users/dev/relay"), "~/relay");
  assert.equal(folderLine("/Users/dev"), "~");
  assert.equal(folderLine("/Volumes/work/relay"), "/Volumes/work/relay");
});

test("an open plan is the document page, and with none open the tab is the new-plan page", () => {
  assert.equal(plansPage(view({})), PLANS_PAGE.NEW);
  // A plan another panel opened, or one just started from the new-plan page, is the document page here too.
  assert.equal(plansPage(view({ activePlanId: INVITES })), PLANS_PAGE.DOCUMENT);
});

test("a folder chip names the folder by its last segment", () => {
  assert.equal(folderName("/Users/dev/relay"), "relay");
  assert.equal(folderName("/Users/dev/relay/"), "relay");
  assert.equal(folderName("/"), "/");
});

test("the recent folders follow the plans' order, each once, skipping a plan with no folder here, five at most", () => {
  const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const plans = ids.map((id) => ({ ...PLAN, id }));
  const folders = {
    a: "/Users/dev/relay",
    c: "/Users/dev/api",
    d: "/Users/dev/relay",
    e: "/Users/dev/web",
    f: "/Users/dev/docs",
    g: "/Users/dev/cli",
    h: "/Users/dev/infra",
  };

  assert.deepEqual(recentFolders(plans, folders), [
    "/Users/dev/relay",
    "/Users/dev/api",
    "/Users/dev/web",
    "/Users/dev/docs",
    "/Users/dev/cli",
  ]);
  assert.deepEqual(recentFolders(plans, {}), []);
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

const REVIEWED = {
  body: "# Teammate invitations\n\n## Open questions\n\n- Who can withdraw an invite?",
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

test("a planning call in progress holds the panel open, and a desk call or a finished one does not", () => {
  const on = (voiceStatus: LiveStatus, callPlanId: string | undefined) =>
    planningCallInProgress({ ...IDLE_VOICE_VIEW, voiceStatus, callPlanId });
  assert.equal(on(LIVE_STATUS.CONNECTING, INVITES), true);
  assert.equal(on(LIVE_STATUS.LISTENING, INVITES), true);
  assert.equal(on(LIVE_STATUS.SPEAKING, INVITES), true);
  assert.equal(on(LIVE_STATUS.MUTED, INVITES), true);
  assert.equal(on(LIVE_STATUS.LISTENING, undefined), false);
  assert.equal(on(LIVE_STATUS.CLOSING, INVITES), false);
  assert.equal(on(LIVE_STATUS.FAILED, INVITES), false);
  assert.equal(on(LIVE_STATUS.IDLE, undefined), false);
});
