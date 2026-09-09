import assert from "node:assert/strict";
import test from "node:test";
import { REALTIME_STATUS } from "@sidecar/realtime";
import { CONVERSATION_ENTRY_KIND, streamingConversationEntry } from "@sidecar/session";
import type { UnparsedWireValue } from "@sidecar/wire";
import {
  IDLE_VOICE_VIEW,
  isRealtimeStatus,
  isVoiceCommand,
  isVoiceView,
  VOICE_COMMAND,
  type VoiceView,
} from "./voice-view";

test("every realtime status is recognized and nothing else is", () => {
  for (const status of Object.values(REALTIME_STATUS)) {
    assert.equal(isRealtimeStatus(status), true);
  }
  assert.equal(isRealtimeStatus("speaking"), false);
  assert.equal(isRealtimeStatus(1), false);
});

test("the four voice commands are the whole set; a typed ask is a brain submission, not one", () => {
  const commands = Object.values(VOICE_COMMAND);
  assert.equal(commands.length, 4);
  assert.equal(isVoiceCommand("ask-text"), false);
  for (const command of commands) assert.equal(isVoiceCommand(command), true);
  assert.equal(isVoiceCommand("stop-microphone"), false);
});

/** The view as IPC hands it to the guard: a structured clone, its types erased. */
function overWire(view: VoiceView): UnparsedWireValue {
  // SAFETY: JSON.parse returns the erased value the guard under test exists to parse.
  return JSON.parse(JSON.stringify(view)) as UnparsedWireValue;
}

test("a view carrying a caption and its streaming line is a voice view", () => {
  const line = streamingConversationEntry(CONVERSATION_ENTRY_KIND.REPLY, "On my way.");
  assert.ok(line);
  assert.equal(
    isVoiceView(
      overWire({
        ...IDLE_VOICE_VIEW,
        voiceStatus: REALTIME_STATUS.RESPONDING,
        lukeCaptions: ["On my way."],
        liveConversationEntries: [line],
      }),
    ),
    true,
  );
});

test("a streaming line refuses empty words or an unknown kind", () => {
  assert.equal(
    isVoiceView(
      overWire({
        ...IDLE_VOICE_VIEW,
        liveConversationEntries: [{ kind: CONVERSATION_ENTRY_KIND.REPLY, words: "" }],
      }),
    ),
    false,
  );
  assert.equal(
    isVoiceView(
      overWire({
        ...IDLE_VOICE_VIEW,
        // SAFETY: the test hands the guard a kind it must refuse, which the view type cannot spell.
        liveConversationEntries: [{ kind: "not-a-kind" as "reply", words: "words" }],
      }),
    ),
    false,
  );
});
