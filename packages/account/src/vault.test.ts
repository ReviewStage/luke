import assert from "node:assert/strict";
import test from "node:test";
import { VAULT_PROVIDER_ID } from "@sidecar/hosted";
import { HostedVaultClient } from "./vault.js";

const LIST_ANSWER = {
  keys: [{ providerId: VAULT_PROVIDER_ID.CONDUCTOR, updatedAt: 1_800_000_000_000 }],
};

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

function client(options: Partial<ConstructorParameters<typeof HostedVaultClient>[0]> = {}) {
  return new HostedVaultClient({
    serviceBaseUrl: "https://tryluke.dev",
    readAccessToken: async () => "token-1",
    refreshAccount: async () => undefined,
    ...options,
  });
}

test("stores a key as a bearer-authenticated POST and reads the confirmation", async () => {
  const { requests, fetchLike } = service([
    () => new Response(JSON.stringify({ stored: true }), { status: 200 }),
  ]);

  const answer = await client({ fetch: fetchLike }).storeKey(
    VAULT_PROVIDER_ID.CONDUCTOR,
    "key_1234abcd",
  );
  assert.deepEqual(answer, { stored: true });

  const [request] = requests;
  assert.equal(request?.url, "https://tryluke.dev/api/vault/key");
  assert.equal(request?.init.method, "POST");
  const headers = new Headers(request?.init.headers);
  assert.equal(headers.get("authorization"), "Bearer token-1");
  assert.equal(headers.get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(String(request?.init.body)), {
    providerId: VAULT_PROVIDER_ID.CONDUCTOR,
    key: "key_1234abcd",
  });
});

test("a key the service would refuse by shape never travels", async () => {
  const { requests, fetchLike } = service([]);
  const vault = client({ fetch: fetchLike });

  assert.equal(await vault.storeKey(VAULT_PROVIDER_ID.CONDUCTOR, ""), undefined);
  assert.equal(await vault.storeKey(VAULT_PROVIDER_ID.CONDUCTOR, "key with spaces"), undefined);
  assert.equal(await vault.storeKey(VAULT_PROVIDER_ID.CONDUCTOR, "k".repeat(513)), undefined);
  assert.equal(requests.length, 0);
});

test("lists stored entries without a body and validates the answer", async () => {
  const { requests, fetchLike } = service([
    () => new Response(JSON.stringify(LIST_ANSWER), { status: 200 }),
  ]);

  const keys = await client({ fetch: fetchLike }).listKeys();
  assert.deepEqual(keys, LIST_ANSWER.keys);

  const [request] = requests;
  assert.equal(request?.url, "https://tryluke.dev/api/vault/keys");
  assert.equal(request?.init.method, "GET");
  assert.equal(request?.init.body, undefined);
  assert.equal(new Headers(request?.init.headers).get("content-type"), null);
});

test("deletes one provider's key and reads whether one was removed", async () => {
  const { requests, fetchLike } = service([
    () => new Response(JSON.stringify({ deleted: true }), { status: 200 }),
  ]);

  const answer = await client({ fetch: fetchLike }).deleteKey(VAULT_PROVIDER_ID.CONDUCTOR);
  assert.deepEqual(answer, { deleted: true });

  const [request] = requests;
  assert.equal(request?.url, "https://tryluke.dev/api/vault/key");
  assert.equal(request?.init.method, "DELETE");
  assert.deepEqual(JSON.parse(String(request?.init.body)), {
    providerId: VAULT_PROVIDER_ID.CONDUCTOR,
  });
});

test("a 401 refreshes the account and retries once on the new token", async () => {
  const tokens = ["token-1", "token-2"];
  let refreshes = 0;
  const { requests, fetchLike } = service([
    () => new Response(JSON.stringify({ error: "invalid-token" }), { status: 401 }),
    () => new Response(JSON.stringify(LIST_ANSWER), { status: 200 }),
  ]);

  const keys = await client({
    fetch: fetchLike,
    readAccessToken: async () => tokens.shift(),
    refreshAccount: async () => {
      refreshes += 1;
    },
  }).listKeys();

  assert.deepEqual(keys, LIST_ANSWER.keys);
  assert.equal(refreshes, 1);
  assert.equal(requests.length, 2);
  assert.equal(new Headers(requests[1]?.init.headers).get("authorization"), "Bearer token-2");
});

test("a 401 whose refresh yields the same token is not retried", async () => {
  const { requests, fetchLike } = service([
    () => new Response(JSON.stringify({ error: "invalid-token" }), { status: 401 }),
  ]);

  const answer = await client({ fetch: fetchLike }).deleteKey(VAULT_PROVIDER_ID.CONDUCTOR);
  assert.equal(answer, undefined);
  assert.equal(requests.length, 1);
});

test("failures, malformed answers, and a missing account all read as no answer", async () => {
  const failing = client({
    fetch: async () => {
      throw new Error("offline");
    },
  });
  assert.equal(await failing.listKeys(), undefined);
  assert.equal(await failing.storeKey(VAULT_PROVIDER_ID.CONDUCTOR, "key_1234"), undefined);

  const refused = client({
    fetch: async () => new Response(JSON.stringify({ error: "unavailable" }), { status: 503 }),
  });
  assert.equal(await refused.storeKey(VAULT_PROVIDER_ID.CONDUCTOR, "key_1234"), undefined);

  const malformed = client({
    fetch: async () =>
      new Response(JSON.stringify({ keys: [{ providerId: "openai", updatedAt: 1 }] }), {
        status: 200,
      }),
  });
  assert.equal(await malformed.listKeys(), undefined);

  const requests: RecordedRequest[] = [];
  const signedOut = client({
    fetch: async (url, init) => {
      requests.push({ url, init });
      return new Response(JSON.stringify(LIST_ANSWER), { status: 200 });
    },
    readAccessToken: async () => undefined,
  });
  assert.equal(await signedOut.listKeys(), undefined);
  assert.equal(requests.length, 0);
});
