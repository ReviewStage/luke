import assert from "node:assert/strict";
import test from "node:test";
import {
  DEVICE_PLATFORM,
  deviceTokenDeleteAnswerSchema,
  deviceTokenIsStorable,
  deviceTokenStoreAnswerSchema,
  isDevicePlatform,
  isPushEnvironment,
  PUSH_ENVIRONMENT,
} from "./device-wire.js";

test("a device token is stored only as bounded hex, whichever gateway issued it", () => {
  assert.equal(deviceTokenIsStorable("ab".repeat(32)), true);
  assert.equal(deviceTokenIsStorable("ab".repeat(15)), false);
  assert.equal(deviceTokenIsStorable("ab".repeat(257)), false);
  assert.equal(deviceTokenIsStorable("AB".repeat(32)), false);
  assert.equal(deviceTokenIsStorable(`${"ab".repeat(31)}g1`), false);
  assert.equal(isDevicePlatform(DEVICE_PLATFORM.IOS), true);
  assert.equal(isDevicePlatform("android"), false);
  assert.equal(isPushEnvironment(PUSH_ENVIRONMENT.SANDBOX), true);
  assert.equal(isPushEnvironment(PUSH_ENVIRONMENT.PRODUCTION), true);
  assert.equal(isPushEnvironment("staging"), false);
});

test("device registration answers read only their documented shapes", () => {
  assert.deepEqual(deviceTokenStoreAnswerSchema.parse({ stored: true }), { stored: true });
  assert.equal(deviceTokenStoreAnswerSchema.parse({ stored: false }), undefined);
  assert.equal(deviceTokenStoreAnswerSchema.parse("stored"), undefined);
  assert.deepEqual(deviceTokenDeleteAnswerSchema.parse({ deleted: false }), { deleted: false });
  assert.equal(deviceTokenDeleteAnswerSchema.parse({ deleted: "yes" }), undefined);
});
