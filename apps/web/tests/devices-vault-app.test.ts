import assert from "node:assert/strict";
import path from "node:path";
import { DEVICE_PLATFORM, PUSH_ENVIRONMENT } from "@sidecar/hosted";
import { CLOUD_AGENT_PROVIDER_ID } from "@sidecar/session";
import { afterEach, beforeEach, test, vi } from "vitest";
import { type DevicesVaultSeams, devicesVaultApp } from "../server/devices-vault-app.js";
import type { DeviceHeartbeat, DeviceRegistration } from "../server/hosted/devices.js";
import { decryptProviderKey } from "../server/hosted/encryption.js";
import { HOSTED_API_ERROR } from "../server/hosted/http.js";
import { routeFromHttpApp } from "../server/route-effect.js";
import { disposeWebRuntime } from "../server/runtime.js";
import {
  recordedGoldenNames,
  recordedResponse,
  settleResponseGolden,
} from "./support/response-golden.js";

/**
 * The group answers what the promise-shaped `handleDevices` and
 * `handleVaultKey*` answered before the conversion: the same gate order
 * (method, bearer, brake or secret, body), the same validation, and the same
 * bytes. `fixtures/devices-vault-route/` pins a representative exchange on
 * each of the three paths, and every other test here exercises the group's
 * behavior directly.
 */

const PLACEHOLDER_DATABASE_URL = "postgresql://route:effect@127.0.0.1:5432/luke";

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", PLACEHOLDER_DATABASE_URL);
});

afterEach(async () => {
  await disposeWebRuntime();
  vi.unstubAllEnvs();
});

const INSTALLATION_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const DEVICE_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const TOKEN = "0a".repeat(32);
const NOON = Date.parse("2026-09-09T12:00:00.000Z");
const SECRET = "a".repeat(64);
const NOW_DATE = new Date("2026-08-28T00:00:00.000Z");

type Body = Record<string, string | number | null>;

