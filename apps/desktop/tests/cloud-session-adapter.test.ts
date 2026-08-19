import assert from "node:assert/strict";
import test from "node:test";
import {
  agedStatus,
  OBSERVATION_WINDOW,
  PROVIDER_ACT_RESULT_STATUS,
  type ProviderSessionObservation,
  SESSION_LOCATION,
  SESSION_STATUS,
  type SessionControl,
} from "@sidecar/core";
import {
  type CloudAdapterOptions,
  type CloudFetch,
  type CloudRequest,
  CloudSessionAdapter,
  isDefined,
  knownValue,
} from "../src/cloud-session-adapter";
import { HTTP_STATUS, jsonResponse, recordingFetch } from "./support/http-fake";

const TEST_TIME = Date.parse("2026-08-12T02:45:00.000Z");
const TEST_BASE_URL = "https://api.provider.test";
const TEST_API_KEY = "provider-test-key";

const STUB_PROVIDER = { id: "stub", displayName: "Stub" };

function stubFetch(status: () => number = () => HTTP_STATUS.OK) {
  return recordingFetch(() => jsonResponse({}, status()));
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

const STUB_APPROVE_CONTROL = { id: "approve", label: "Approve" } as const;

/** Stands in for a real provider so the shared half can be tested on its own. */
class StubCloudAdapter extends CloudSessionAdapter {
  passes = 0;
  forgottenIdentities = 0;
  collected: readonly ProviderSessionObservation[] = [];
  collectError: Error | undefined;

  constructor(options: CloudAdapterOptions) {
    super({ provider: STUB_PROVIDER, defaultBaseUrl: TEST_BASE_URL }, options);
  }

  protected override forgetCachedIdentity(): void {
    this.forgottenIdentities += 1;
  }

  protected messageRoute(providerSessionId: string, text: string) {
    return {
      segments: ["v0", "sessions", providerSessionId],
      action: "sendMessage",
      body: { prompt: text },
    };
  }

  protected override controlRoute(providerSessionId: string, control: SessionControl) {
    if (control.id !== STUB_APPROVE_CONTROL.id) return undefined;
    return { segments: ["v0", "sessions", providerSessionId, "approve"] };
  }

  protected async collect(
    request: CloudRequest,
    now: number,
  ): Promise<readonly ProviderSessionObservation[]> {
    this.passes += 1;
    if (this.collectError) throw this.collectError;
    await request(["v0", "sessions", "id with/slash"], { limit: "2" });
    return this.collected.map((candidate) => ({
      ...candidate,
      status: agedStatus(
        candidate.status,
        candidate.observedAt,
        now,
        OBSERVATION_WINDOW.ACTIVE_SESSION_FRESHNESS_MS,
      ),
    }));
  }
}

function adapterFor(
  fetch: CloudFetch,
  overrides: {
    apiKey?: string | undefined;
    readApiKey?: () => Promise<string | undefined>;
    now?: () => number;
    minimumRefreshIntervalMs?: number;
    onDiagnostic?: (error: Error) => void;
  } = {},
): StubCloudAdapter {
  const apiKey = "apiKey" in overrides ? overrides.apiKey : TEST_API_KEY;
  const adapterOptions: ConstructorParameters<typeof StubCloudAdapter>[0] = {
    readApiKey: overrides.readApiKey ?? (async () => apiKey),
    baseUrl: TEST_BASE_URL,
    fetch,
    now: overrides.now ?? (() => TEST_TIME),
    minimumRefreshIntervalMs: overrides.minimumRefreshIntervalMs ?? 0,
  };
  if (overrides.onDiagnostic) {
    adapterOptions.onDiagnostic = overrides.onDiagnostic;
  }
  return new StubCloudAdapter(adapterOptions);
}

/** A cloud adapter that observes and routes nothing. */
class ObservationOnlyAdapter extends CloudSessionAdapter {
  constructor(options: CloudAdapterOptions) {
    super({ provider: STUB_PROVIDER, defaultBaseUrl: TEST_BASE_URL }, options);
  }

  protected async collect(): Promise<readonly ProviderSessionObservation[]> {
    return [];
  }
}

test("answers unsupported explicitly when no observed route exists", async () => {
  const stub = adapterFor(stubFetch().fetch);
  const observer = new ObservationOnlyAdapter({
    readApiKey: async () => TEST_API_KEY,
    baseUrl: TEST_BASE_URL,
  });
  for (const adapter of [stub, observer]) {
    assert.deepEqual(await adapter.sendMessage({ providerSessionId: "missing", text: "hello" }), {
      status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED,
    });
    assert.deepEqual(adapter.workspaceProjects(), []);
  }
});

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
  const [request] = stub.requests;
  assert.ok(request);
  assert.equal(request.method, "GET");
  assert.equal(request.url, `${TEST_BASE_URL}/v0/sessions/id%20with%2Fslash?limit=2`);
  assert.equal(request.authorization, `Bearer ${TEST_API_KEY}`);
  assert.equal(request.accept, "application/json");
  assert.equal(request.contentType, undefined);
  assert.equal(request.body, undefined);
});

