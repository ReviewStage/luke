import assert from "node:assert/strict";
import {
  normalizeSession,
  type ProviderSessionObservation,
  SESSION_STATUS,
  type Session,
  type SessionProvider,
} from "@sidecar/session";
import { isWireString, unparsedWire, type WireRecord, wireRecord } from "@sidecar/wire";
import { test } from "vitest";
import {
  askInputText,
  BRAIN_INPUT_MARKER,
  CHILD_COMPLETION_STATUS,
  childCompletionInputText,
  childTaskInputText,
  holdReleasedInputText,
  wakeInputText,
} from "./input-items.js";
import { maximumChildTaskLength } from "./tools/names.js";
import { BRAIN_WAKE_KIND, type BrainWakeEvent } from "./wake-events.js";

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

function itemBody(text: string): WireRecord {
  const [, ...rest] = text.split("\n");
  const parsed = wireRecord(unparsedWire(JSON.parse(rest.join("\n"))));
  assert.ok(parsed);
  return parsed;
}

test("a wake item carries each event's observed fields and transcript delta as data", () => {
  const event: BrainWakeEvent = {
    kind: BRAIN_WAKE_KIND.ROSTER,
    identity: { providerId: claude.id, providerSessionId: "abc" },
    session: session(),
    transcriptDelta: { text: "assistant: done", truncated: false, status: "accepted" },
    atMs: NOW,
  };
  const body = itemBody(wakeInputText([event], NOW));
  assert.deepEqual(body, {
    events: [
      {
        kind: BRAIN_WAKE_KIND.ROSTER,
        at: new Date(NOW).toISOString(),
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
        transcript_delta: { status: "accepted", truncated: false, text: "assistant: done" },
      },
    ],
  });
});

test("an ask item carries the question and the events that arrived since the last turn", () => {
  const body = itemBody(
    askInputText(
      "what's running?",
      [
        {
          kind: BRAIN_WAKE_KIND.ROSTER,
          identity: { providerId: claude.id, providerSessionId: "abc" },
          atMs: NOW,
        },
      ],
      NOW,
    ),
  );
  assert.equal(body.question, "what's running?");
  assert.ok(Array.isArray(body.events_since_last_turn));
  assert.equal(body.events_since_last_turn.length, 1);
});

test("a hold-released item lists the held briefings", () => {
  const body = itemBody(
    holdReleasedInputText(
      [
        {
          briefing: "Checkout agent wants a decision.",
          decidedAt: NOW - 60_000,
        },
      ],
      NOW,
    ),
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

test("a child task item is the subagent marker, a space, and the task as briefed", () => {
  assert.equal(
    childTaskInputText("Summarise the fixture repository's open questions."),
    `${BRAIN_INPUT_MARKER.SUBAGENT_TASK} Summarise the fixture repository's open questions.`,
  );
});
test("a child-completion item opens with its marker and carries the child, its end, and its final reply as data", () => {
  const text = childCompletionInputText(
    {
      childId: "child-1",
      label: "fixture label",
      status: CHILD_COMPLETION_STATUS.FAILED,
      result: "Partial notes.",
      failure: "model",
    },
    NOW,
  );
  assert.equal(
    text.split("\n")[0],
    `${BRAIN_INPUT_MARKER.CHILD_COMPLETION} ${new Date(NOW).toISOString()}`,
  );
  assert.deepEqual(itemBody(text), {
    child_id: "child-1",
    label: "fixture label",
    status: CHILD_COMPLETION_STATUS.FAILED,
    result: "Partial notes.",
    truncated: false,
    failure: "model",
  });
  // A child with no label and no failure carries neither key, and a run that completed says so.
  assert.deepEqual(
    itemBody(
      childCompletionInputText(
        {
          childId: "child-2",
          label: undefined,
          status: CHILD_COMPLETION_STATUS.COMPLETED,
          result: "Done.",
          failure: undefined,
        },
        NOW,
      ),
    ),
    {
      child_id: "child-2",
      status: CHILD_COMPLETION_STATUS.COMPLETED,
      result: "Done.",
      truncated: false,
    },
  );
});

test("a child's final reply past the task bound is cut from the front, keeping its conclusion, and said to be cut", () => {
  const result = `${"a".repeat(maximumChildTaskLength)}tail`;
  const body = itemBody(
    childCompletionInputText(
      {
        childId: "child-3",
        label: undefined,
        status: CHILD_COMPLETION_STATUS.CANCELLED,
        result,
        failure: undefined,
      },
      NOW,
    ),
  );
  assert.equal(body.truncated, true);
  const kept = body.result;
  assert.ok(isWireString(kept));
  assert.equal(kept.length, maximumChildTaskLength);
  assert.ok(kept.endsWith("tail"));
  assert.ok(kept.startsWith("aaaa"));
});