function devicesRequest(method: string, body?: Body, userId = "user-1"): Request {
  const init: RequestInit = {
    method,
    headers: { authorization: `Bearer ${userId}`, "content-type": "application/json" },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request("https://luke.test/api/devices", init);
}

function vaultKeyRequest(method: string, body?: Body): Request {
  const init: RequestInit = {
    method,
    headers: { authorization: "Bearer user-1", "content-type": "application/json" },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request("https://luke.test/api/vault/key", init);
}

function vaultKeysRequest(method = "GET"): Request {
  return new Request("https://luke.test/api/vault/keys", {
    method,
    headers: { authorization: "Bearer user-1" },
  });
}

interface Recorded {
  registrations: { userId: string; registration: DeviceRegistration; now: Date }[];
  heartbeats: { userId: string; heartbeat: DeviceHeartbeat; now: Date }[];
  forgets: { userId: string; deviceId: string }[];
  stores: { userId: string; providerId: string; ciphertext: string }[];
  deletes: { userId: string; providerId: string }[];
}

function seamsFor(overrides: Partial<DevicesVaultSeams> = {}) {
  const recorded: Recorded = {
    registrations: [],
    heartbeats: [],
    forgets: [],
    stores: [],
    deletes: [],
  };
  const seams: DevicesVaultSeams = {
    resolveUserId: async (authorization) => authorization?.replace("Bearer ", "") || undefined,
    encryptionSecret: SECRET,
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
    storeKey: async (userId, providerId, ciphertext) => {
      recorded.stores.push({ userId, providerId, ciphertext });
    },
    listKeys: async () => [{ providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR, updatedAt: NOW_DATE }],
    deleteKey: async (userId, providerId) => {
      recorded.deletes.push({ userId, providerId });
      return true;
    },
    ...overrides,
  };
  return { seams, recorded };
}

function route(seams: DevicesVaultSeams) {
  return routeFromHttpApp(devicesVaultApp(seams));
}

// --- Devices: gate order and validation ---

test("the devices gate order is method, bearer, brake, and every refusal is one shape", async () => {
  const { seams } = seamsFor();

  const wrongMethod = await route(seams).fetch(devicesRequest("GET"));
  assert.equal(wrongMethod.status, 405);
  assert.equal((await wrongMethod.json()).error, HOSTED_API_ERROR.METHOD_NOT_ALLOWED);

  const anonymous = await route(seamsFor({ resolveUserId: async () => undefined }).seams).fetch(
    devicesRequest("POST"),
  );
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error, HOSTED_API_ERROR.INVALID_TOKEN);

  for (const method of ["POST", "PUT", "DELETE"]) {
    const { seams: noBody, recorded } = seamsFor();
    const response = await route(noBody).fetch(devicesRequest(method));
    assert.equal(response.status, 400, method);
    assert.equal((await response.json()).error, HOSTED_API_ERROR.INVALID_REQUEST);
    assert.equal(
      recorded.registrations.length + recorded.heartbeats.length + recorded.forgets.length,
      0,
    );
  }
});

test("a registration is upserted for the bearer's account and answers the row's id", async () => {
  const { seams, recorded } = seamsFor();
  const response = await route(seams).fetch(
    devicesRequest("POST", {
      platform: DEVICE_PLATFORM.IOS,
      installationId: INSTALLATION_ID.toUpperCase(),
      pushToken: TOKEN.toUpperCase(),
      pushEnvironment: PUSH_ENVIRONMENT.SANDBOX,
    }),
  );

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
    const { seams, recorded } = seamsFor();
    const response = await route(seams).fetch(
      devicesRequest("POST", { platform, installationId: INSTALLATION_ID }),
    );
    assert.equal(response.status, 200);
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
    const { seams, recorded } = seamsFor();
    const response = await route(seams).fetch(devicesRequest("POST", body));
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal((await response.json()).error, HOSTED_API_ERROR.INVALID_REQUEST);
    assert.equal(recorded.registrations.length, 0);
  }
});

test("a heartbeat moves last seen and carries only the changes it named", async () => {
  const bare = seamsFor();
  assert.deepEqual(
    await (await route(bare.seams).fetch(devicesRequest("PUT", { deviceId: DEVICE_ID }))).json(),
    {
      seen: true,
    },
  );
  assert.deepEqual(bare.recorded.heartbeats, [
    {
      userId: "user-1",
      heartbeat: { deviceId: DEVICE_ID, activeUntil: undefined, push: undefined },
      now: new Date(NOON),
    },
  ]);

  const present = seamsFor();
  await route(present.seams).fetch(
    devicesRequest("PUT", { deviceId: DEVICE_ID, activeUntil: NOON + 120_000 }),
  );
  assert.deepEqual(present.recorded.heartbeats[0]?.heartbeat, {
    deviceId: DEVICE_ID,
    activeUntil: new Date(NOON + 120_000),
    push: undefined,
  });

  const retokened = seamsFor();
  await route(retokened.seams).fetch(
    devicesRequest("PUT", {
      deviceId: DEVICE_ID,
      pushToken: TOKEN,
      pushEnvironment: PUSH_ENVIRONMENT.PRODUCTION,
    }),
  );
  assert.deepEqual(retokened.recorded.heartbeats[0]?.heartbeat.push, {
    token: TOKEN,
    environment: PUSH_ENVIRONMENT.PRODUCTION,
  });

  const cleared = seamsFor();
  await route(cleared.seams).fetch(devicesRequest("PUT", { deviceId: DEVICE_ID, pushToken: null }));
  assert.equal(cleared.recorded.heartbeats[0]?.heartbeat.push, null);
});

