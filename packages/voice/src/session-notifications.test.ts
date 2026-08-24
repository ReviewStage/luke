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
    status: SESSION_NOTICE_STATUS.WAITING,
    previousStatus: SESSION_STATUS.WORKING,
    holdingForDeveloper,
    recap: "Updated the notification behavior.",
    canReceiveMessage: true,
    observedAt: 1_000,
  };
}

test("a finished turn is not presented as needing the developer", () => {
  const speech = sessionNoticeSpeech(waitingNotice(false), 2_000);

  assert.match(speech.summary, /event: finished its turn/);
  assert.doesNotMatch(speech.summary, /needs the developer/);
});

test("a genuine hold says that the agent needs the developer", () => {
  const speech = sessionNoticeSpeech(waitingNotice(true), 2_000);

  assert.match(speech.summary, /event: needs the developer to continue/);
});
