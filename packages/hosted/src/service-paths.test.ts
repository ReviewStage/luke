import assert from "node:assert/strict";
import { test } from "vitest";
import { brainTurnEventsPath, HOSTED_SERVICE_PATH, VOICE_SERVICE_PATH } from "./service-paths.js";

test("the introduction mint has its own path beside the ordinary one", () => {
  assert.equal(HOSTED_SERVICE_PATH.INTRODUCTION_MINT, "/api/voice/introduction-mint");
  assert.notEqual(HOSTED_SERVICE_PATH.INTRODUCTION_MINT, HOSTED_SERVICE_PATH.VOICE_MINT);
});

test("account preferences have a stable endpoint path", () => {
  assert.equal(HOSTED_SERVICE_PATH.ACCOUNT_PREFERENCES, "/api/account/preferences");
});

test("the device registration has a stable endpoint path", () => {
  assert.equal(HOSTED_SERVICE_PATH.DEVICES, "/api/devices");
});

test("Clear stands beside the Conversation's reads under the same prefix", () => {
  assert.equal(HOSTED_SERVICE_PATH.CONVERSATION_CLEAR, "/api/conversation/clear");
  assert.notEqual(
    HOSTED_SERVICE_PATH.CONVERSATION_CLEAR,
    HOSTED_SERVICE_PATH.CONVERSATION_MESSAGES,
  );
});

test("the voice service's paths are two distinct function routes of the service", () => {
  assert.deepEqual(Object.values(VOICE_SERVICE_PATH), [
    "/api/voice/sessions",
    "/api/voice/introduction",
  ]);
  assert.equal(new Set(Object.values(VOICE_SERVICE_PATH)).size, 2);
  const taken = new Set<string>(Object.values(HOSTED_SERVICE_PATH));
  for (const path of Object.values(VOICE_SERVICE_PATH)) assert.equal(taken.has(path), false);
});

test("a turn's event stream stands under the turns read, with the id inside the path", () => {
  const turnId = "1a000000-0000-4000-8000-000000000003";
  assert.equal(brainTurnEventsPath(turnId), `${HOSTED_SERVICE_PATH.BRAIN_TURNS}/${turnId}/events`);
  assert.equal(brainTurnEventsPath("a/b"), `${HOSTED_SERVICE_PATH.BRAIN_TURNS}/a%2Fb/events`);
});