test("a heartbeat for a row the account does not hold answers unseen", async () => {
  const { seams } = seamsFor({ touchDevice: async () => false });
  const response = await route(seams).fetch(devicesRequest("PUT", { deviceId: DEVICE_ID }));
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
    const { seams, recorded } = seamsFor();
    assert.equal(
      (await route(seams).fetch(devicesRequest("PUT", body))).status,
      400,
      JSON.stringify(body),
    );
    assert.equal(recorded.heartbeats.length, 0);
  }
});

test("a forget is scoped to the bearer's account and answers whether a row went", async () => {
  const { seams, recorded } = seamsFor();
  const gone = await route(seams).fetch(
    devicesRequest("DELETE", { deviceId: DEVICE_ID.toUpperCase() }),
  );
  assert.equal(gone.status, 200);
  assert.deepEqual(await gone.json(), { deleted: true });
  assert.deepEqual(recorded.forgets, [{ userId: "user-1", deviceId: DEVICE_ID }]);

  const absent = await route(seamsFor({ forgetDevice: async () => false }).seams).fetch(
    devicesRequest("DELETE", { deviceId: DEVICE_ID }),
  );
  assert.deepEqual(await absent.json(), { deleted: false });

  const malformed = await route(seamsFor().seams).fetch(
    devicesRequest("DELETE", { installationId: INSTALLATION_ID }),
  );
  assert.equal(malformed.status, 400);
});

