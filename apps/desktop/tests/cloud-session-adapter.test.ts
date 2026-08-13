import assert from "node:assert/strict";
import test from "node:test";
import { type ProviderSessionObservation, SESSION_LOCATION, SESSION_STATUS } from "@sidecar/core";
import {
  type CloudAdapterOptions,
  type CloudFetch,
  type CloudRequest,
  CloudSessionAdapter,
  isDefined,
  knownValue,
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

test("accepts only a state this build knows", () => {
  const REPORTED_STATE = { IDLE: "idle", WORKING: "working" } as const;

  assert.equal(knownValue(REPORTED_STATE, "working"), REPORTED_STATE.WORKING);
  // A state a provider adds later is left undefined rather than guessed at, and
  // an inherited property name is not a state at all.
  assert.equal(knownValue(REPORTED_STATE, "reviewing"), undefined);
  assert.equal(knownValue(REPORTED_STATE, "toString"), undefined);
  assert.equal(knownValue(REPORTED_STATE, undefined), undefined);
});

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

/** Stands in for a provider that asks for its own media type and version pin. */
class PinnedHeaderAdapter extends StubCloudAdapter {
  protected override requestHeaders(): Readonly<Record<string, string>> {
    return { Accept: "application/vnd.stub+json", "X-Stub-Api-Version": "2026-03-10" };
  }
}

test("lets a subclass pin its own request headers without touching the credential", async () => {
  const requests: {
    accept: string | undefined;
    version: string | undefined;
    auth: string | undefined;
  }[] = [];
  const fetch: CloudFetch = async (_url, init) => {
    const headers = new Headers(init.headers);
    requests.push({
      accept: headers.get("accept") ?? undefined,
      version: headers.get("x-stub-api-version") ?? undefined,
      auth: headers.get("authorization") ?? undefined,
    });
    return new Response(JSON.stringify({}), { status: HTTP_STATUS.OK });
  };
  const adapter = new PinnedHeaderAdapter({
    readApiKey: async () => TEST_API_KEY,
    baseUrl: TEST_BASE_URL,
    fetch,
    now: () => TEST_TIME,
    minimumRefreshIntervalMs: 0,
  });

  await adapter.observe();

  assert.deepEqual(requests, [
    {
      accept: "application/vnd.stub+json",
      version: "2026-03-10",
      auth: `Bearer ${TEST_API_KEY}`,
    },
  ]);
});

test("reports every session it serves as running in the cloud", async () => {
  const stub = stubFetch();
  const adapter = adapterFor(stub.fetch);
  // Neither observation says where it runs: the base knows, because nothing
  // reaches it except over the network.
  adapter.collected = [observation("session-one"), observation("session-two")];

  const observations = await adapter.observe();

  assert.deepEqual(
    observations.map((candidate) => candidate.location),
    [SESSION_LOCATION.CLOUD, SESSION_LOCATION.CLOUD],
  );
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

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/**
 * Reports whatever session the authenticated account can see, across two
 * requests, the way a real provider pass fans out. What it reports is decided
 * by the account that answers, not by anything cached on the adapter.
 */
class AccountBoundAdapter extends CloudSessionAdapter {
  constructor(options: CloudAdapterOptions) {
    super({ provider: STUB_PROVIDER, defaultBaseUrl: TEST_BASE_URL }, options);
  }

  protected async collect(request: CloudRequest): Promise<readonly ProviderSessionObservation[]> {
    const first = await request(["sessions", "first"]);
    const second = await request(["sessions", "second"]);
    return [first, second]
      .map((body) => (typeof body.session === "string" ? observation(body.session) : undefined))
      .filter(isDefined);
  }
}

const OLD_ACCOUNT_SESSION = "session-from-old-account";
const NEW_ACCOUNT_SESSION = "session-from-new-account";

function accountBoundFetch(options: { oldKeyGate: Promise<void>; oldKeyStatus?: number }): {
  fetch: CloudFetch;
  authorizations: string[];
} {
  const sessionByAuthorization: Record<string, string> = {
    "Bearer first-key": OLD_ACCOUNT_SESSION,
    "Bearer second-key": NEW_ACCOUNT_SESSION,
  };
  const authorizations: string[] = [];
  const fetch: CloudFetch = async (_url, init) => {
    const authorization = new Headers(init.headers).get("authorization") ?? "";
    authorizations.push(authorization);
    let status: number = HTTP_STATUS.OK;
    if (authorization === "Bearer first-key") {
      await options.oldKeyGate;
      status = options.oldKeyStatus ?? HTTP_STATUS.OK;
    }
    return new Response(JSON.stringify({ session: sessionByAuthorization[authorization] }), {
      status,
    });
  };
  return { fetch, authorizations };
}

function sessionIds(observations: readonly ProviderSessionObservation[]): string[] {
  return observations.map((candidate) => candidate.providerSessionId);
}

test("a pass superseded by a key rotation neither lands nor keeps using the old key", async () => {
  // A settings save refreshes the adapter while a timer-driven pass is still
  // in flight with the key it replaced. The old account's sessions must not be
  // served under the new credential, and the replaced key must not be used for
  // the rest of the superseded pass.
  const oldKeyRequest = deferred();
  const { fetch, authorizations } = accountBoundFetch({ oldKeyGate: oldKeyRequest.promise });
  let apiKey = "first-key";
  const adapter = new AccountBoundAdapter({
    readApiKey: async () => apiKey,
    baseUrl: TEST_BASE_URL,
    fetch,
    now: () => TEST_TIME,
    minimumRefreshIntervalMs: 0,
  });

  const stalePass = adapter.observe();
  apiKey = "second-key";
  const freshObservations = await adapter.observe();
  oldKeyRequest.resolve();
  const staleObservations = await stalePass;

  assert.deepEqual(sessionIds(freshObservations), [NEW_ACCOUNT_SESSION]);
  assert.deepEqual(sessionIds(staleObservations), [NEW_ACCOUNT_SESSION]);
  assert.equal(
    authorizations.filter((value) => value === "Bearer first-key").length,
    1,
    "a superseded pass kept requesting with the replaced key",
  );
});

test("a replaced key rejected mid-flight does not clear the new key's observations", async () => {
  // The old key is often rotated out precisely because it was revoked, so its
  // rejection arrives after the new key has already observed sessions.
  const oldKeyRequest = deferred();
  const { fetch } = accountBoundFetch({
    oldKeyGate: oldKeyRequest.promise,
    oldKeyStatus: HTTP_STATUS.UNAUTHORIZED,
  });
  let apiKey = "first-key";
  const adapter = new AccountBoundAdapter({
    readApiKey: async () => apiKey,
    baseUrl: TEST_BASE_URL,
    fetch,
    now: () => TEST_TIME,
    minimumRefreshIntervalMs: 60_000,
  });

  const stalePass = adapter.observe();
  apiKey = "second-key";
  await adapter.observe();
  oldKeyRequest.resolve();
  const staleObservations = await stalePass;
  // Inside the refresh interval this serves the cache, which is exactly where
  // a wrongly cleared snapshot would surface as vanished rows.
  const cachedObservations = await adapter.observe();

  assert.deepEqual(sessionIds(staleObservations), [NEW_ACCOUNT_SESSION]);
  assert.deepEqual(sessionIds(cachedObservations), [NEW_ACCOUNT_SESSION]);
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