/** Stands in for a provider that asks for its own media type and version pin. */
class PinnedHeaderAdapter extends StubCloudAdapter {
  protected override requestHeaders() {
    return { Accept: "application/vnd.stub+json", "X-Stub-Api-Version": "2026-03-10" };
  }
}

test("lets a subclass pin its own request headers without touching the credential", async () => {
  const { fetch, requests } = recordingFetch(() => jsonResponse({}));
  const adapter = new PinnedHeaderAdapter({
    readApiKey: async () => TEST_API_KEY,
    baseUrl: TEST_BASE_URL,
    fetch,
    now: () => TEST_TIME,
    minimumRefreshIntervalMs: 0,
  });

  await adapter.observe();

  const [request] = requests;
  assert.ok(request);
  assert.equal(request.accept, "application/vnd.stub+json");
  assert.equal(request.headers.get("x-stub-api-version"), "2026-03-10");
  assert.equal(request.authorization, `Bearer ${TEST_API_KEY}`);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
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
  const diagnostics: unknown[] = [];
  const stub = stubFetch(() => (rejectRequests ? HTTP_STATUS.UNAUTHORIZED : HTTP_STATUS.OK));
  const adapter = adapterFor(stub.fetch, { onDiagnostic: (error) => diagnostics.push(error) });
  adapter.collected = [observation("session-one")];

  const authorized = await adapter.observe();
  rejectRequests = true;
  const rejected = await adapter.observe();

  assert.equal(authorized.length, 1);
  assert.deepEqual(rejected, []);
  // Once when the key was accepted, once when the provider rejected it.
  assert.equal(adapter.forgottenIdentities, 2);
  assert.deepEqual(diagnostics, []);
});

function deferred() {
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
      .map((body) => {
        const session = body.session;
        if (
          session === undefined ||
          Object.prototype.toString.call(session) !== "[object String]"
        ) {
          return undefined;
        }
        return observation(session);
      })
      .filter(isDefined);
  }
}

const OLD_ACCOUNT_SESSION = "session-from-old-account";
const NEW_ACCOUNT_SESSION = "session-from-new-account";

function accountBoundFetch(options: { oldKeyGate: Promise<void>; oldKeyStatus?: number }) {
  const sessionByAuthorization = new Map<string, string>([
    ["Bearer first-key", OLD_ACCOUNT_SESSION],
    ["Bearer second-key", NEW_ACCOUNT_SESSION],
  ]);
  const authorizations: string[] = [];
  const fetch: CloudFetch = async (_url, init) => {
    const authorization = new Headers(init.headers).get("authorization") ?? "";
    authorizations.push(authorization);
    let status: number = HTTP_STATUS.OK;
    if (authorization === "Bearer first-key") {
      await options.oldKeyGate;
      status = options.oldKeyStatus ?? HTTP_STATUS.OK;
    }
    return jsonResponse({ session: sessionByAuthorization.get(authorization) }, status);
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
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // a wrongly cleared snapshot would surface as vanished rows.
  const cachedObservations = await adapter.observe();

  assert.deepEqual(sessionIds(staleObservations), [NEW_ACCOUNT_SESSION]);
  assert.deepEqual(sessionIds(cachedObservations), [NEW_ACCOUNT_SESSION]);
});

