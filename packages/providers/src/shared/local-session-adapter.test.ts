import assert from "node:assert/strict";
import test from "node:test";
import { OBSERVATION_WINDOW, SESSION_STATUS, type SessionStatus } from "@sidecar/session";
import { HOOK_SPOOL_MAXIMUM_AGE_MS } from "./hook-merge.js";
import {
  HOOK_EVENT_TOLERANCE_MS,
  HOOK_NOTIFICATION_HOLD_HORIZON_MS,
  type HookStatusRefinement,
  hookRefinedStatus,
  localSessionStatus,
} from "./local-session-adapter.js";

const TEST_TIME = Date.parse("2026-08-20T12:00:00.000Z");
const FRESHNESS_MS = OBSERVATION_WINDOW.ACTIVE_SESSION_FRESHNESS_MS;

const TEST_HOOK_EVENT = {
  PROMPT: "prompt",
  STOP: "stop",
  NOTIFICATION: "notification",
  SESSION_END: "session-end",
  STOP_FAILURE: "stop-failure",
} as const;

type TestHookEvent = (typeof TEST_HOOK_EVENT)[keyof typeof TEST_HOOK_EVENT];

// The same shape every hooked adapter declares, so what these tests pin is
// the shared merge those adapters stand on rather than any one provider's.
const TEST_REFINEMENT = {
  definitive: [
    { event: TEST_HOOK_EVENT.STOP_FAILURE, fresh: SESSION_STATUS.ERROR },
    { event: TEST_HOOK_EVENT.SESSION_END, fresh: SESSION_STATUS.COMPLETE },
  ],
  fresh: [
    { event: TEST_HOOK_EVENT.PROMPT, fresh: SESSION_STATUS.WORKING },
    { event: TEST_HOOK_EVENT.STOP, fresh: SESSION_STATUS.WAITING },
    {
      event: TEST_HOOK_EVENT.NOTIFICATION,
      fresh: SESSION_STATUS.WAITING,
      stale: SESSION_STATUS.WAITING,
    },
  ],
  notificationEvent: TEST_HOOK_EVENT.NOTIFICATION,
  sessionEndEvent: TEST_HOOK_EVENT.SESSION_END,
} as const satisfies HookStatusRefinement<TestHookEvent>;

function refined(options: {
  hookEvent?: { event: TestHookEvent; atMs: number };
  providerAtMs: number;
  providerStatus?: SessionStatus;
}) {
  return hookRefinedStatus({
    refinement: TEST_REFINEMENT,
    hookEvent: options.hookEvent,
    providerAtMs: options.providerAtMs,
    statusAt: (observedAt) =>
      localSessionStatus(
        options.providerStatus ?? SESSION_STATUS.WORKING,
        observedAt,
        TEST_TIME,
        FRESHNESS_MS,
      ),
    now: TEST_TIME,
    activeSessionFreshnessMs: FRESHNESS_MS,
  });
}

test("an event behind the provider's clock by more than the tolerance refines nothing", () => {
  const providerAtMs = TEST_TIME - 60_000;
  const result = refined({
    hookEvent: {
      event: TEST_HOOK_EVENT.STOP,
      atMs: providerAtMs - HOOK_EVENT_TOLERANCE_MS - 1,
    },
    providerAtMs,
  });

  assert.equal(result.status, SESSION_STATUS.WORKING);
  assert.equal(result.observedAt, providerAtMs);
});

test("a standing event refines the status and dates the session", () => {
  const result = refined({
    hookEvent: { event: TEST_HOOK_EVENT.STOP, atMs: TEST_TIME - 1_000 },
    providerAtMs: TEST_TIME - 60_000,
  });

  assert.equal(result.status, SESSION_STATUS.WAITING);
  assert.equal(result.observedAt, TEST_TIME - 1_000);
  assert.equal(result.holdingForDeveloper, false);
});