test("a hammering account is braked to a trickle without reaching a seam", async () => {
  let brakedAt: number | undefined;
  for (let call = 0; call < 200; call += 1) {
    const { seams, recorded } = seamsFor({ resolveUserId: async () => "user-braked" });
    const response = await route(seams).fetch(devicesRequest("PUT", { deviceId: DEVICE_ID }));
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

// --- Vault key: store and delete ---

function vaultStoreOptions(overrides: Partial<DevicesVaultSeams> = {}) {
  return seamsFor(overrides).seams;
}

test("the vault store gate order is method, secret, token, body", async () => {
  const wrongMethod = await route(vaultStoreOptions()).fetch(vaultKeyRequest("GET"));
  assert.equal(wrongMethod.status, 405);

  const noSecret = await route(vaultStoreOptions({ encryptionSecret: undefined })).fetch(
    vaultKeyRequest("POST", { providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR, key: "sk-abc1234" }),
  );
  assert.equal(noSecret.status, 503);
  assert.equal((await noSecret.json()).error, HOSTED_API_ERROR.UNAVAILABLE);

  const blankSecret = await route(vaultStoreOptions({ encryptionSecret: "   " })).fetch(
    vaultKeyRequest("POST", { providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR, key: "sk-abc1234" }),
  );
  assert.equal(blankSecret.status, 503);

  const anonymous = await route(vaultStoreOptions({ resolveUserId: async () => undefined })).fetch(
    vaultKeyRequest("POST", { providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR, key: "sk-abc1234" }),
  );
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error, HOSTED_API_ERROR.INVALID_TOKEN);

  const noBody = await route(vaultStoreOptions()).fetch(
    new Request("https://luke.test/api/vault/key", {
      method: "POST",
      headers: { authorization: "Bearer t" },
    }),
  );
  assert.equal(noBody.status, 400);
  assert.equal((await noBody.json()).error, HOSTED_API_ERROR.INVALID_REQUEST);
});

test("storing a valid key answers { stored: true } and writes an encrypted ciphertext", async () => {
  const { seams, recorded } = seamsFor();
  const response = await route(seams).fetch(
    vaultKeyRequest("POST", { providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR, key: "sk-abc1234" }),
  );

  assert.equal(response.status, 200);
  assert.equal((await response.json()).stored, true);
  const stored = recorded.stores.at(0);
  assert.ok(stored);
  assert.equal(stored.userId, "user-1");
  assert.equal(stored.providerId, CLOUD_AGENT_PROVIDER_ID.CONDUCTOR);
  assert.notEqual(stored.ciphertext, "sk-abc1234");
  assert.equal(decryptProviderKey(stored.ciphertext, SECRET), "sk-abc1234");
});

test("an unknown provider id is refused", async () => {
  const response = await route(vaultStoreOptions()).fetch(
    vaultKeyRequest("POST", { providerId: "not-a-provider", key: "sk-abc" }),
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, HOSTED_API_ERROR.INVALID_REQUEST);
});

test("a key with internal whitespace is refused", async () => {
  const response = await route(vaultStoreOptions()).fetch(
    vaultKeyRequest("POST", { providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR, key: "sk ab cd" }),
  );
  assert.equal(response.status, 400);
});

test("an empty key is refused", async () => {
  const response = await route(vaultStoreOptions()).fetch(
    vaultKeyRequest("POST", { providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR, key: "" }),
  );
  assert.equal(response.status, 400);
});

test("a key longer than 512 characters is refused", async () => {
  const response = await route(vaultStoreOptions()).fetch(
    vaultKeyRequest("POST", {
      providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR,
      key: "k".repeat(513),
    }),
  );
  assert.equal(response.status, 400);
});

test("storing again for the same provider replaces the previous entry (upsert)", async () => {
  const { seams, recorded } = seamsFor();

  await route(seams).fetch(
    vaultKeyRequest("POST", {
      providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR,
      key: "first-key-0001",
    }),
  );
  await route(seams).fetch(
    vaultKeyRequest("POST", {
      providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR,
      key: "second-key-9999",
    }),
  );

  assert.equal(recorded.stores.length, 2);
  const [first, second] = recorded.stores;
  assert.ok(first && second);
  assert.notEqual(first.ciphertext, second.ciphertext);
  assert.equal(decryptProviderKey(first.ciphertext, SECRET), "first-key-0001");
  assert.equal(decryptProviderKey(second.ciphertext, SECRET), "second-key-9999");
});

test("the delete gate order is method, secret, token, body", async () => {
  const noSecret = await route(vaultStoreOptions({ encryptionSecret: undefined })).fetch(
    vaultKeyRequest("DELETE", { providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR }),
  );
  assert.equal(noSecret.status, 503);

  const anonymous = await route(vaultStoreOptions({ resolveUserId: async () => undefined })).fetch(
    vaultKeyRequest("DELETE", { providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR }),
  );
  assert.equal(anonymous.status, 401);

  const unknownProvider = await route(vaultStoreOptions()).fetch(
    vaultKeyRequest("DELETE", { providerId: "not-a-provider" }),
  );
  assert.equal(unknownProvider.status, 400);
  assert.equal((await unknownProvider.json()).error, HOSTED_API_ERROR.INVALID_REQUEST);
});

test("deleting an existing key answers { deleted: true }", async () => {
  const { seams } = seamsFor({ deleteKey: async () => true });
  const response = await route(seams).fetch(
    vaultKeyRequest("DELETE", { providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR }),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).deleted, true);
});

test("deleting a key that was not stored answers { deleted: false }", async () => {
  const { seams } = seamsFor({ deleteKey: async () => false });
  const response = await route(seams).fetch(
    vaultKeyRequest("DELETE", { providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR }),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).deleted, false);
});

test("the delete passes the resolved user id and provider id to the seam", async () => {
  const { seams, recorded } = seamsFor();
  await route(seams).fetch(
    vaultKeyRequest("DELETE", { providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR }),
  );
  assert.deepEqual(recorded.deletes, [
    { userId: "user-1", providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR },
  ]);
});

// --- Vault keys: list ---

test("the list gate order is method, secret, token", async () => {
  const wrongMethod = await route(vaultStoreOptions()).fetch(vaultKeysRequest("POST"));
  assert.equal(wrongMethod.status, 405);

  const noSecret = await route(vaultStoreOptions({ encryptionSecret: undefined })).fetch(
    vaultKeysRequest(),
  );
  assert.equal(noSecret.status, 503);

  const anonymous = await route(vaultStoreOptions({ resolveUserId: async () => undefined })).fetch(
    vaultKeysRequest(),
  );
  assert.equal(anonymous.status, 401);
});

