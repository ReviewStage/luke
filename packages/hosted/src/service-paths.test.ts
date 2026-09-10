import assert from "node:assert/strict";
import test from "node:test";
import {
  HOSTED_SERVICE_PATH,
  VOICE_SERVICE_PATH,
  VOICE_SERVICE_SECRET_HEADER,
} from "./service-paths.js";

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

test("the voice service's internal routes sit under one internal prefix", () => {
  assert.equal(HOSTED_SERVICE_PATH.VOICE_AUTHORIZE, "/api/internal/voice/authorize");
  assert.equal(HOSTED_SERVICE_PATH.VOICE_USAGE, "/api/internal/voice/usage");
  assert.notEqual(HOSTED_SERVICE_PATH.VOICE_AUTHORIZE, HOSTED_SERVICE_PATH.VOICE_USAGE);
});

test("the voice service's own paths are two distinct upgrades", () => {
  assert.deepEqual(Object.values(VOICE_SERVICE_PATH), ["/sessions", "/introduction"]);
  assert.equal(new Set(Object.values(VOICE_SERVICE_PATH)).size, 2);
});

test("the service secret travels in a header of its own, lowercase as HTTP/2 carries it", () => {
  assert.equal(VOICE_SERVICE_SECRET_HEADER, VOICE_SERVICE_SECRET_HEADER.toLowerCase());
  assert.notEqual(VOICE_SERVICE_SECRET_HEADER, "authorization");
});
