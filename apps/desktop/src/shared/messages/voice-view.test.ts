import assert from "node:assert/strict";
import { LIVE_STATUS, type LiveStatus, TRANSCRIPT_SPEAKER } from "@sidecar/live";
import type { UnparsedWireValue } from "@sidecar/wire";
import { test } from "vitest";
import {
  callInProgress,
  IDLE_VOICE_VIEW,
  isLiveStatus,
  isVoiceCommand,
  isVoiceView,
  VOICE_COMMAND,
  type VoiceView,
} from "./voice-view";

const PLAN = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

test("every live status is recognized and nothing else is", () => {
  for (const status of Object.values(LIVE_STATUS)) {
    assert.equal(isLiveStatus(status), true);
  }
  assert.equal(isLiveStatus("responding"), false);
  assert.equal(isLiveStatus(1), false);
});

test("the six voice commands are the whole set", () => {
  const commands = Object.values(VOICE_COMMAND);
  assert.equal(commands.length, 6);
  assert.equal(isVoiceCommand("ask-text"), false);
  for (const command of commands) assert.equal(isVoiceCommand(command), true);
  assert.equal(isVoiceCommand("stop-microphone"), false);
});

/** The view as IPC hands it to the guard: a structured clone, its types erased. */
function overWire(view: VoiceView): UnparsedWireValue {
  // SAFETY: JSON.parse returns the erased value the guard under test exists to parse.
  return JSON.parse(JSON.stringify(view)) as UnparsedWireValue;
}

test("a view carrying the developer's own caption is a voice view, and a malformed one is not", () => {
  const view = {
    ...IDLE_VOICE_VIEW,
    voiceStatus: LIVE_STATUS.LISTENING,
    developerCaptions: ["what needs me"],
  };
  assert.equal(isVoiceView(overWire(view)), true);
  // SAFETY: the guard under test exists to refuse a caption list that is one string, which the type forbids building.
  const malformed = { ...view, developerCaptions: "what needs me" } as unknown as VoiceView;
  assert.equal(isVoiceView(overWire(malformed)), false);
});

test("a view carrying the call's words is a voice view, and a line naming no speaker is not", () => {
  const view: VoiceView = {
    ...IDLE_VOICE_VIEW,
    voiceStatus: LIVE_STATUS.LISTENING,
    callTranscript: {
      voiceSessionId: "5d2c8f61-3a7e-4b19-8c0d-2e9f4a6b7c81",
      lines: [
        { rowId: "row-1", speaker: TRANSCRIPT_SPEAKER.USER, words: "Invites should expire." },
      ],
    },
  };
  assert.equal(isVoiceView(overWire(view)), true);
  // SAFETY: the guard under test exists to refuse a speaker the type forbids building.
  const malformed = {
    ...view,
    callTranscript: {
      voiceSessionId: undefined,
      lines: [{ rowId: "row-1", speaker: "system", words: "" }],
    },
  } as unknown as VoiceView;
  assert.equal(isVoiceView(overWire(malformed)), false);
});

test("a planning call in progress holds the panel open, and a desk call or a finished one does not", () => {
  const on = (voiceStatus: LiveStatus, callPlanId: string | undefined) =>
    callInProgress({ ...IDLE_VOICE_VIEW, voiceStatus, callPlanId });
  assert.equal(on(LIVE_STATUS.CONNECTING, PLAN), true);
  assert.equal(on(LIVE_STATUS.LISTENING, PLAN), true);
  assert.equal(on(LIVE_STATUS.SPEAKING, PLAN), true);
  assert.equal(on(LIVE_STATUS.MUTED, PLAN), true);
  assert.equal(on(LIVE_STATUS.LISTENING, undefined), false);
  assert.equal(on(LIVE_STATUS.CLOSING, PLAN), false);
  assert.equal(on(LIVE_STATUS.FAILED, PLAN), false);
  assert.equal(on(LIVE_STATUS.IDLE, undefined), false);
});