test("a stop event past freshness decays the way provider state does", () => {
  const result = refined({
    hookEvent: { event: TEST_HOOK_EVENT.STOP, atMs: TEST_TIME - 20 * 60_000 },
    providerAtMs: TEST_TIME - 30 * 60_000,
  });

  assert.equal(result.status, SESSION_STATUS.UNKNOWN);
});

test("a notification gets no tolerance against the provider's clock", () => {
  // The approval was granted and the call ran: provider state past the event
  // is itself the news that the hold ended.
  const result = refined({
    hookEvent: { event: TEST_HOOK_EVENT.NOTIFICATION, atMs: TEST_TIME - 3_000 },
    providerAtMs: TEST_TIME - 1_000,
  });

  assert.equal(result.status, SESSION_STATUS.WORKING);
  assert.equal(result.holdingForDeveloper, false);
});

test("a notification hold outlives the freshness window", () => {
  const result = refined({
    hookEvent: { event: TEST_HOOK_EVENT.NOTIFICATION, atMs: TEST_TIME - 20 * 60_000 },
    providerAtMs: TEST_TIME - 30 * 60_000,
  });

  assert.equal(result.status, SESSION_STATUS.WAITING);
  assert.equal(result.holdingForDeveloper, true);
});

test("a notification hold at the horizon's edge is still an ask", () => {
  const result = refined({
    hookEvent: {
      event: TEST_HOOK_EVENT.NOTIFICATION,
      atMs: TEST_TIME - HOOK_NOTIFICATION_HOLD_HORIZON_MS,
    },
    providerAtMs: TEST_TIME - HOOK_NOTIFICATION_HOLD_HORIZON_MS - 60 * 60_000,
  });

  assert.equal(result.status, SESSION_STATUS.WAITING);
  assert.equal(result.holdingForDeveloper, true);
});

test("a notification hold past the horizon stands down on its own", () => {
  const providerAtMs = TEST_TIME - HOOK_NOTIFICATION_HOLD_HORIZON_MS - 60 * 60_000;
  const result = refined({
    hookEvent: {
      event: TEST_HOOK_EVENT.NOTIFICATION,
      atMs: TEST_TIME - HOOK_NOTIFICATION_HOLD_HORIZON_MS - 60_000,
    },
    providerAtMs,
  });

  assert.equal(result.status, SESSION_STATUS.UNKNOWN);
  assert.equal(result.holdingForDeveloper, false);
  // An expired hold refines nothing, dating included: the provider's own
  // clock answers alone, exactly as it would with no event at all.
  assert.equal(result.observedAt, providerAtMs);
});

test("a session-end event reports the closure as the completion's cause", () => {
  const result = refined({
    hookEvent: { event: TEST_HOOK_EVENT.SESSION_END, atMs: TEST_TIME - 1_000 },
    providerAtMs: TEST_TIME - 2_000,
  });

  assert.equal(result.status, SESSION_STATUS.COMPLETE);
  assert.equal(result.sessionClosed, true);
});

test("a provider already settled on complete is never softened", () => {
  const result = refined({
    hookEvent: { event: TEST_HOOK_EVENT.STOP, atMs: TEST_TIME - 1_000 },
    providerAtMs: TEST_TIME - 2_000,
    providerStatus: SESSION_STATUS.COMPLETE,
  });

  assert.equal(result.status, SESSION_STATUS.COMPLETE);
});

test("the hold horizon sits between the freshness decay and the spool's age bound", () => {
  // Shorter than freshness and the stale mapping would mean nothing; longer
  // than the spool's maximum age and the prune would drop the file before
  // this horizon ever decided anything.
  assert.ok(HOOK_NOTIFICATION_HOLD_HORIZON_MS > OBSERVATION_WINDOW.ACTIVE_SESSION_FRESHNESS_MS);
  assert.ok(HOOK_NOTIFICATION_HOLD_HORIZON_MS < HOOK_SPOOL_MAXIMUM_AGE_MS);
});
