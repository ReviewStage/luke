import assert from "node:assert/strict";
import test from "node:test";
import type { ObservedSession } from "@sidecar/hosted";
import { remoteSessionContextText } from "../server/hosted/remote-context";

const NOW = 1_700_000_000_000;

function session(overrides: Partial<ObservedSession> = {}): ObservedSession {
  return {
    providerId: "conductor",
    sessionId: "session-1",
    title: "Refactor auth",
    status: "working",
    observedAt: NOW - 60_000,
    ...overrides,
  };
}

test("every phone row opens, and the newest per provider wears both recency labels", () => {
  const text = remoteSessionContextText(
    [
      session(),
      session({ sessionId: "session-2", title: "Older work", observedAt: NOW - 3_600_000 }),
    ],
    NOW,
  );
  const [, newest, older] = text.split("\n");
  assert.ok(newest?.includes("open=true"));
  assert.ok(newest?.includes("transcript=false"));
  assert.ok(newest?.includes("most_recent_for_provider=true"));
  assert.ok(newest?.includes("most_recent_openable_for_provider=true"));
  assert.ok(older?.includes("open=true"));
  assert.ok(!older?.includes("most_recent"));
  assert.ok(!text.includes("open=false"));
});

test("an empty roster says so in words", () => {
  assert.equal(
    remoteSessionContextText([], NOW),
    "No coding-agent sessions are currently observed.",
  );
});
