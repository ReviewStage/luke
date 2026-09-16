import assert from "node:assert/strict";
import { LIVE_STATUS } from "@sidecar/live";
import { CONVERSATION_ENTRY_KIND, streamingConversationEntry } from "@sidecar/session";
import type { UnparsedWireValue } from "@sidecar/wire";
import { test } from "vitest";
import {
  IDLE_VOICE_VIEW,
  isLiveStatus,
  isVoiceCommand,
  isVoiceView,
  VOICE_COMMAND,
  type VoiceView,
} from "./voice-view";

test("every live status is recognized and nothing else is", () => {
  for (const status of Object.values(LIVE_STATUS)) {
    assert.equal(isLiveStatus(status), true);
  }
  assert.equal(isLiveStatus("responding"), false);
  assert.equal(isLiveStatus(1), false);
});

test("the three voice commands are the whole set", () => {
  const commands = Object.values(VOICE_COMMAND);
  assert.equal(commands.length, 3);
  assert.equal(isVoiceCommand("ask-text"), false);
  for (const command of commands) assert.equal(isVoiceCommand(command), true);
  assert.equal(isVoiceCommand("stop-microphone"), false);
});

/** The view as IPC hands it to the guard: a structured clone, its types erased. */
function overWire(view: VoiceView): UnparsedWireValue {
  // SAFETY: JSON.parse returns the erased value the guard under test exists to parse.
  return JSON.parse(JSON.stringify(view)) as UnparsedWireValue;
}

test("a view carrying a caption and its live lines, settled or not, is a voice view", () => {
  const line = streamingConversationEntry(CONVERSATION_ENTRY_KIND.REPLY, "On my way.");
  const said = streamingConversationEntry(CONVERSATION_ENTRY_KIND.ASK, "Where are we?");
  assert.ok(line);
  assert.ok(said);
  assert.equal(
    isVoiceView(
      overWire({
        ...IDLE_VOICE_VIEW,
        voiceStatus: LIVE_STATUS.SPEAKING,
        lukeCaptions: ["On my way."],
        liveConversationLines: [
          { rowId: "row-1", entry: said, voiceSessionId: "vs_1", settled: true },
          { rowId: "row-2", entry: line, settled: false },
        ],
      }),
    ),
    true,
  );
});

test("a view carrying the developer's own caption is a voice view, and a malformed one is not", () => {
  const line = streamingConversationEntry(CONVERSATION_ENTRY_KIND.ASK, "what needs me");
  assert.ok(line);
  const view = {
    ...IDLE_VOICE_VIEW,
    voiceStatus: LIVE_STATUS.LISTENING,
    developerCaptions: ["what needs me"],
    liveConversationLines: [{ rowId: "row-1", entry: line, settled: false }],
  };
  assert.equal(isVoiceView(overWire(view)), true);
  // SAFETY: the guard under test exists to refuse a caption list that is one string, which the type forbids building.
  const malformed = { ...view, developerCaptions: "what needs me" } as unknown as VoiceView;
  assert.equal(isVoiceView(overWire(malformed)), false);
});

test("a live line refuses empty words, an unknown kind, a session id that is not a string, or a row without its id and settle", () => {
  assert.equal(
    isVoiceView(
      overWire({
        ...IDLE_VOICE_VIEW,
        liveConversationLines: [
          {
            rowId: "row-1",
            entry: { kind: CONVERSATION_ENTRY_KIND.REPLY, words: "words" },
            // SAFETY: the test hands the guard a session id of the wrong type, which the line type cannot spell.
            voiceSessionId: 7 as unknown as string,
            settled: false,
          },
        ],
      }),
    ),
    false,
  );
  assert.equal(
    isVoiceView(
      overWire({
        ...IDLE_VOICE_VIEW,
        liveConversationLines: [
          {
            rowId: "row-1",
            entry: { kind: CONVERSATION_ENTRY_KIND.REPLY, words: "" },
            settled: false,
          },
        ],
      }),
    ),
    false,
  );
  assert.equal(
    isVoiceView(
      overWire({
        ...IDLE_VOICE_VIEW,
        liveConversationLines: [
          // SAFETY: the test hands the guard a kind it must refuse, which the view type cannot spell.
          {
            rowId: "row-1",
            entry: { kind: "not-a-kind" as "reply", words: "words" },
            settled: false,
          },
        ],
      }),
    ),
    false,
  );
  assert.equal(
    isVoiceView(
      // SAFETY: the test hands the guard a line missing its row, which the view type cannot spell.
      overWire({
        ...IDLE_VOICE_VIEW,
        liveConversationLines: [
          { entry: { kind: CONVERSATION_ENTRY_KIND.REPLY, words: "words" } },
        ] as unknown as VoiceView["liveConversationLines"],
      }),
    ),
    false,
  );
});
