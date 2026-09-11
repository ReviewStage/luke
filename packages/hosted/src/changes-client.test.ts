import assert from "node:assert/strict";
import { test } from "vitest";
import { HostedChangesClient } from "./changes-client.js";
import { encodeSequenceReadCursor } from "./reads-wire.js";

const DEVICE_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const EMPTY_CURSOR = encodeSequenceReadCursor([]);

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

function client(options: Partial<ConstructorParameters<typeof HostedChangesClient>[0]> = {}) {
  return new HostedChangesClient({
    serviceBaseUrl: "https://tryluke.dev/",
    readAccessToken: async () => "token-1",
    refreshAccount: async () => undefined,
    ...options,
  });
}

test("a poll is a bearer-authenticated POST carrying the device and each instant as stated, and reads the heads back", async () => {
  const { requests, fetchLike } = service([
    () =>
      new Response(JSON.stringify({ seen: true, messages: EMPTY_CURSOR, events: EMPTY_CURSOR }), {
        status: 200,
      }),
  ]);

  const answer = await client({ fetch: fetchLike }).poll({
    deviceId: DEVICE_ID,
    activeUntil: 1_757_505_900_000,
    quietUntil: null,
  });
  assert.deepEqual(answer, { seen: true, messages: EMPTY_CURSOR, events: EMPTY_CURSOR });

  const [request] = requests;
  assert.equal(request?.url, "https://tryluke.dev/api/changes");
  assert.equal(request?.init.method, "POST");
  const headers = new Headers(request?.init.headers);
  assert.equal(headers.get("authorization"), "Bearer token-1");
  assert.deepEqual(JSON.parse(String(request?.init.body)), {
    deviceId: DEVICE_ID,
    activeUntil: 1_757_505_900_000,
    quietUntil: null,
  });
});

test("an instant left out travels as left out, so the service leaves the one on file", async () => {
  const { requests, fetchLike } = service([
    () =>
      new Response(JSON.stringify({ seen: false, messages: EMPTY_CURSOR, events: EMPTY_CURSOR }), {
        status: 200,
      }),
  ]);
  const answer = await client({ fetch: fetchLike }).poll({ deviceId: DEVICE_ID });
  assert.equal(answer?.seen, false);
  assert.deepEqual(JSON.parse(String(requests[0]?.init.body)), { deviceId: DEVICE_ID });
});

test("a request the service would refuse by shape never travels, and a malformed answer reads as nothing", async () => {
  const refused = service([]);
  assert.equal(
    await client({ fetch: refused.fetchLike }).poll({ deviceId: "mac", activeUntil: 1 }),
    undefined,
  );
  assert.equal(refused.requests.length, 0);

  const malformed = service([() => new Response(JSON.stringify({ seen: "yes" }), { status: 200 })]);
  assert.equal(
    await client({ fetch: malformed.fetchLike }).poll({ deviceId: DEVICE_ID }),
    undefined,
  );
  assert.equal(malformed.requests.length, 1);
});
