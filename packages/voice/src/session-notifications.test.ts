import assert from "node:assert/strict";
import test from "node:test";
import { SESSION_NOTICE_STATUS, SESSION_STATUS, type SessionNotice } from "@sidecar/session";
import { sessionNoticeSpeech } from "./session-notifications.js";

test("a status announcement presents its subject as an agent", () => {
  const notice: SessionNotice = {
    providerId: "codex",
    providerSessionId: "session-a",
    providerName: "Codex",
    title: "checkout",
    status: SESSION_NOTICE_STATUS.COMPLETE,
    previousStatus: SESSION_STATUS.WORKING,
    canReceiveMessage: false,
    observedAt: 1_000,
  };

  const speech = sessionNoticeSpeech(notice, 1_000);

  assert.match(speech.summary, /agent: "checkout"/);
  assert.doesNotMatch(speech.summary, /session: "checkout"/);
});
