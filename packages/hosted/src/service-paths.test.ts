import assert from "node:assert/strict";
import test from "node:test";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";

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