test("the list answer never contains ciphertext or plaintext keys", async () => {
  const response = await route(vaultStoreOptions()).fetch(vaultKeysRequest());

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.keys.length, 1);
  assert.equal(body.keys[0].providerId, CLOUD_AGENT_PROVIDER_ID.CONDUCTOR);
  assert.equal(body.keys[0].updatedAt, NOW_DATE.getTime());
  assert.ok(!("ciphertext" in body.keys[0]));
  assert.ok(!("key" in body.keys[0]));
});

test("the list omits rows stored for a provider the vault no longer accepts", async () => {
  const { seams } = seamsFor({
    listKeys: async () => [
      { providerId: "cursor", updatedAt: NOW_DATE },
      { providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR, updatedAt: NOW_DATE },
      { providerId: "devin", updatedAt: NOW_DATE },
    ],
  });
  const response = await route(seams).fetch(vaultKeysRequest());

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.keys, [
    { providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR, updatedAt: NOW_DATE.getTime() },
  ]);
});

test("the list calls the seam with the resolved user id", async () => {
  let calledWithUserId: string | undefined;
  const { seams } = seamsFor({
    resolveUserId: async () => "user-xyz",
    listKeys: async (userId) => {
      calledWithUserId = userId;
      return [];
    },
  });

  await route(seams).fetch(vaultKeysRequest());
  assert.equal(calledWithUserId, "user-xyz");
});

// --- Byte goldens ---

const GOLDEN_ROOT = path.join(import.meta.dirname, "../fixtures/devices-vault-route");

interface Exchange {
  name: string;
  seams?: Partial<DevicesVaultSeams>;
  request: () => Request;
}

const EXCHANGES: readonly Exchange[] = [
  {
    name: "register",
    request: () =>
      devicesRequest(
        "POST",
        { platform: DEVICE_PLATFORM.MACOS, installationId: INSTALLATION_ID },
        "user-golden",
      ),
  },
  {
    name: "heartbeat",
    request: () => devicesRequest("PUT", { deviceId: DEVICE_ID }, "user-golden"),
  },
  {
    name: "forget",
    request: () => devicesRequest("DELETE", { deviceId: DEVICE_ID }, "user-golden"),
  },
  {
    name: "devices-method-not-allowed",
    request: () => devicesRequest("GET", undefined, "user-golden"),
  },
  {
    name: "devices-invalid-token",
    seams: { resolveUserId: async () => undefined },
    request: () => devicesRequest("POST", { deviceId: DEVICE_ID }, "user-golden"),
  },
  {
    name: "vault-store",
    request: () =>
      vaultKeyRequest("POST", { providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR, key: "sk-abc1234" }),
  },
  {
    name: "vault-delete",
    request: () => vaultKeyRequest("DELETE", { providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR }),
  },
  { name: "vault-list", request: () => vaultKeysRequest() },
  {
    name: "vault-unavailable",
    seams: { encryptionSecret: undefined },
    request: () =>
      vaultKeyRequest("POST", { providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR, key: "sk-abc1234" }),
  },
  { name: "route-not-found", request: () => new Request("https://luke.test/api/not-a-route") },
];

test("the group's bytes are pinned per exchange", async () => {
  for (const exchange of EXCHANGES) {
    const { seams } = seamsFor(exchange.seams);
    const response = await route(seams).fetch(exchange.request());
    await settleResponseGolden(GOLDEN_ROOT, exchange.name, await recordedResponse(response));
  }
});

test("the recorded set is exactly the exchanges declared", async () => {
  assert.deepEqual(
    await recordedGoldenNames(GOLDEN_ROOT),
    EXCHANGES.map((exchange) => exchange.name).sort(),
  );
});
