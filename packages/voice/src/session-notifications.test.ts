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
    lastActivityAt: 1_000,
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
    repository: "luke",
    branch: "charleslpan/jarvis-like-voice",
    canReceiveMessage: true,
    lastActivityAt: 1_000,
  };
}

function completionNotice(): SessionNotice {
  const notice = waitingNotice(false);
  return {
    ...notice,
    status: SESSION_NOTICE_STATUS.COMPLETE,
  };
}

test("a waiting session with no reported hold is not announced", () => {
  // A Conductor chat reports idle and nothing about why, so its notice never
  // claims the developer and the deterministic path stays silent; the
  // attention evaluator is the one thing that may still decide to speak.
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

test("the title never reaches an announcement", () => {
  const notice = { ...waitingNotice(true), activity: "Bash: pnpm test" };
  const unnamed = sessionNoticeAnnouncement(notice, 2_000);
  assert.equal(unnamed?.subject, undefined);
  assert.doesNotMatch(JSON.stringify(unnamed), /Notification fix/);
});

test("a permission hold is announced with the action awaiting approval", () => {
  const speech = sessionNoticeAnnouncement(
    { ...waitingNotice(true), activity: "Bash:  pnpm\ntest" },
    2_000,
  );

  assert.deepEqual(speech, {
    providerId: "conductor",
    providerSessionId: "agent-1",
    change: SESSION_ANNOUNCEMENT_CHANGE.NEEDS_INPUT,
    detail: "Bash: pnpm test",
    decidedAt: 2_000,
  });
});

test("an error announces the error before activity", () => {
  const speech = sessionNoticeAnnouncement(
    {
      ...waitingNotice(false),
      status: SESSION_NOTICE_STATUS.ERROR,
      activity: "running tests",
      error: "Typecheck failed.",
    },
    2_000,
  );

  assert.equal(speech?.change, SESSION_ANNOUNCEMENT_CHANGE.FAILED);
  assert.equal(speech?.detail, "Typecheck failed.");
});

test("an error with no message still announces, naming what was running", () => {
  const speech = sessionNoticeAnnouncement(
    { ...waitingNotice(false), status: SESSION_NOTICE_STATUS.ERROR, activity: "running tests" },
    2_000,
  );

  assert.equal(speech?.change, SESSION_ANNOUNCEMENT_CHANGE.FAILED);
  assert.equal(speech?.detail, "running tests");
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
    review({ holdingForDeveloper: false, context: { activity: "watching CI" } }),
  );

  assert.equal(speech?.change, SESSION_ANNOUNCEMENT_CHANGE.UPDATED);
  assert.equal(speech?.detail, "watching CI");
});

test("only a developer hold with a concrete action becomes needs-input", () => {
  const speech = sessionAnnouncementFromReview(
    review({ context: { activity: "Approve running the migration" } }),
  );
  const bareHold = sessionAnnouncementFromReview(review({ context: undefined }));

  assert.equal(speech?.change, SESSION_ANNOUNCEMENT_CHANGE.NEEDS_INPUT);
  assert.equal(speech?.detail, "Approve running the migration");
  assert.equal(bareHold, undefined);
});

test("a finished turn announces with no detail rather than a scrape of the last message", () => {
  const speech = sessionAnnouncementFromReview(
    review({ status: SESSION_STATUS.COMPLETE, holdingForDeveloper: false, context: undefined }),
  );

  assert.deepEqual(speech, {
    providerId: "claude-code",
    providerSessionId: "session-a",
    change: SESSION_ANNOUNCEMENT_CHANGE.FINISHED,
    decidedAt: 2_000,
  });
});

test("a review's announcement never carries the title", () => {
  const speech = sessionAnnouncementFromReview(
    review({ context: { activity: "Approve running the migration" } }),
  );
  assert.equal(speech?.subject, undefined);
  assert.doesNotMatch(JSON.stringify(speech), /Checkout service/);
});
