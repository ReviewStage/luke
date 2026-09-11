import assert from "node:assert/strict";
import { DEVICE_PLATFORM, PUSH_ENVIRONMENT } from "@sidecar/hosted";
import { test } from "vitest";
import type { DeviceHeartbeat, DeviceRegistration } from "../server/hosted/devices";
import { handleDevices } from "../server/hosted/devices";
import { HOSTED_API_ERROR } from "../server/hosted/http";

const INSTALLATION_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const DEVICE_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const TOKEN = "0a".repeat(32);
const NOON = Date.parse("2026-09-09T12:00:00.000Z");

/** A request body as a test composes it: every field the wire takes, and the wrong kinds beside them. */
type Body = Record<string, string | number | null>;

function request(method: string, body?: Body): Request {
  return new Request("https://luke.test/api/devices", {
    method,
    headers: { authorization: "Bearer token-1", "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

type Options = Parameters<typeof handleDevices>[0];

interface Recorded {
  registrations: { userId: string; registration: DeviceRegistration; now: Date }[];
  heartbeats: { userId: string; heartbeat: DeviceHeartbeat; now: Date }[];
  forgets: { userId: string; deviceId: string }[];
}

function options(overrides: Partial<Options> = {}) {
  const recorded: Recorded = { registrations: [], heartbeats: [], forgets: [] };
  const base: Options = {
    request: request("POST", { platform: DEVICE_PLATFORM.MACOS, installationId: INSTALLATION_ID }),
    resolveUserId: async () => "user-1",
    now: () => NOON,
    mintId: () => DEVICE_ID,
    registerDevice: async (userId, registration, mintId, now) => {
      recorded.registrations.push({ userId, registration, now });
      return { deviceId: mintId() };
    },
    touchDevice: async (userId, heartbeat, now) => {
      recorded.heartbeats.push({ userId, heartbeat, now });
      return true;
    },
    forgetDevice: async (userId, deviceId) => {
      recorded.forgets.push({ userId, deviceId });
      return true;
    },
    ...overrides,
  };
  return { options: base, recorded };
}

test("the gate order is method, bearer, body, and every refusal is one shape", async () => {
  const wrongMethod = await handleDevices(options({ request: request("GET") }).options);
  assert.equal(wrongMethod.status, 405);
  assert.equal((await wrongMethod.json()).error, HOSTED_API_ERROR.METHOD_NOT_ALLOWED);

  const anonymous = await handleDevices(options({ resolveUserId: async () => undefined }).options);
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error, HOSTED_API_ERROR.INVALID_TOKEN);

  for (const method of ["POST", "PUT", "DELETE"]) {
    const { options: noBody, recorded } = options({ request: request(method) });
    const response = await handleDevices(noBody);
    assert.equal(response.status, 400, method);
    assert.equal((await response.json()).error, HOSTED_API_ERROR.INVALID_REQUEST);
    assert.equal(
      recorded.registrations.length + recorded.heartbeats.length + recorded.forgets.length,
      0,
    );
  }
});

test("a registration is upserted for the bearer's account and answers the row's id", async () => {
  const { options: registering, recorded } = options({
    request: request("POST", {
      platform: DEVICE_PLATFORM.IOS,
      installationId: INSTALLATION_ID.toUpperCase(),
      pushToken: TOKEN.toUpperCase(),
      pushEnvironment: PUSH_ENVIRONMENT.SANDBOX,
    }),
  });
  const response = await handleDevices(registering);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { deviceId: DEVICE_ID });
  assert.deepEqual(recorded.registrations, [
    {
      userId: "user-1",
      registration: {
        installationId: INSTALLATION_ID,
        platform: DEVICE_PLATFORM.IOS,
        push: { token: TOKEN, environment: PUSH_ENVIRONMENT.SANDBOX },
      },
      now: new Date(NOON),
    },
  ]);
});

test("a registration without a push token carries none, on every platform", async () => {
  for (const platform of Object.values(DEVICE_PLATFORM)) {
    const { options: registering, recorded } = options({
      request: request("POST", { platform, installationId: INSTALLATION_ID }),
    });
    assert.equal((await handleDevices(registering)).status, 200);
    assert.deepEqual(recorded.registrations[0]?.registration, {
      installationId: INSTALLATION_ID,
      platform,
      push: undefined,
    });
  }
});

test("a registration outside the contract is refused before anything is stored", async () => {
  const bodies: Body[] = [
    { platform: "android", installationId: INSTALLATION_ID },
    { platform: DEVICE_PLATFORM.IOS, installationId: "phone-1" },
    { platform: DEVICE_PLATFORM.IOS, installationId: INSTALLATION_ID, pushToken: TOKEN },
    {
      platform: DEVICE_PLATFORM.IOS,
      installationId: INSTALLATION_ID,
      pushToken: "short",
      pushEnvironment: PUSH_ENVIRONMENT.SANDBOX,
    },
    {
      platform: DEVICE_PLATFORM.IOS,
      installationId: INSTALLATION_ID,
      pushToken: TOKEN,
      pushEnvironment: "staging",
    },
    { installationId: INSTALLATION_ID },
    { platform: DEVICE_PLATFORM.MACOS, installationId: INSTALLATION_ID, deviceId: DEVICE_ID },
  ];
  for (const body of bodies) {
    const { options: refused, recorded } = options({ request: request("POST", body) });
    const response = await handleDevices(refused);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal((await response.json()).error, HOSTED_API_ERROR.INVALID_REQUEST);
    assert.equal(recorded.registrations.length, 0);
  }
});

test("a heartbeat moves last seen and carries only the changes it named", async () => {
  const bare = options({ request: request("PUT", { deviceId: DEVICE_ID }) });
  assert.deepEqual(await (await handleDevices(bare.options)).json(), { seen: true });
  assert.deepEqual(bare.recorded.heartbeats, [
    {
      userId: "user-1",
      heartbeat: { deviceId: DEVICE_ID, activeUntil: undefined, push: undefined },
      now: new Date(NOON),
    },
  ]);

  const present = options({
    request: request("PUT", { deviceId: DEVICE_ID, activeUntil: NOON + 120_000 }),
  });
  await handleDevices(present.options);
  assert.deepEqual(present.recorded.heartbeats[0]?.heartbeat, {
    deviceId: DEVICE_ID,
    activeUntil: new Date(NOON + 120_000),
    push: undefined,
  });

  const retokened = options({
    request: request("PUT", {
      deviceId: DEVICE_ID,
      pushToken: TOKEN,
      pushEnvironment: PUSH_ENVIRONMENT.PRODUCTION,
    }),
  });
  await handleDevices(retokened.options);
  assert.deepEqual(retokened.recorded.heartbeats[0]?.heartbeat.push, {
    token: TOKEN,
    environment: PUSH_ENVIRONMENT.PRODUCTION,
  });

  const cleared = options({ request: request("PUT", { deviceId: DEVICE_ID, pushToken: null }) });
  await handleDevices(cleared.options);
  assert.equal(cleared.recorded.heartbeats[0]?.heartbeat.push, null);
});

test("a heartbeat for a row the account does not hold answers unseen", async () => {
  const { options: unknown } = options({
    request: request("PUT", { deviceId: DEVICE_ID }),
    touchDevice: async () => false,
  });
  const response = await handleDevices(unknown);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { seen: false });
});

test("a heartbeat outside the contract is refused before anything moves", async () => {
  const bodies: Body[] = [
    { deviceId: "row-1" },
    { deviceId: DEVICE_ID, activeUntil: -1 },
    { deviceId: DEVICE_ID, pushToken: TOKEN },
    { deviceId: DEVICE_ID, pushToken: null, pushEnvironment: PUSH_ENVIRONMENT.SANDBOX },
    { installationId: INSTALLATION_ID },
  ];
  for (const body of bodies) {
    const { options: refused, recorded } = options({ request: request("PUT", body) });
    assert.equal((await handleDevices(refused)).status, 400, JSON.stringify(body));
    assert.equal(recorded.heartbeats.length, 0);
  }
});

test("a forget is scoped to the bearer's account and answers whether a row went", async () => {
  const { options: forgetting, recorded } = options({
    request: request("DELETE", { deviceId: DEVICE_ID.toUpperCase() }),
  });
  const gone = await handleDevices(forgetting);
  assert.equal(gone.status, 200);
  assert.deepEqual(await gone.json(), { deleted: true });
  assert.deepEqual(recorded.forgets, [{ userId: "user-1", deviceId: DEVICE_ID }]);

  const absent = await handleDevices(
    options({
      request: request("DELETE", { deviceId: DEVICE_ID }),
      forgetDevice: async () => false,
    }).options,
  );
  assert.deepEqual(await absent.json(), { deleted: false });

  const malformed = await handleDevices(
    options({ request: request("DELETE", { installationId: INSTALLATION_ID }) }).options,
  );
  assert.equal(malformed.status, 400);
});

test("a hammering account is braked to a trickle without reaching a seam", async () => {
  let brakedAt: number | undefined;
  for (let call = 0; call < 200; call += 1) {
    const { options: heartbeat, recorded } = options({
      request: request("PUT", { deviceId: DEVICE_ID }),
      resolveUserId: async () => "user-braked",
    });
    const response = await handleDevices(heartbeat);
    if (response.status === 429) {
      assert.equal((await response.json()).error, HOSTED_API_ERROR.QUOTA_EXHAUSTED);
      assert.equal(recorded.heartbeats.length, 0);
      brakedAt = call;
      break;
    }
    assert.equal(response.status, 200);
  }
  assert.equal(brakedAt, 60);
});
