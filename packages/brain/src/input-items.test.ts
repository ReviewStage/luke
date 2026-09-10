import assert from "node:assert/strict";
import test from "node:test";
import { SESSION_STATUS } from "@sidecar/session";
import { unparsedWire, type WireRecord, wireRecord } from "@sidecar/wire";
import {
  askInputText,
  BRAIN_INPUT_MARKER,
  standingContextText,
  tickInputText,
} from "./input-items.js";
import { type BrainTick, TICK_CHANGE_KIND } from "./tick.js";

const NOW = 1_800_000_000_000;
const TRANSCRIPT_TEXT = "assistant: done";

function itemBody(text: string, marker: string): WireRecord {
  const [head, ...rest] = text.split("\n");
  assert.ok(head?.startsWith(`${marker} `), `opens with ${marker}`);
  const parsed = wireRecord(unparsedWire(JSON.parse(rest.join("\n"))));
  assert.ok(parsed);
  return parsed;
}

test("a tick item carries each change as data behind the marker, and never a transcript", () => {
  const tick: BrainTick = {
    changes: [
      {
        kind: TICK_CHANGE_KIND.CHANGED,
        identity: { providerId: "claude-code", providerSessionId: "abc" },
        title: "Fix the checkout tests",
        fields: { status: SESSION_STATUS.WAITING },
        transcriptCharsGained: TRANSCRIPT_TEXT.length,
      },
      {
        kind: TICK_CHANGE_KIND.VANISHED,
        identity: { providerId: "codex", providerSessionId: "def" },
      },
    ],
  };
  const text = tickInputText(tick, NOW);
  assert.ok(text.startsWith(`${BRAIN_INPUT_MARKER.TICK} ${new Date(NOW).toISOString()}\n`));
  assert.ok(!text.includes(TRANSCRIPT_TEXT));
  assert.deepEqual(itemBody(text, BRAIN_INPUT_MARKER.TICK), {
    changes: [
      {
        kind: "changed",
        provider_id: "claude-code",
        provider_session_id: "abc",
        title: "Fix the checkout tests",
        fields: { status: "waiting" },
        transcript_chars_gained: TRANSCRIPT_TEXT.length,
      },
      { kind: "vanished", provider_id: "codex", provider_session_id: "def" },
    ],
  });
});

test("an ask item carries the question alone", () => {
  const body = itemBody(askInputText("what's running?", NOW), BRAIN_INPUT_MARKER.DEVELOPER_ASK);
  assert.deepEqual(body, { question: "what's running?" });
});

test("the standing context item is the roster and then whatever else the host rendered", () => {
  const text = standingContextText("Currently observed sessions:\n- one", "Facts.\n", NOW);
  assert.ok(text.startsWith(`${BRAIN_INPUT_MARKER.STANDING_CONTEXT} `));
  assert.ok(text.endsWith("Currently observed sessions:\n- one\n\nFacts."));
  const bare = standingContextText("No sessions.", "   ", NOW);
  assert.ok(bare.endsWith("\nNo sessions."));
});
