import assert from "node:assert/strict";
import type { UnparsedWireValue } from "@sidecar/wire";
import { test } from "vitest";
import {
  DEVICE_PLATFORM,
  deviceForgetAnswerSchema,
  deviceForgetRequestSchema,
  deviceHeartbeatAnswerSchema,
  deviceHeartbeatRequestSchema,
  deviceRegisterAnswerSchema,
  deviceRegisterRequestSchema,
  deviceTokenIsStorable,
  isDevicePlatform,
  isDeviceWireId,
  isPushEnvironment,
  PUSH_ENVIRONMENT,
} from "./device-wire.js";

const INSTALLATION_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const DEVICE_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const TOKEN = "ab".repeat(32);

test("a device token is stored only as bounded hex, whichever gateway issued it", () => {
  assert.equal(deviceTokenIsStorable(TOKEN), true);
  assert.equal(deviceTokenIsStorable("ab".repeat(15)), false);
  assert.equal(deviceTokenIsStorable("ab".repeat(257)), false);
  assert.equal(deviceTokenIsStorable("AB".repeat(32)), false);
  assert.equal(deviceTokenIsStorable(`${"ab".repeat(31)}g1`), false);
  assert.equal(isPushEnvironment(PUSH_ENVIRONMENT.SANDBOX), true);
  assert.equal(isPushEnvironment(PUSH_ENVIRONMENT.PRODUCTION), true);
  assert.equal(isPushEnvironment("staging"), false);
});

test("every platform Luke runs on is a device platform, and nothing else is", () => {
  assert.deepEqual(Object.values(DEVICE_PLATFORM).sort(), ["ios", "macos", "watchos"]);
  for (const platform of Object.values(DEVICE_PLATFORM)) {
    assert.equal(isDevicePlatform(platform), true);
  }
  assert.equal(isDevicePlatform("android"), false);
  assert.equal(isDevicePlatform(undefined), false);
});

test("a wire id is the canonical lowercase UUID form", () => {
  assert.equal(isDeviceWireId(INSTALLATION_ID), true);
  assert.equal(isDeviceWireId(INSTALLATION_ID.toUpperCase()), false);
  assert.equal(isDeviceWireId(INSTALLATION_ID.replace(/-/gu, "")), false);
  assert.equal(isDeviceWireId("not-an-id"), false);
});

test("a registration names a platform and an installation, with an optional paired push token", () => {
  assert.deepEqual(
    deviceRegisterRequestSchema.parse({
      platform: DEVICE_PLATFORM.MACOS,
      installationId: INSTALLATION_ID.toUpperCase(),
    }),
    { platform: DEVICE_PLATFORM.MACOS, installationId: INSTALLATION_ID },
  );
  assert.deepEqual(
    deviceRegisterRequestSchema.parse({
      platform: DEVICE_PLATFORM.IOS,
      installationId: INSTALLATION_ID,
      pushToken: TOKEN.toUpperCase(),
      pushEnvironment: PUSH_ENVIRONMENT.SANDBOX,
    }),
    {
      platform: DEVICE_PLATFORM.IOS,
      installationId: INSTALLATION_ID,
      pushToken: TOKEN,
      pushEnvironment: PUSH_ENVIRONMENT.SANDBOX,
    },
  );
  const refused: UnparsedWireValue[] = [
    { platform: "android", installationId: INSTALLATION_ID },
    { platform: DEVICE_PLATFORM.IOS, installationId: "device-1" },
    { platform: DEVICE_PLATFORM.IOS },
    { platform: DEVICE_PLATFORM.IOS, installationId: INSTALLATION_ID, pushToken: TOKEN },
    {
      platform: DEVICE_PLATFORM.IOS,
      installationId: INSTALLATION_ID,
      pushEnvironment: PUSH_ENVIRONMENT.SANDBOX,
    },
    {
      platform: DEVICE_PLATFORM.IOS,
      installationId: INSTALLATION_ID,
      pushToken: "short",
      pushEnvironment: PUSH_ENVIRONMENT.SANDBOX,
    },
    { platform: DEVICE_PLATFORM.IOS, installationId: INSTALLATION_ID, extra: true },
    "register",
  ];
  for (const body of refused) {
    assert.equal(deviceRegisterRequestSchema.parse(body), undefined, JSON.stringify(body));
  }
});

test("a heartbeat names the device and carries only the changes it means", () => {
  assert.deepEqual(deviceHeartbeatRequestSchema.parse({ deviceId: DEVICE_ID }), {
    deviceId: DEVICE_ID,
  });
  assert.deepEqual(
    deviceHeartbeatRequestSchema.parse({ deviceId: DEVICE_ID, activeUntil: 1_800_000_000_000 }),
    { deviceId: DEVICE_ID, activeUntil: 1_800_000_000_000 },
  );
  assert.deepEqual(
    deviceHeartbeatRequestSchema.parse({
      deviceId: DEVICE_ID,
      pushToken: TOKEN,
      pushEnvironment: PUSH_ENVIRONMENT.PRODUCTION,
    }),
    { deviceId: DEVICE_ID, pushToken: TOKEN, pushEnvironment: PUSH_ENVIRONMENT.PRODUCTION },
  );
  assert.deepEqual(deviceHeartbeatRequestSchema.parse({ deviceId: DEVICE_ID, pushToken: null }), {
    deviceId: DEVICE_ID,
    pushToken: null,
  });
  const refused: UnparsedWireValue[] = [
    { deviceId: "nope" },
    { deviceId: DEVICE_ID, activeUntil: -1 },
    { deviceId: DEVICE_ID, activeUntil: 1.5 },
    { deviceId: DEVICE_ID, activeUntil: "soon" },
    { deviceId: DEVICE_ID, pushToken: TOKEN },
    { deviceId: DEVICE_ID, pushToken: null, pushEnvironment: PUSH_ENVIRONMENT.SANDBOX },
    { deviceId: DEVICE_ID, pushEnvironment: PUSH_ENVIRONMENT.SANDBOX },
    {},
  ];
  for (const body of refused) {
    assert.equal(deviceHeartbeatRequestSchema.parse(body), undefined, JSON.stringify(body));
  }
});

test("a forget names the device and nothing else", () => {
  assert.deepEqual(deviceForgetRequestSchema.parse({ deviceId: DEVICE_ID }), {
    deviceId: DEVICE_ID,
  });
  assert.equal(deviceForgetRequestSchema.parse({ deviceId: DEVICE_ID, force: true }), undefined);
  assert.equal(deviceForgetRequestSchema.parse({}), undefined);
});

test("device answers read only their documented shapes", () => {
  assert.deepEqual(deviceRegisterAnswerSchema.parse({ deviceId: DEVICE_ID, extra: 1 }), {
    deviceId: DEVICE_ID,
  });
  assert.equal(deviceRegisterAnswerSchema.parse({ deviceId: "row-1" }), undefined);
  assert.equal(deviceRegisterAnswerSchema.parse({ stored: true }), undefined);
  assert.deepEqual(deviceHeartbeatAnswerSchema.parse({ seen: false }), { seen: false });
  assert.equal(deviceHeartbeatAnswerSchema.parse({ seen: "yes" }), undefined);
  assert.deepEqual(deviceForgetAnswerSchema.parse({ deleted: true }), { deleted: true });
  assert.equal(deviceForgetAnswerSchema.parse("deleted"), undefined);
});
