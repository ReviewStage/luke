import assert from "node:assert/strict";
import {
  IDLE_PLANNING_VIEW,
  PLANNING_READ,
  type PlanningView,
} from "@sidecar/hosted/planning-view";
import { LIVE_STATUS } from "@sidecar/live";
import { test } from "vitest";
import { IDLE_VOICE_VIEW, type VoiceView } from "#shared/messages/voice-view";
import { WAVEFORM_VOICE } from "../waveform";
import { CALL_PILL_TONE, CALL_PILL_UNNAMED, callPill } from "./call-pill-model";

const INVITES = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const BILLING = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

/** The list as the sidebar holds it, with the billing plan open in the panel. */
const PLANNING: PlanningView = {
  ...IDLE_PLANNING_VIEW,
  plans: [
    { id: INVITES, name: "Teammate invitations", createdAt: 1, updatedAt: 2, repository: null },
  ],
  activePlanId: BILLING,
};

const LISTENING: VoiceView = {
  ...IDLE_VOICE_VIEW,
  voiceStatus: LIVE_STATUS.LISTENING,
  listening: true,
  callPlanId: INVITES,
};

test("the pill names the call's plan, not the one open, and says the call in the call bar's words", () => {
  const listening = callPill({ view: LISTENING, planning: PLANNING });
  assert.equal(listening.planName, "Teammate invitations");
  assert.deepEqual(listening.status, { words: "Listening", tone: CALL_PILL_TONE.DEVELOPER });
  assert.equal(listening.meterVoice, WAVEFORM_VOICE.DEVELOPER);
  assert.equal(listening.microphoneMuted, false);

  const speaking = callPill({
    view: { ...LISTENING, voiceStatus: LIVE_STATUS.SPEAKING, lukeSpeaking: true, listening: false },
    planning: PLANNING,
  });
  assert.deepEqual(speaking.status, { words: "Luke speaking", tone: CALL_PILL_TONE.LUKE });
  assert.equal(speaking.meterVoice, WAVEFORM_VOICE.LUKE);

  const muted = callPill({
    view: { ...LISTENING, voiceStatus: LIVE_STATUS.MUTED, listening: false },
    planning: PLANNING,
  });
  assert.deepEqual(muted.status, { words: "Muted", tone: CALL_PILL_TONE.MUTED });
  assert.equal(muted.meterVoice, undefined);
  assert.equal(muted.microphoneMuted, true);

  const opening = callPill({
    view: { ...LISTENING, voiceStatus: LIVE_STATUS.CONNECTING, listening: false },
    planning: PLANNING,
  });
  assert.deepEqual(opening.status, { words: "Connecting", tone: CALL_PILL_TONE.OPENING });
  assert.equal(opening.microphoneMuted, false);
});

test("Luke at work on the call's plan is said under his voice and over the microphone, from the call's own activity", () => {
  const working = { ...PLANNING, callActivity: { planner: { action: "ls src" }, notes: false } };
  assert.deepEqual(callPill({ view: LISTENING, planning: working }).status, {
    words: "Planning model · ls src",
    tone: CALL_PILL_TONE.WORKING,
  });
  const thinking = { ...PLANNING, callActivity: { planner: {}, notes: false } };
  assert.equal(
    callPill({ view: LISTENING, planning: thinking }).status.words,
    "Planning model · Thinking",
  );
  const notes = { ...PLANNING, callActivity: { notes: true } };
  assert.equal(
    callPill({ view: LISTENING, planning: notes }).status.words,
    "Notetaker · Writing notes",
  );
  // Luke's own voice is still what the developer is waiting on.
  const speaking = { ...LISTENING, lukeSpeaking: true };
  assert.equal(callPill({ view: speaking, planning: working }).status.words, "Luke speaking");
});

test("a call's plan the list does not hold is named from the open document, or plainly as a call", () => {
  const open: PlanningView = {
    ...IDLE_PLANNING_VIEW,
    activePlanId: BILLING,
    document: {
      status: PLANNING_READ.READY,
      plan: {
        id: BILLING,
        name: "Billing export",
        createdAt: 1,
        updatedAt: 2,
        repository: null,
        document: { body: "# Billing export", assumptions: [] },
      },
    },
  };
  assert.equal(
    callPill({ view: { ...LISTENING, callPlanId: BILLING }, planning: open }).planName,
    "Billing export",
  );
  assert.equal(
    callPill({ view: LISTENING, planning: IDLE_PLANNING_VIEW }).planName,
    CALL_PILL_UNNAMED,
  );
});
