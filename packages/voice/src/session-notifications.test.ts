import assert from "node:assert/strict";
import test from "node:test";
import { SESSION_NOTICE_STATUS, SESSION_STATUS, type SessionNotice } from "@sidecar/session";
import { sessionNoticeSpeech } from "./session-notifications.js";

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
  const speech = sessionNoticeSpeech(waitingNotice(false), 2_000);

  assert.equal(speech, undefined);
});

test("a completed status does not bypass the attention evaluator", () => {
  assert.equal(sessionNoticeSpeech(completionNotice(), 2_000), undefined);
});

test("a bare hold does not invent a decision for the developer", () => {
  const speech = sessionNoticeSpeech(waitingNotice(true), 2_000);

  assert.equal(speech, undefined);
});

test("a concrete question is announced with the decision itself", () => {
  const speech = sessionNoticeSpeech(
    { ...waitingNotice(true), recap: "Should session replay capture screenshots?" },
    2_000,
  );

  assert.ok(speech);
  assert.match(speech.summary, /work: "Notification fix"/);
  assert.match(speech.summary, /event: needs a decision to continue/);
  assert.match(speech.summary, /decision: "Should session replay capture screenshots\?"/);
  assert.match(speech.summary, /can take a message now: yes/);
  assert.doesNotMatch(speech.summary, /\bturn\b|\bdeveloper\b/);
});

test("a permission hold is announced with the action awaiting approval", () => {
  const speech = sessionNoticeSpeech(
    {
      ...waitingNotice(true),
      activity: "Bash: pnpm test",
      recap: "Should the test plan cover live audio?",
    },
    2_000,
  );

  assert.ok(speech);
  assert.match(speech.summary, /permission context: "Bash: pnpm test"/);
  assert.doesNotMatch(speech.summary, /test plan cover live audio/);
});
