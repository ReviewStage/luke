import assert from "node:assert/strict";
import test from "node:test";
import {
  ATTENTION_DISPOSITION,
  SESSION_NOTICE_STATUS,
  SESSION_STATUS,
  type SessionNotice,
} from "@sidecar/core";
import { sessionNoticeSpeech } from "../src/session-notifications";

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

test("a notice becomes one sentence in the shape attention speech travels in", () => {
  assert.deepEqual(sessionNoticeSpeech(notice({ repository: "luke" }), 5_000), {
    providerId: "claude-code",
    providerSessionId: "run:1",
    disposition: ATTENTION_DISPOSITION.SPEAK_AT_TURN_END,
    summary: 'Claude Code finished "Implement better notifications" on luke.',
    // When the announcement was decided on, not when the provider observed
    // the session: it is what staleness is measured against.
    decidedAt: 5_000,
  });
});

test("each status says what it asks of the developer, with its place when known", () => {
  assert.equal(
    sessionNoticeSpeech(notice({ status: SESSION_NOTICE_STATUS.WAITING, branch: "algiers" }), 0)
      .summary,
    'Claude Code is waiting on you in "Implement better notifications" on algiers.',
  );
  assert.equal(
    sessionNoticeSpeech(notice({ status: SESSION_NOTICE_STATUS.ERROR }), 0).summary,
    'Claude Code stopped on an error in "Implement better notifications".',
  );
  // The provider's own reason rides along when it gave one — already bounded
  // by normalization, never a transcript.
  assert.equal(
    sessionNoticeSpeech(notice({ status: SESSION_NOTICE_STATUS.ERROR, error: "API rate limit" }), 0)
      .summary,
    'Claude Code stopped in "Implement better notifications": API rate limit',
  );
  // No place reported leaves the sentence whole rather than trailing a stub.
  assert.equal(
    sessionNoticeSpeech(notice(), 0).summary,
    'Claude Code finished "Implement better notifications".',
  );
});
