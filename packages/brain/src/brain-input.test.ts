import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeSession,
  type ProviderSessionObservation,
  SESSION_STATUS,
  type Session,
  type SessionProvider,
} from "@sidecar/session";
import { isRecord, isWireString, unparsedWire, type WireRecord, wireRecord } from "@sidecar/wire";
import { BRAIN_DELIVERY_SOURCE, BRAIN_WAKE_KIND, type BrainWakeEvent } from "./brain-events.js";
import {
  askInputItem,
  BRAIN_INPUT_MARKER,
  holdReleasedInputItem,
  standingContextItem,
  wakeInputItem,
} from "./brain-input.js";
import type { ResponsesInputItem } from "./brain-openai.js";

const NOW = 1_800_000_000_000;
const claude: SessionProvider = { id: "claude-code", displayName: "Claude Code" };

function session(overrides: Partial<ProviderSessionObservation> = {}): Session {
  return normalizeSession(claude, {
    providerSessionId: "abc",
    title: "Fix the checkout tests",
    status: SESSION_STATUS.WAITING,
    lastActivityAt: NOW - 1_000,
    detail: { activity: "Running tests", error: "exit 1" },
    ...overrides,
  });
}

function itemText(item: ResponsesInputItem): string {
  assert.ok(Array.isArray(item.content));
  const [first] = item.content;
  assert.ok(isRecord(first) && isWireString(first.text));
  return first.text;
}

function itemBody(item: ResponsesInputItem, marker: string): WireRecord {
  const text = itemText(item);
  const [head, ...rest] = text.split("\n");
  assert.ok(head?.startsWith(`${marker} `), `opens with ${marker}`);
  const parsed = wireRecord(unparsedWire(JSON.parse(rest.join("\n"))));
  assert.ok(parsed);
  return parsed;
}

test("a wake item carries each event's observed fields and transcript delta as data", () => {
  const event: BrainWakeEvent = {
    kind: BRAIN_WAKE_KIND.HOOK,
    hookEvent: "Stop",
    identity: { providerId: claude.id, providerSessionId: "abc" },
    previousStatus: SESSION_STATUS.WORKING,
    session: session(),
    transcriptDelta: { text: "assistant: done", truncated: false, status: "accepted" },
    atMs: NOW,
  };
  const body = itemBody(wakeInputItem([event], NOW), BRAIN_INPUT_MARKER.OBSERVED_EVENTS);
  assert.deepEqual(body, {
    events: [
      {
        kind: "hook",
        at: new Date(NOW).toISOString(),
        hook: "Stop",
        provider_id: "claude-code",
        provider_session_id: "abc",
        previous_status: "working",
        session: {
          provider_name: "Claude Code",
          title: "Fix the checkout tests",
          status: "waiting",
          error: "exit 1",
          activity: "Running tests",
          updated_at: new Date(NOW - 1_000).toISOString(),
        },
        transcript_delta: { status: "accepted", truncated: false, text: "assistant: done" },
      },
    ],
  });
});

test("an ask item carries the question and the events that arrived since the last turn", () => {
  const body = itemBody(
    askInputItem(
      "what's running?",
      [
        {
          kind: BRAIN_WAKE_KIND.STATUS_EDGE,
          identity: { providerId: claude.id, providerSessionId: "abc" },
          atMs: NOW,
        },
      ],
      NOW,
    ),
    BRAIN_INPUT_MARKER.DEVELOPER_ASK,
  );
  assert.equal(body.question, "what's running?");
  assert.ok(Array.isArray(body.events_since_last_turn));
  assert.equal(body.events_since_last_turn.length, 1);
});

test("a hold-released item lists the held briefings with their sessions", () => {
  const body = itemBody(
    holdReleasedInputItem(
      [
        {
          briefing: "Checkout agent wants a decision.",
          sessionIds: [{ providerId: claude.id, providerSessionId: "abc" }],
          decidedAt: NOW - 60_000,
          source: BRAIN_DELIVERY_SOURCE.WAKE,
        },
      ],
      NOW,
    ),
    BRAIN_INPUT_MARKER.HOLD_RELEASED,
  );
  assert.deepEqual(body, {
    held_briefings: [
      {
        briefing: "Checkout agent wants a decision.",
        decided_at: new Date(NOW - 60_000).toISOString(),
        session_ids: [{ provider_id: "claude-code", provider_session_id: "abc" }],
      },
    ],
  });
});

test("the standing context item is the roster and then whatever else the host rendered", () => {
  const text = itemText(
    standingContextItem("Currently observed sessions:\n- one", "Facts.\n", NOW),
  );
  assert.ok(text.startsWith(`${BRAIN_INPUT_MARKER.STANDING_CONTEXT} `));
  assert.ok(text.endsWith("Currently observed sessions:\n- one\n\nFacts."));
  const bare = itemText(standingContextItem("No sessions.", "   ", NOW));
  assert.ok(bare.endsWith("\nNo sessions."));
});
