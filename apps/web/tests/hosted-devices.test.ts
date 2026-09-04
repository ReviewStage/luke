import assert from "node:assert/strict";
import test from "node:test";
import { DEVICE_PLATFORM, PUSH_ENVIRONMENT } from "@sidecar/hosted";
import type { DeviceRegistration } from "../server/hosted/devices";
import { handleDeviceTokenDelete, handleDeviceTokenStore } from "../server/hosted/devices";
import { HOSTED_API_ERROR } from "../server/hosted/http";

const TOKEN = "0a".repeat(32);

interface StoreBody {
  token?: unknown;
  platform?: unknown;
  environment?: unknown;
}

function storeRequest(body?: StoreBody): Request {
  return new Request("https://luke.test/api/devices/token", {
    method: "POST",
    headers: { authorization: "Bearer token-1", "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function deleteRequest(body?: { token?: unknown }): Request {
  return new Request("https://luke.test/api/devices/token", {
    method: "DELETE",
    headers: { authorization: "Bearer token-1", "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function validBody(): StoreBody {
  return { token: TOKEN, platform: DEVICE_PLATFORM.IOS, environment: PUSH_ENVIRONMENT.SANDBOX };
}

function storeOptions(overrides: Partial<Parameters<typeof handleDeviceTokenStore>[0]> = {}) {
  return {
    request: storeRequest(validBody()),
    resolveUserId: async () => "user-1",
    storeToken: async (_userId: string, _registration: DeviceRegistration) => {},
    ...overrides,
  };
}

test("the store gate order is method, token, body", async () => {
  const wrongMethod = await handleDeviceTokenStore(
    storeOptions({
      request: new Request("https://luke.test/api/devices/token", { method: "GET" }),
    }),
  );
  assert.equal(wrongMethod.status, 405);

  const anonymous = await handleDeviceTokenStore(
    storeOptions({ resolveUserId: async () => undefined }),
  );
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error, HOSTED_API_ERROR.INVALID_TOKEN);

  const noBody = await handleDeviceTokenStore(storeOptions({ request: storeRequest() }));
  assert.equal(noBody.status, 400);
  assert.equal((await noBody.json()).error, HOSTED_API_ERROR.INVALID_REQUEST);
});

test("a valid registration is stored for the bearer's account, lowercased", async () => {
  let stored: { userId: string; registration: DeviceRegistration } | undefined;
  const response = await handleDeviceTokenStore(
    storeOptions({
      request: storeRequest({ ...validBody(), token: TOKEN.toUpperCase() }),
      storeToken: async (userId, registration) => {
        stored = { userId, registration };
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { stored: true });
  assert.deepEqual(stored, {
    userId: "user-1",
    registration: {
      token: TOKEN,
      platform: DEVICE_PLATFORM.IOS,
      environment: PUSH_ENVIRONMENT.SANDBOX,
    },
  });
});

test("a registration outside the contract is refused before anything is stored", async () => {
  const bodies: StoreBody[] = [
    { ...validBody(), token: "short" },
    { ...validBody(), token: `${"0a".repeat(31)}zz` },
    { ...validBody(), token: 12345 },
    { ...validBody(), platform: "android" },
    { ...validBody(), environment: "staging" },
    { ...validBody(), platform: undefined },
    { ...validBody(), environment: undefined },
  ];
  for (const body of bodies) {
    let stored = false;
    const response = await handleDeviceTokenStore(
      storeOptions({
        request: storeRequest(body),
        storeToken: async () => {
          stored = true;
        },
      }),
    );
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal((await response.json()).error, HOSTED_API_ERROR.INVALID_REQUEST);
    assert.equal(stored, false);
  }
});

function deleteOptions(overrides: Partial<Parameters<typeof handleDeviceTokenDelete>[0]> = {}) {
  return {
    request: deleteRequest({ token: TOKEN }),
    resolveUserId: async () => "user-1",
    deleteToken: async (_userId: string, _token: string) => true,
    ...overrides,
  };
}

test("the delete gate order is method, token, body", async () => {
  const wrongMethod = await handleDeviceTokenDelete(
    deleteOptions({
      request: new Request("https://luke.test/api/devices/token", { method: "POST" }),
    }),
  );
  assert.equal(wrongMethod.status, 405);

  const anonymous = await handleDeviceTokenDelete(
    deleteOptions({ resolveUserId: async () => undefined }),
  );
  assert.equal(anonymous.status, 401);

  const noBody = await handleDeviceTokenDelete(deleteOptions({ request: deleteRequest() }));
  assert.equal(noBody.status, 400);

  const badToken = await handleDeviceTokenDelete(
    deleteOptions({ request: deleteRequest({ token: "nope" }) }),
  );
  assert.equal(badToken.status, 400);
});

test("a delete is scoped to the bearer's account and answers whether a row went", async () => {
  let asked: { userId: string; token: string } | undefined;
  const gone = await handleDeviceTokenDelete(
    deleteOptions({
      request: deleteRequest({ token: TOKEN.toUpperCase() }),
      deleteToken: async (userId, token) => {
        asked = { userId, token };
        return true;
      },
    }),
  );
  assert.equal(gone.status, 200);
  assert.deepEqual(await gone.json(), { deleted: true });
  assert.deepEqual(asked, { userId: "user-1", token: TOKEN });

  const absent = await handleDeviceTokenDelete(deleteOptions({ deleteToken: async () => false }));
  assert.deepEqual(await absent.json(), { deleted: false });
});
