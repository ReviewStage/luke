import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeSession,
  type ProviderSessionObservation,
  SESSION_STATUS,
  type Session,
  type SessionProvider,
} from "@sidecar/session";
import { BRAIN_WAKE_KIND } from "./brain-events.js";
import { SessionStatusEdgeTracker, STATUS_EDGE_MAXIMUM_AGE_MS } from "./status-edges.js";

const NOW = 1_800_000_000_000;
const claude: SessionProvider = { id: "claude-code", displayName: "Claude Code" };

function session(id: string, overrides: Partial<ProviderSessionObservation> = {}): Session {
  return normalizeSession(claude, {
    providerSessionId: id,
    title: `Claude Code: ${id}`,
    status: SESSION_STATUS.WORKING,
    lastActivityAt: NOW,
    ...overrides,
  });
}

test("a fresh new session and every status change wake the brain, an unchanged one does not", () => {
  const tracker = new SessionStatusEdgeTracker();
  const first = tracker.edges([session("a")], NOW);
  assert.equal(first.length, 1);
  assert.equal(first[0]?.kind, BRAIN_WAKE_KIND.STATUS_EDGE);
  assert.equal(first[0]?.previousStatus, undefined);
  assert.deepEqual(first[0]?.identity, { providerId: "claude-code", providerSessionId: "a" });

  assert.equal(tracker.edges([session("a")], NOW + 1_000).length, 0);

  const waiting = tracker.edges([session("a", { status: SESSION_STATUS.WAITING })], NOW + 2_000);
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0]?.previousStatus, SESSION_STATUS.WORKING);
  assert.equal(waiting[0]?.session?.status, SESSION_STATUS.WAITING);
  assert.equal(waiting[0]?.atMs, NOW + 2_000);

  const back = tracker.edges([session("a", { status: SESSION_STATUS.WORKING })], NOW + 3_000);
  assert.equal(back.length, 1);
  assert.equal(back[0]?.previousStatus, SESSION_STATUS.WAITING);
});

test("a change older than the freshness bound is tracked but never replayed", () => {
  const tracker = new SessionStatusEdgeTracker();
  const stale = session("old", {
    status: SESSION_STATUS.COMPLETE,
    lastActivityAt: NOW - STATUS_EDGE_MAXIMUM_AGE_MS - 1,
  });
  assert.equal(tracker.edges([stale], NOW).length, 0);
  assert.equal(tracker.edges([stale], NOW + 1_000).length, 0);
  const fresh = session("old", { status: SESSION_STATUS.WORKING, lastActivityAt: NOW + 2_000 });
  const edges = tracker.edges([fresh], NOW + 2_000);
  assert.equal(edges.length, 1);
  assert.equal(edges[0]?.previousStatus, SESSION_STATUS.COMPLETE);
});

test("Luke's own voice sessions never wake him, and a vanished session is forgotten", () => {
  const tracker = new SessionStatusEdgeTracker();
  assert.equal(tracker.edges([session("voice", { realtimeVoice: true })], NOW).length, 0);
  assert.equal(tracker.edges([session("a")], NOW).length, 1);
  assert.equal(tracker.edges([], NOW + 1_000).length, 0);
  assert.equal(tracker.edges([session("a")], NOW + 2_000).length, 1);
});
