import assert from "node:assert/strict";
import {
  IDLE_PLANNING_VIEW,
  PLANNING_READ,
  type PlanningView,
} from "@sidecar/hosted/planning-view";
import { LIVE_STATUS } from "@sidecar/live";
import { test } from "vitest";
import { IDLE_VOICE_VIEW, type VoiceView } from "#shared/messages/voice-view";
import {
  CALL_CARD_TONE,
  CALL_CARD_UNNAMED,
  callBarPlanId,
  callCard,
  callCardShown,
} from "./call-card-model";

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

test("the card names the call's plan, not the one open, and says where the call stands", () => {
  const listening = callCard({ view: LISTENING, planning: PLANNING });
  assert.equal(listening.planName, "Teammate invitations");
  assert.deepEqual(listening.status, { words: "Listening", tone: CALL_CARD_TONE.DEVELOPER });
  assert.equal(listening.microphoneMuted, false);

  const speaking = { ...LISTENING, voiceStatus: LIVE_STATUS.SPEAKING, lukeSpeaking: true };
  assert.deepEqual(callCard({ view: speaking, planning: PLANNING }).status, {
    words: "Luke speaking",
    tone: CALL_CARD_TONE.LUKE,
  });

  const muted = callCard({
    view: { ...LISTENING, voiceStatus: LIVE_STATUS.MUTED, listening: false },
    planning: PLANNING,
  });
  assert.deepEqual(muted.status, { words: "Muted", tone: CALL_CARD_TONE.MUTED });
  assert.equal(muted.microphoneMuted, true);

  const opening = callCard({
    view: { ...LISTENING, voiceStatus: LIVE_STATUS.CONNECTING, listening: false },
    planning: PLANNING,
  });
  assert.deepEqual(opening.status, { words: "Connecting…", tone: CALL_CARD_TONE.OPENING });
  assert.equal(opening.microphoneMuted, false);
});

test("Luke writing the call's plan is said under his voice and over the microphone, from the call's own activity", () => {
  const planner = { ...PLANNING, callActivity: { planner: { action: "ls src" }, notes: false } };
  const writing = { words: "Writing…", tone: CALL_CARD_TONE.WORKING };
  assert.deepEqual(callCard({ view: LISTENING, planning: planner }).status, writing);
  const notes = { ...PLANNING, callActivity: { notes: true } };
  assert.deepEqual(callCard({ view: LISTENING, planning: notes }).status, writing);
  const speaking = { ...LISTENING, lukeSpeaking: true };
  assert.equal(callCard({ view: speaking, planning: planner }).status.words, "Luke speaking");
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
    callCard({ view: { ...LISTENING, callPlanId: BILLING }, planning: open }).planName,
    "Billing export",
  );
  assert.equal(
    callCard({ view: LISTENING, planning: IDLE_PLANNING_VIEW }).planName,
    CALL_CARD_UNNAMED,
  );
});

test("a Luke window draws the card only with the keyboard, a call in progress, and anything but the call's plan on screen", () => {
  const shown = (view: VoiceView, focused: boolean, planShown: string | undefined) =>
    callCardShown({ view, focused, planShown });
  assert.equal(shown(LISTENING, true, BILLING), true);
  assert.equal(shown(LISTENING, true, undefined), true);
  // The call's own plan has its call bar; a window without the keyboard leaves the call to the floating window.
  assert.equal(shown(LISTENING, true, INVITES), false);
  assert.equal(shown(LISTENING, false, BILLING), false);
  assert.equal(shown({ ...LISTENING, voiceStatus: LIVE_STATUS.CLOSING }, true, BILLING), false);
  assert.equal(shown(IDLE_VOICE_VIEW, true, BILLING), false);
});

test("the call bar is on screen only on a plan's document, and not under its version history or a side panel filling the window", () => {
  const onPlan = {
    plansTab: true,
    documentPage: true,
    historyOpen: false,
    sidePanelFullScreen: false,
    activePlanId: INVITES,
  };
  assert.equal(callBarPlanId(onPlan), INVITES);
  assert.equal(callBarPlanId({ ...onPlan, historyOpen: true }), undefined);
  assert.equal(callBarPlanId({ ...onPlan, sidePanelFullScreen: true }), undefined);
  assert.equal(callBarPlanId({ ...onPlan, documentPage: false }), undefined);
  assert.equal(callBarPlanId({ ...onPlan, plansTab: false }), undefined);
});
