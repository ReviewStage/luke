import assert from "node:assert/strict";
import test from "node:test";
import { SESSION_NOTICE_STATUS, SESSION_STATUS, type SessionNotice } from "@sidecar/core";
import { sessionNotificationContent } from "../src/session-notifications";

function notice(overrides: Partial<SessionNotice> = {}): SessionNotice {
  return {
    providerId: "claude-code",
    providerSessionId: "run:1",
    providerName: "Claude Code",
    title: "Implement better notifications",
    status: SESSION_NOTICE_STATUS.COMPLETE,
    previousStatus: SESSION_STATUS.WORKING,
    observedAt: 100,
    ...overrides,
  };
}

test("a notice is worded in the shape macOS shows: name, place, what happened", () => {
  assert.deepEqual(
    sessionNotificationContent(notice({ repository: "luke", branch: "conductor/algiers" })),
    {
      title: "Implement better notifications",
      subtitle: "luke · conductor/algiers",
      body: "Claude Code finished.",
    },
  );
  // Half a place is still a place; none leaves the line off entirely.
  assert.equal(sessionNotificationContent(notice({ branch: "algiers" })).subtitle, "algiers");
  assert.equal(sessionNotificationContent(notice()).subtitle, undefined);
});

test("each status says what it asks of the developer", () => {
  assert.equal(
    sessionNotificationContent(notice({ status: SESSION_NOTICE_STATUS.WAITING })).body,
    "Claude Code is waiting on you.",
  );
  assert.equal(
    sessionNotificationContent(notice({ status: SESSION_NOTICE_STATUS.ERROR })).body,
    "Claude Code stopped on an error.",
  );
  // The provider's own reason rides along when it gave one — already bounded
  // by normalization, never a transcript.
  assert.equal(
    sessionNotificationContent(
      notice({ status: SESSION_NOTICE_STATUS.ERROR, error: "API rate limit" }),
    ).body,
    "Claude Code stopped: API rate limit",
  );
});