test("a transient provider failure keeps the previous snapshot", async () => {
  let status: number = HTTP_STATUS.OK;
  const diagnostics: unknown[] = [];
  const stub = stubFetch(() => status);
  const adapter = adapterFor(stub.fetch, { onDiagnostic: (error) => diagnostics.push(error) });
  adapter.collected = [observation("session-one")];

  const first = await adapter.observe();
  status = 500;
  const second = await adapter.observe();

  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(second[0]?.providerSessionId, "session-one");
  assert.deepEqual(diagnostics, []);
});

test("a programming error during observation is reported rather than swallowed", async () => {
  const diagnostics: unknown[] = [];
  let now = TEST_TIME;
  const stub = stubFetch();
  const adapter = adapterFor(stub.fetch, {
    now: () => now,
    minimumRefreshIntervalMs: 60_000,
    onDiagnostic: (error) => diagnostics.push(error),
  });
  adapter.collected = [observation("session-one")];

  const first = await adapter.observe();
  now += 60_000;
  const bug = new TypeError("sessions is not iterable");
  adapter.collectError = bug;

  await assert.rejects(() => adapter.observe(), bug);
  assert.deepEqual(diagnostics, [bug]);

  adapter.collectError = undefined;
  const cached = await adapter.observe();
  assert.equal(first.length, 1);
  assert.equal(cached.length, 1);
  assert.equal(cached[0]?.providerSessionId, "session-one");
  // The interval has not elapsed, so the snapshot the programming error failed
  // to replace is still served rather than collected again.
  assert.equal(adapter.passes, 2);
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

test("sends a user message through the route and body the provider documents", async () => {
  const stub = stubFetch();
  const adapter = adapterFor(stub.fetch);
  adapter.collected = [observation("session-one", { canReceiveMessage: true })];
  await adapter.observe();

  const result = await adapter.sendMessage({ providerSessionId: "session-one", text: "  go on  " });

  assert.deepEqual(result, { status: "accepted" });
  const write = stub.requests.at(-1);
  // The action rides unencoded after the encoded segments: `:sendMessage` is
  // part of the route, and `%3AsendMessage` would name a different one.
  assert.equal(write?.url, `${TEST_BASE_URL}/v0/sessions/session-one:sendMessage`);
  assert.equal(write?.method, "POST");
  assert.equal(write?.authorization, `Bearer ${TEST_API_KEY}`);
  assert.equal(write?.contentType, "application/json");
  assert.deepEqual(JSON.parse(write?.body ?? ""), { prompt: "go on" });
});

test("refuses a message for any session that did not advertise taking one", async () => {
  const stub = stubFetch();
  const adapter = adapterFor(stub.fetch);
  adapter.collected = [observation("session-quiet")];
  await adapter.observe();
  const observationRequests = stub.requests.length;

  const unadvertised = await adapter.sendMessage({
    providerSessionId: "session-quiet",
    text: "go on",
  });
  const unobserved = await adapter.sendMessage({
    providerSessionId: "session-unknown",
    text: "go on",
  });

  // Neither refusal may spend a request: a session that advertised nothing has
  // been promised nothing, and no request should exist to find that out.
  assert.deepEqual(unadvertised, { status: "unsupported" });
  assert.deepEqual(unobserved, { status: "unsupported" });
  assert.equal(stub.requests.length, observationRequests);
});

test("refuses text outside the message bound without spending a request", async () => {
  const stub = stubFetch();
  const adapter = adapterFor(stub.fetch);
  adapter.collected = [observation("session-one", { canReceiveMessage: true })];
  await adapter.observe();
  const observationRequests = stub.requests.length;

  const empty = await adapter.sendMessage({ providerSessionId: "session-one", text: "   " });
  const oversized = await adapter.sendMessage({
    providerSessionId: "session-one",
    text: "a".repeat(4_001),
  });

  assert.equal(empty.status, "rejected");
  assert.equal(oversized.status, "rejected");
  assert.equal(stub.requests.length, observationRequests);
});

test("refuses to send once the credential is gone, whatever was observed with it", async () => {
  const stub = stubFetch();
  let apiKey: string | undefined = TEST_API_KEY;
  const adapter = adapterFor(stub.fetch, { readApiKey: async () => apiKey });
  adapter.collected = [observation("session-one", { canReceiveMessage: true })];
  await adapter.observe();
  const observationRequests = stub.requests.length;

  apiKey = undefined;
  const result = await adapter.sendMessage({ providerSessionId: "session-one", text: "go on" });

  // A refusal with the actual reason, not "unsupported": the session
  // advertised taking messages while a key stood behind it, and a key that has
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // since gone must not be reported as the session having moved on.
  assert.equal(result.status, "rejected");
  assert.match(result.status === "rejected" ? result.reason : "", /API key/);
  assert.equal(stub.requests.length, observationRequests);
});

test("reports what became of a send the provider refused", async () => {
  let status: number = HTTP_STATUS.OK;
  const stub = stubFetch(() => status);
  const adapter = adapterFor(stub.fetch);
  adapter.collected = [observation("session-one", { canReceiveMessage: true })];
  await adapter.observe();
  const message = { providerSessionId: "session-one", text: "go on" };

  status = HTTP_STATUS.UNAUTHORIZED;
  const unauthorized = await adapter.sendMessage(message);
  status = HTTP_STATUS.NOT_FOUND;
  const missing = await adapter.sendMessage(message);
  status = HTTP_STATUS.CONFLICT;
  const conflicted = await adapter.sendMessage(message);
  status = HTTP_STATUS.SERVER_ERROR;
  const failed = await adapter.sendMessage(message);

  assert.equal(unauthorized.status, "rejected");
  assert.match(unauthorized.status === "rejected" ? unauthorized.reason : "", /API key/);
  assert.equal(missing.status, "rejected");
  assert.match(missing.status === "rejected" ? missing.reason : "", /no longer has/);
  assert.equal(conflicted.status, "rejected");
  assert.match(conflicted.status === "rejected" ? conflicted.reason : "", /moved on/);
  assert.equal(failed.status, "rejected");
  assert.match(failed.status === "rejected" ? failed.reason : "", /500/);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("reports a send that never reached the provider as rejected, not thrown", async () => {
  const adapter = adapterFor(async () => {
    throw new Error("connection reset");
  });
  adapter.collected = [observation("session-one", { canReceiveMessage: true })];
  await adapter.observe().catch(() => {});
  // Observation failed too, so the session was never observed; re-prime the
  // adapter with a working pass before the network goes away.
  const result = await adapter.sendMessage({ providerSessionId: "session-one", text: "go on" });

  assert.equal(result.status, "unsupported");
});

test("runs an advertised control through its documented route, sending no body", async () => {
  const stub = stubFetch();
  const adapter = adapterFor(stub.fetch);
  adapter.collected = [
    observation("session-plan", { controls: [STUB_APPROVE_CONTROL] }),
    observation("session-quiet"),
  ];
  await adapter.observe();
  const observationRequests = stub.requests.length;

  const approved = await adapter.executeControl({
    providerSessionId: "session-plan",
    control: STUB_APPROVE_CONTROL,
  });
  const unadvertised = await adapter.executeControl({
    providerSessionId: "session-quiet",
    control: STUB_APPROVE_CONTROL,
  });
  const unknown = await adapter.executeControl({
    providerSessionId: "session-plan",
    control: { id: "terminate", label: "Terminate" },
  });

  assert.deepEqual(approved, { status: "accepted" });
  const write = stub.requests.at(-1);
  assert.equal(write?.url, `${TEST_BASE_URL}/v0/sessions/session-plan/approve`);
  assert.equal(write?.method, "POST");
  // An endpoint that documents an empty request gets exactly that.
  assert.equal(write?.contentType, undefined);
  assert.equal(write?.body, undefined);
  assert.deepEqual(unadvertised, { status: "unsupported" });
  assert.deepEqual(unknown, { status: "unsupported" });
  assert.equal(stub.requests.length, observationRequests + 1);
});
