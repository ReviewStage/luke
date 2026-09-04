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
import { DIGEST_SOURCE, DIGEST_STOP_STATE } from "./brain-digest.js";
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

test("a wake item carries each event's observed fields and transcript digest as data", () => {
  const event: BrainWakeEvent = {
    kind: BRAIN_WAKE_KIND.HOOK,
    hookEvent: "Stop",
    identity: { providerId: claude.id, providerSessionId: "abc" },
    session: session(),
    digest: {
      status: "accepted",
      truncated: false,
      source: DIGEST_SOURCE.MODEL,
      digest: {
        stopState: DIGEST_STOP_STATE.WAITING_FOR_DEVELOPER,
        lastAsk: "fix the checkout tests",
        didSince: "ran the suite and found one failure",
        waitingOn: "which fixture to use",
      },
    },
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
        session: {
          provider_name: "Claude Code",
          title: "Fix the checkout tests",
          status: "waiting",
          error: "exit 1",
          activity: "Running tests",
          updated_at: new Date(NOW - 1_000).toISOString(),
        },
        transcript_digest: {
          status: "accepted",
          truncated: false,
          source: "model",
          stop_state: "waiting-for-developer",
          last_ask: "fix the checkout tests",
          did_since: "ran the suite and found one failure",
          waiting_on: "which fixture to use",
        },
      },
    ],
  });
});

test("a fallback digest carries the stop state alone, and an event without one carries no digest key", () => {
  const identity = { providerId: claude.id, providerSessionId: "abc" };
  const withFallback = itemBody(
    wakeInputItem(
      [
        {
          kind: BRAIN_WAKE_KIND.HOOK,
          identity,
          digest: {
            status: "accepted",
            truncated: true,
            source: DIGEST_SOURCE.FALLBACK,
            digest: { stopState: DIGEST_STOP_STATE.ERRORED, waitingOn: "exit 1" },
          },
          atMs: NOW,
        },
      ],
      NOW,
    ),
    BRAIN_INPUT_MARKER.OBSERVED_EVENTS,
  );
  assert.ok(Array.isArray(withFallback.events));
  const [event] = withFallback.events;
  assert.ok(isRecord(event));
  assert.deepEqual(event.transcript_digest, {
    status: "accepted",
    truncated: true,
    source: "fallback",
    stop_state: "errored",
    waiting_on: "exit 1",
  });

  const without = itemBody(
    wakeInputItem([{ kind: BRAIN_WAKE_KIND.ROSTER, identity, atMs: NOW }], NOW),
    BRAIN_INPUT_MARKER.OBSERVED_EVENTS,
  );
  assert.ok(Array.isArray(without.events) && isRecord(without.events[0]));
  assert.ok(!("transcript_digest" in without.events[0]));
  assert.ok(!("transcript_delta" in without.events[0]));
});

test("an ask item carries the question and the events that arrived since the last turn", () => {
  const body = itemBody(
    askInputItem(
      "what's running?",
      [
        {
          kind: BRAIN_WAKE_KIND.HOOK,
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

test("a hold-released item lists the held briefings", () => {
  const body = itemBody(
    holdReleasedInputItem(
      [
        {
          briefing: "Checkout agent wants a decision.",
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
