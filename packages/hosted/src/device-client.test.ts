import assert from "node:assert/strict";
import { test } from "vitest";
import { HostedDeviceClient } from "./device-client.js";
import { DEVICE_PLATFORM } from "./device-wire.js";

const INSTALLATION_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const DEVICE_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

interface RecordedRequest {
  url: string;
  init: RequestInit;
}

function service(answers: Array<() => Response>) {
  const requests: RecordedRequest[] = [];
  let call = 0;
  const fetchLike = async (url: string, init: RequestInit): Promise<Response> => {
    requests.push({ url, init });
    const answer = answers[Math.min(call, answers.length - 1)];
    call += 1;
    if (!answer) throw new Error("no scripted answer");
    return answer();
  };
  return { requests, fetchLike };
}

function client(options: Partial<ConstructorParameters<typeof HostedDeviceClient>[0]> = {}) {
  return new HostedDeviceClient({
    serviceBaseUrl: "https://tryluke.dev/",
    readAccessToken: async () => "token-1",
    refreshAccount: async () => undefined,
    ...options,
  });
}

test("registers the installation as a bearer-authenticated POST and reads the device id", async () => {
  const { requests, fetchLike } = service([
    () => new Response(JSON.stringify({ deviceId: DEVICE_ID }), { status: 200 }),
  ]);

  const answer = await client({ fetch: fetchLike }).register({
    platform: DEVICE_PLATFORM.MACOS,
    installationId: INSTALLATION_ID,
  });
  assert.deepEqual(answer, { deviceId: DEVICE_ID });

  const [request] = requests;
  assert.equal(request?.url, "https://tryluke.dev/api/devices");
  assert.equal(request?.init.method, "POST");
  const headers = new Headers(request?.init.headers);
  assert.equal(headers.get("authorization"), "Bearer token-1");
  assert.equal(headers.get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(String(request?.init.body)), {
    platform: DEVICE_PLATFORM.MACOS,
    installationId: INSTALLATION_ID,
  });
});

test("a request the service would refuse by shape never travels", async () => {
  const { requests, fetchLike } = service([]);
  const devices = client({ fetch: fetchLike });

  assert.equal(
    await devices.register({ platform: DEVICE_PLATFORM.MACOS, installationId: "mac-1" }),
    undefined,
  );
  assert.equal(
    await devices.register({
      platform: DEVICE_PLATFORM.IOS,
      installationId: INSTALLATION_ID,
      pushToken: "ab".repeat(32),
    }),
    undefined,
  );
  assert.equal(await devices.forget({ deviceId: "" }), undefined);
  assert.equal(requests.length, 0);
});

test("a forget is a DELETE naming the device and reads whether a row went", async () => {
  const { requests, fetchLike } = service([
    () => new Response(JSON.stringify({ deleted: false }), { status: 200 }),
  ]);

  const answer = await client({ fetch: fetchLike }).forget({ deviceId: DEVICE_ID });
  assert.deepEqual(answer, { deleted: false });

  const [request] = requests;
  assert.equal(request?.init.method, "DELETE");
  assert.deepEqual(JSON.parse(String(request?.init.body)), { deviceId: DEVICE_ID });
});

test("a forget at sign-out carries the departing token and never refreshes", async () => {
  let refreshes = 0;
  const { requests, fetchLike } = service([
    () => new Response(JSON.stringify({ error: "invalid-token" }), { status: 401 }),
  ]);

  const answer = await client({
    fetch: fetchLike,
    readAccessToken: async () => "token-standing",
    refreshAccount: async () => {
      refreshes += 1;
    },
  }).forget({ deviceId: DEVICE_ID }, { accessToken: "token-departing" });

  assert.equal(answer, undefined);
  assert.equal(refreshes, 0);
  assert.equal(requests.length, 1);
  assert.equal(
    new Headers(requests[0]?.init.headers).get("authorization"),
    "Bearer token-departing",
  );
});

test("a 401 refreshes the account and retries once on the new token", async () => {
  const tokens = ["token-1", "token-2"];
  let refreshes = 0;
  const { requests, fetchLike } = service([
    () => new Response(JSON.stringify({ error: "invalid-token" }), { status: 401 }),
    () => new Response(JSON.stringify({ deviceId: DEVICE_ID }), { status: 200 }),
  ]);

  const answer = await client({
    fetch: fetchLike,
    readAccessToken: async () => tokens.shift(),
    refreshAccount: async () => {
      refreshes += 1;
    },
  }).register({ platform: DEVICE_PLATFORM.MACOS, installationId: INSTALLATION_ID });

  assert.deepEqual(answer, { deviceId: DEVICE_ID });
  assert.equal(refreshes, 1);
  assert.equal(requests.length, 2);
  assert.equal(new Headers(requests[1]?.init.headers).get("authorization"), "Bearer token-2");
});

test("a refusal, a malformed answer, or no token resolves to nothing", async () => {
  const refused = service([
    () => new Response(JSON.stringify({ error: "invalid-request" }), { status: 400 }),
  ]);
  assert.equal(
    await client({ fetch: refused.fetchLike }).forget({ deviceId: DEVICE_ID }),
    undefined,
  );

  const malformed = service([() => new Response(JSON.stringify({ deviceId: 7 }), { status: 200 })]);
  assert.equal(
    await client({ fetch: malformed.fetchLike }).register({
      platform: DEVICE_PLATFORM.MACOS,
      installationId: INSTALLATION_ID,
    }),
    undefined,
  );

  const signedOut = service([]);
  assert.equal(
    await client({
      fetch: signedOut.fetchLike,
      readAccessToken: async () => undefined,
    }).forget({ deviceId: DEVICE_ID }),
    undefined,
  );
  assert.equal(signedOut.requests.length, 0);
});
