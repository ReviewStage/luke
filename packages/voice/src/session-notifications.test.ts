import assert from "node:assert/strict";
import test from "node:test";
import {
  ATTENTION_REVIEW_OUTCOME,
  ATTENTION_TRIGGER,
  type AttentionReview,
  type AttentionUpdate,
} from "@sidecar/attention";
import { SESSION_ANNOUNCEMENT_CHANGE } from "@sidecar/realtime";
import {
  ATTENTION_DISPOSITION,
  SESSION_NOTICE_STATUS,
  SESSION_STATUS,
  type SessionNotice,
} from "@sidecar/session";
import {
  sessionAnnouncementFromReview,
  sessionNoticeAnnouncement,
} from "./session-notifications.js";

function review(overrides: Partial<AttentionUpdate> = {}): AttentionReview {
  const update: AttentionUpdate = {
    providerId: "claude-code",
    providerSessionId: "session-a",
    trigger: ATTENTION_TRIGGER.STATUS_CHANGED,
    providerName: "Claude Code",
    title: "Checkout service",
    status: SESSION_STATUS.WAITING,
    holdingForDeveloper: true,
    context: { activity: "waiting on a checkout decision" },
    observedAt: 1_000,
    ...overrides,
  };
  return {
    providerId: update.providerId,
    providerSessionId: update.providerSessionId,
    update,
    decision: {
      disposition: ATTENTION_DISPOSITION.SPEAK_DURING_TURN,
      decidedAt: 2_000,
    },
    outcome: ATTENTION_REVIEW_OUTCOME.DECIDED,
  };
}

function waitingNotice(holdingForDeveloper: boolean): SessionNotice {
  return {
    providerId: "conductor",
    providerSessionId: "agent-1",
    providerName: "Conductor",
    title: "Notification fix",
    workspace: "dubai",
    status: SESSION_NOTICE_STATUS.WAITING,
    previousStatus: SESSION_STATUS.WORKING,
    holdingForDeveloper,
    recap: "Updated the notification behavior.",
    repository: "luke",
    branch: "charleslpan/jarvis-like-voice",
    canReceiveMessage: true,
    observedAt: 1_000,
  };
}

function completionNotice(): SessionNotice {
  const notice = waitingNotice(false);
  return {
    ...notice,
    status: SESSION_NOTICE_STATUS.COMPLETE,
  };
}

test("a routine finish does not bypass the attention evaluator", () => {
  const speech = sessionNoticeAnnouncement(waitingNotice(false), 2_000);

  assert.equal(speech, undefined);
});

test("a completed status does not bypass the attention evaluator", () => {
  assert.equal(sessionNoticeAnnouncement(completionNotice(), 2_000), undefined);
});

test("a bare hold does not invent a decision for the developer", () => {
  const speech = sessionNoticeAnnouncement(waitingNotice(true), 2_000);

  assert.equal(speech, undefined);
});

test("a concrete question is announced with the decision itself", () => {
  const speech = sessionNoticeAnnouncement(
    { ...waitingNotice(true), recap: "Should session replay capture screenshots?" },
    2_000,
  );

  assert.deepEqual(speech, {
    providerId: "conductor",
    providerSessionId: "agent-1",
    work: "Notification fix",
    change: SESSION_ANNOUNCEMENT_CHANGE.NEEDS_INPUT,
    detail: "Should session replay capture screenshots?",
    decidedAt: 2_000,
  });
});

test("a permission hold is announced with the action awaiting approval", () => {
  const speech = sessionNoticeAnnouncement(
    {
      ...waitingNotice(true),
      activity: "Bash: pnpm test",
      recap: "Should the test plan cover live audio?",
    },
    2_000,
  );

  assert.equal(speech?.detail, "Bash: pnpm test");
  assert.equal(speech?.change, SESSION_ANNOUNCEMENT_CHANGE.NEEDS_INPUT);
});

test("an error announces the error before recap or activity", () => {
  const speech = sessionNoticeAnnouncement(
    {
      ...waitingNotice(false),
      status: SESSION_NOTICE_STATUS.ERROR,
      activity: "running tests",
      recap: "The test run stopped.",
      error: "Typecheck failed.",
    },
    2_000,
  );

  assert.equal(speech?.change, SESSION_ANNOUNCEMENT_CHANGE.FAILED);
  assert.equal(speech?.detail, "Typecheck failed.");
});

test("a new error remains a failure when the session is still working", () => {
  const speech = sessionAnnouncementFromReview(
    review({
      trigger: ATTENTION_TRIGGER.ERROR_REPORTED,
      status: SESSION_STATUS.WORKING,
      holdingForDeveloper: false,
      context: { activity: "running tests", error: "Typecheck failed." },
    }),
  );

  assert.equal(speech?.change, SESSION_ANNOUNCEMENT_CHANGE.FAILED);
  assert.equal(speech?.detail, "Typecheck failed.");
});

test("an automation wait is an update, not a request for developer input", () => {
  const speech = sessionAnnouncementFromReview(
    review({
      holdingForDeveloper: false,
      recap: "Waiting for the merge queue.",
      context: { activity: "watching CI" },
    }),
  );

  assert.equal(speech?.change, SESSION_ANNOUNCEMENT_CHANGE.UPDATED);
  assert.equal(speech?.detail, "Waiting for the merge queue.");
});

test("only a developer hold with concrete input becomes needs-input", () => {
  const speech = sessionAnnouncementFromReview(
    review({ recap: "Should I run the migration?", context: undefined }),
  );
  const urlOnlyQuestion = sessionAnnouncementFromReview(
    review({ recap: "See https://example.com/run?mode=test", context: undefined }),
  );

  assert.equal(speech?.change, SESSION_ANNOUNCEMENT_CHANGE.NEEDS_INPUT);
  assert.equal(speech?.detail, "Should I run the migration?");
  assert.equal(urlOnlyQuestion, undefined);
});
