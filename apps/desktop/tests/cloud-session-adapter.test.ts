import assert from "node:assert/strict";
import test from "node:test";
import { type ProviderSessionObservation, SESSION_STATUS } from "@sidecar/core";
import {
  type CloudAdapterOptions,
  type CloudFetch,
  type CloudRequest,
  CloudSessionAdapter,
} from "../src/cloud-session-adapter";

const TEST_TIME = Date.parse("2026-08-12T02:45:00.000Z");
const TEST_BASE_URL = "https://api.provider.test";
const TEST_API_KEY = "provider-test-key";

const HTTP_STATUS = {
  OK: 200,
  UNAUTHORIZED: 401,
} as const;

const STUB_PROVIDER = { id: "stub", displayName: "Stub" };

interface RecordedRequest {
  method: string;
  url: string;
  authorization: string | undefined;
  accept: string | undefined;
}

interface StubFetch {
  fetch: CloudFetch;
  requests: RecordedRequest[];
}

function stubFetch(status: () => number = () => HTTP_STATUS.OK): StubFetch {
  const requests: RecordedRequest[] = [];
  const fetch: CloudFetch = async (url, init) => {
    const headers = new Headers(init.headers);
    requests.push({
      method: init.method ?? "",
      url,
      authorization: headers.get("authorization") ?? undefined,
      accept: headers.get("accept") ?? undefined,
    });
    return new Response(JSON.stringify({}), {
      status: status(),
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch, requests };
}

function observation(
  providerSessionId: string,
  overrides: Partial<ProviderSessionObservation> = {},
): ProviderSessionObservation {
  return {
    providerSessionId,
    title: `Stub: ${providerSessionId}`,
    status: SESSION_STATUS.WAITING,
    observedAt: TEST_TIME,
    ...overrides,
  };
}

/** Stands in for a real provider so the shared half can be tested on its own. */
class StubCloudAdapter extends CloudSessionAdapter {
  passes = 0;
  forgottenIdentities = 0;
  collected: readonly ProviderSessionObservation[] = [];

  constructor(options: CloudAdapterOptions) {
    super({ provider: STUB_PROVIDER, defaultBaseUrl: TEST_BASE_URL }, options);
  }

  protected override forgetCachedIdentity(): void {
    this.forgottenIdentities += 1;
  }

  protected async collect(
    request: CloudRequest,
    now: number,
  ): Promise<readonly ProviderSessionObservation[]> {
    this.passes += 1;
    await request(["v0", "sessions", "id with/slash"], { limit: "2" });
    return this.collected.map((candidate) => ({
      ...candidate,
      status: this.statusWhileRecent(candidate.status, candidate.observedAt, now),
    }));
  }
}

function adapterFor(
  fetch: CloudFetch,
  overrides: {
    apiKey?: string | undefined;
    readApiKey?: () => Promise<string | undefined>;
    now?: () => number;
  } = {},
): StubCloudAdapter {
  const apiKey = "apiKey" in overrides ? overrides.apiKey : TEST_API_KEY;
  return new StubCloudAdapter({
    readApiKey: overrides.readApiKey ?? (async () => apiKey),
    baseUrl: TEST_BASE_URL,
    fetch,
    now: overrides.now ?? (() => TEST_TIME),
    minimumRefreshIntervalMs: 0,
  });
}

test("authenticates a bounded read and encodes the route a subclass asked for", async () => {
  const stub = stubFetch();
  const adapter = adapterFor(stub.fetch);
  adapter.collected = [observation("session-one")];

  const observations = await adapter.observe();

  assert.equal(adapter.provider.id, "stub");
  assert.equal(observations.length, 1);
  assert.deepEqual(stub.requests, [
    {
      method: "GET",
      url: `${TEST_BASE_URL}/v0/sessions/id%20with%2Fslash?limit=2`,
      authorization: `Bearer ${TEST_API_KEY}`,
      accept: "application/json",
    },
  ]);
});

test("drops a session a subclass reported twice in one pass", async () => {
  const stub = stubFetch();
  const adapter = adapterFor(stub.fetch);
  adapter.collected = [
    observation("session-repeated", { status: SESSION_STATUS.WORKING }),
    observation("session-repeated", { status: SESSION_STATUS.COMPLETE }),
    observation("session-other"),
  ];

  const observations = await adapter.observe();

  assert.deepEqual(
    observations.map((candidate) => candidate.providerSessionId),
    ["session-repeated", "session-other"],
  );
  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
});

test("leaves a stopped session unknown once its timestamp goes stale", async () => {
  const stub = stubFetch();
  const adapter = adapterFor(stub.fetch);
  adapter.collected = [
    observation("session-recent", { observedAt: TEST_TIME - 60_000 }),
    observation("session-stale", { observedAt: TEST_TIME - 60 * 60 * 1000 }),
  ];

  const observations = await adapter.observe();

  assert.equal(observations[0]?.status, SESSION_STATUS.WAITING);
  assert.equal(observations[1]?.status, SESSION_STATUS.UNKNOWN);
});

test("forgets cached identity when the credential changes, and reports nothing without one", async () => {
  const stub = stubFetch();
  let apiKey: string | undefined = TEST_API_KEY;
  const adapter = adapterFor(stub.fetch, { readApiKey: async () => apiKey });
  adapter.collected = [observation("session-one")];

  await adapter.observe();
  apiKey = "replacement-key";
  const afterRotation = await adapter.observe();
  apiKey = undefined;
  const afterRemoval = await adapter.observe();

  assert.equal(adapter.passes, 2, "the replacement key did not trigger a pass");
  assert.equal(afterRotation.length, 1);
  assert.equal(stub.requests.at(-1)?.authorization, "Bearer replacement-key");
  assert.deepEqual(afterRemoval, []);
  // Once when the first key was accepted, once for the rotation, once when the
  // credential was removed.
  assert.equal(adapter.forgottenIdentities, 3);
});

test("clears observations when the provider rejects the credential", async () => {
  let rejectRequests = false;
  const stub = stubFetch(() => (rejectRequests ? HTTP_STATUS.UNAUTHORIZED : HTTP_STATUS.OK));
  const adapter = adapterFor(stub.fetch);
  adapter.collected = [observation("session-one")];

  const authorized = await adapter.observe();
  rejectRequests = true;
  const rejected = await adapter.observe();

  assert.equal(authorized.length, 1);
  assert.deepEqual(rejected, []);
  // Once when the key was accepted, once when the provider rejected it.
  assert.equal(adapter.forgottenIdentities, 2);
});

test("issues no request at all when the credential cannot be read", async () => {
  const stub = stubFetch();
  const adapter = adapterFor(stub.fetch, {
    readApiKey: async () => {
      throw new Error("settings are unreadable");
    },
  });
  adapter.collected = [observation("session-one")];

  assert.deepEqual(await adapter.observe(), []);
  assert.deepEqual(stub.requests, []);
  assert.equal(adapter.passes, 0);
});
