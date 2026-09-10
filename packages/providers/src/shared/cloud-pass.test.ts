import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTION_KIND,
  ACTION_RESULT_STATUS,
  type ActionInput,
  type AdvertisedControl,
  agedStatus,
  dispatchAction,
  OBSERVATION_WINDOW,
  type ProviderSessionObservation,
  SESSION_LOCATION,
  SESSION_STATUS,
  UNSUPPORTED_BY_OBSERVATION,
} from "@sidecar/session";
import { type CloudFetch, isWireString } from "@sidecar/wire";
import { admittedForTest, HTTP_STATUS, jsonResponse, recordingFetch } from "@sidecar/wire/testing";
import { ADAPTER_DIAGNOSTIC_KIND, type AdapterDiagnosticCallback } from "./adapter-diagnostics.js";
import { ADAPTER_FAILURE } from "./adapter-failure.js";
import { type CloudPass, type CloudSessionPlugin, cloudPass } from "./cloud-pass.js";
import {
  backoffBudget,
  CLOUD_ADAPTER_DEFAULTS,
  type CloudWriteRoute,
  isDefined,
  knownValue,
  RATE_LIMIT_BACKOFF,
  rateLimitDelayMs,
  requestDeadlineMs,
} from "./cloud-wire.js";

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
    lastActivityAt: TEST_TIME,
    ...overrides,
  };
}

const STUB_APPROVE_CONTROL = {
  kind: ACTION_KIND.CONTROL,
  id: "approve",
  label: "Approve",
} as const;

/** An action whose provider answers only once it is done, on its route's own deadline. */
const STUB_SLOW_ACTION_CONTROL = {
  kind: ACTION_KIND.CONTROL,
  id: "file-away",
  label: "File away",
} as const;
/** Short enough for a test to overrun; what matters is that it is the route's own. */
const STUB_SLOW_ACTION_DEADLINE_MS = 25;

/**
 * Stands in for a real provider so the shared cloud pass can be tested on its
 * own: one plugin over `cloudPass`, with the two actions a provider routes and
 * the counters a test reads.
 */
type StubCloudPlugin = CloudSessionPlugin & {
  readonly passes: number;
  readonly forgottenIdentities: number;
  collected: readonly ProviderSessionObservation[];
  collectError: Error | undefined;
};

/** What one stub plugin's pass records for a test to read back. */
interface StubState {
  passes: number;
  forgottenIdentities: number;
  collected: readonly ProviderSessionObservation[];
  collectError: Error | undefined;
}

interface StubOptions {
  apiKey?: string | undefined;
  readApiKey?: () => Promise<string | undefined>;
  now?: () => number;
  minimumRefreshIntervalMs?: number;
  onDiagnostic?: AdapterDiagnosticCallback;
  requestHeaders?: Readonly<Record<string, string>>;
  sleep?: (ms: number) => Promise<void>;
  /** Observes and routes nothing: a provider whose actions are all absent. */
  routesNothing?: boolean;
}

function stubPluginFor(fetch: CloudFetch, overrides: StubOptions = {}): StubCloudPlugin {
  const apiKey = "apiKey" in overrides ? overrides.apiKey : TEST_API_KEY;
  const state: StubState = {
    passes: 0,
    forgottenIdentities: 0,
    collected: [],
    collectError: undefined,
  };

  const pass: CloudPass = cloudPass({
    provider: STUB_PROVIDER,
    defaultBaseUrl: TEST_BASE_URL,
    ...(overrides.requestHeaders ? { requestHeaders: overrides.requestHeaders } : undefined),
    readApiKey: overrides.readApiKey ?? (async () => apiKey),
    baseUrl: TEST_BASE_URL,
    fetch,
    now: overrides.now ?? (() => TEST_TIME),
    minimumRefreshIntervalMs: overrides.minimumRefreshIntervalMs ?? 0,
    ...(overrides.onDiagnostic ? { onDiagnostic: overrides.onDiagnostic } : undefined),
    ...(overrides.sleep ? { sleep: overrides.sleep } : undefined),
    forget: () => {
      state.forgottenIdentities += 1;
    },
    async collect(request, now) {
      if (overrides.routesNothing) return [];
      state.passes += 1;
      if (state.collectError) throw state.collectError;
      await request(["v0", "sessions", "id with/slash"], { limit: "2" });
      return state.collected.map((candidate) => ({
        ...candidate,
        status: agedStatus(
          candidate.status,
          candidate.lastActivityAt,
          now,
          OBSERVATION_WINDOW.ACTIVE_SESSION_FRESHNESS_MS,
        ),
      }));
    },
  });

  const write = async (route: CloudWriteRoute) => {
    const key = await pass.readApiKey();
    if (!key) {
      return {
        status: ACTION_RESULT_STATUS.REJECTED,
        reason: `${STUB_PROVIDER.displayName}'s API key is no longer configured.`,
      } as const;
    }
    return (await pass.write(key, route)).outcome;
  };

  return {
    provider: STUB_PROVIDER,
    observe: () => pass.run(),
    latest: () => pass.latest(),
    lastObservationFailure: () => pass.lastFailure(),
    get passes() {
      return state.passes;
    },
    get forgottenIdentities() {
      return state.forgottenIdentities;
    },
    get collected() {
      return state.collected;
    },
    set collected(value: readonly ProviderSessionObservation[]) {
      state.collected = value;
    },
    get collectError() {
      return state.collectError;
    },
    set collectError(value: Error | undefined) {
      state.collectError = value;
    },
    ...(overrides.routesNothing
      ? undefined
      : {
          actions: {
            message: ({ request, observation }: ActionInput<{ readonly text: string }>) =>
              write({
                segments: ["v0", "sessions", observation.providerSessionId],
                action: "sendMessage",
                body: { prompt: request.text },
              }),
            control: ({
              request,
              observation,
            }: ActionInput<{ readonly control: AdvertisedControl }>) => {
              const { control } = request;
              if (control.id === STUB_SLOW_ACTION_CONTROL.id) {
                return write({
                  segments: ["v0", "sessions", observation.providerSessionId, "file-away"],
                  timeoutMs: STUB_SLOW_ACTION_DEADLINE_MS,
                });
              }
              if (control.id !== STUB_APPROVE_CONTROL.id) {
                return Promise.resolve({
                  status: ACTION_RESULT_STATUS.UNSUPPORTED,
                  reason: UNSUPPORTED_BY_OBSERVATION,
                });
              }
              return write({
                segments: ["v0", "sessions", observation.providerSessionId, "approve"],
              });
            },
          },
        }),
  };
}

test("answers unsupported explicitly when no observed route exists", async () => {
  // A provider that routes a message and one whose actions are all absent answer
  // the same way for a session no pass reported: what the observation does
  // not hold, no handler is reached for.
  const routed = stubPluginFor(stubFetch().fetch);
  const observesOnly = stubPluginFor(stubFetch().fetch, { routesNothing: true });
  for (const plugin of [routed, observesOnly]) {
    assert.deepEqual(
      await dispatchAction(
        plugin,
        "message",
        admittedForTest({ providerSessionId: "missing", text: "hello" }),
      ),
      {
        status: ACTION_RESULT_STATUS.UNSUPPORTED,
        reason: UNSUPPORTED_BY_OBSERVATION,
      },
    );
    assert.deepEqual(plugin.projects?.() ?? [], []);
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
  const plugin = stubPluginFor(stub.fetch);
  plugin.collected = [observation("session-one")];

  const observations = await plugin.observe();

  assert.equal(plugin.provider.id, "stub");
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

test("lets a provider pin its own request headers without touching the credential", async () => {
  const { fetch, requests } = recordingFetch(() => jsonResponse({}));
  const plugin = stubPluginFor(fetch, {
    requestHeaders: { Accept: "application/vnd.stub+json", "X-Stub-Api-Version": "2026-03-10" },
  });

  await plugin.observe();

  const [request] = requests;
  assert.ok(request);
  assert.equal(request.accept, "application/vnd.stub+json");
  assert.equal(request.headers.get("x-stub-api-version"), "2026-03-10");
  assert.equal(request.authorization, `Bearer ${TEST_API_KEY}`);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("reports every session it serves as running in the cloud", async () => {
  const stub = stubFetch();
  const plugin = stubPluginFor(stub.fetch);
  // Neither observation says where it runs: the base knows, because nothing
  // reaches it except over the network.
  plugin.collected = [observation("session-one"), observation("session-two")];

  const observations = await plugin.observe();

  assert.deepEqual(
    observations.map((candidate) => candidate.location),
    [SESSION_LOCATION.CLOUD, SESSION_LOCATION.CLOUD],
  );
});

test("drops a session a subclass reported twice in one pass", async () => {
  const stub = stubFetch();
  const plugin = stubPluginFor(stub.fetch);
  plugin.collected = [
    observation("session-repeated", { status: SESSION_STATUS.WORKING }),
    observation("session-repeated", { status: SESSION_STATUS.COMPLETE }),
    observation("session-other"),
  ];

  const observations = await plugin.observe();

  assert.deepEqual(
    observations.map((candidate) => candidate.providerSessionId),
    ["session-repeated", "session-other"],
  );
  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
});

test("leaves a stopped session unknown once its timestamp goes stale", async () => {
  const stub = stubFetch();
  const plugin = stubPluginFor(stub.fetch);
  plugin.collected = [
    observation("session-recent", { lastActivityAt: TEST_TIME - 60_000 }),
    observation("session-stale", { lastActivityAt: TEST_TIME - 60 * 60 * 1000 }),
  ];

  const observations = await plugin.observe();

  assert.equal(observations[0]?.status, SESSION_STATUS.WAITING);
  assert.equal(observations[1]?.status, SESSION_STATUS.UNKNOWN);
});

test("forgets cached identity when the credential changes, and reports nothing without one", async () => {
  const stub = stubFetch();
  let apiKey: string | undefined = TEST_API_KEY;
  const plugin = stubPluginFor(stub.fetch, { readApiKey: async () => apiKey });
  plugin.collected = [observation("session-one")];

  await plugin.observe();
  apiKey = "replacement-key";
  const afterRotation = await plugin.observe();
  apiKey = undefined;
  const afterRemoval = await plugin.observe();

  assert.equal(plugin.passes, 2, "the replacement key did not trigger a pass");
  assert.equal(afterRotation.length, 1);
  assert.equal(stub.requests.at(-1)?.authorization, "Bearer replacement-key");
  assert.deepEqual(afterRemoval, []);
  // Once when the first key was accepted, once for the rotation, once when the
  // credential was removed.
  assert.equal(plugin.forgottenIdentities, 3);
});

test("clears observations when the provider rejects the credential", async () => {
  let rejectRequests = false;
  const diagnostics: unknown[] = [];
  const stub = stubFetch(() => (rejectRequests ? HTTP_STATUS.UNAUTHORIZED : HTTP_STATUS.OK));
  const plugin = stubPluginFor(stub.fetch, {
    onDiagnostic: (kind, error) => diagnostics.push([kind, error]),
  });
  plugin.collected = [observation("session-one")];

  const authorized = await plugin.observe();
  rejectRequests = true;
  const rejected = await plugin.observe();

  assert.equal(authorized.length, 1);
  assert.deepEqual(rejected, []);
  // Once when the key was accepted, once when the provider rejected it.
  assert.equal(plugin.forgottenIdentities, 2);
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
function accountBoundPlugin(options: {
  readApiKey: () => Promise<string | undefined>;
  fetch: CloudFetch;
  minimumRefreshIntervalMs: number;
}) {
  return cloudPass({
    provider: STUB_PROVIDER,
    defaultBaseUrl: TEST_BASE_URL,
    baseUrl: TEST_BASE_URL,
    now: () => TEST_TIME,
    ...options,
    async collect(request) {
      const first = await request(["sessions", "first"]);
      const second = await request(["sessions", "second"]);
      return [first, second]
        .map((body) => {
          const session = body.session;
          if (!isWireString(session)) return undefined;
          return observation(session);
        })
        .filter(isDefined);
    },
  });
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
  const plugin = accountBoundPlugin({
    readApiKey: async () => apiKey,
    fetch,
    minimumRefreshIntervalMs: 0,
  });

  const stalePass = plugin.run();
  apiKey = "second-key";
  const freshObservations = await plugin.run();
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
  const plugin = accountBoundPlugin({
    readApiKey: async () => apiKey,
    fetch,
    minimumRefreshIntervalMs: 60_000,
  });

  const stalePass = plugin.run();
  apiKey = "second-key";
  await plugin.run();
  oldKeyRequest.resolve();
  const staleObservations = await stalePass;
  // Inside the refresh interval this serves the cache, which is exactly where
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // a wrongly cleared snapshot would surface as vanished rows.
  const cachedObservations = await plugin.run();

  assert.deepEqual(sessionIds(staleObservations), [NEW_ACCOUNT_SESSION]);
  assert.deepEqual(sessionIds(cachedObservations), [NEW_ACCOUNT_SESSION]);
});

test("a transient provider failure keeps the previous snapshot", async () => {
  let status: number = HTTP_STATUS.OK;
  const diagnostics: unknown[] = [];
  const stub = stubFetch(() => status);
  const plugin = stubPluginFor(stub.fetch, {
    onDiagnostic: (kind, error) => diagnostics.push([kind, error]),
  });
  plugin.collected = [observation("session-one")];

  const first = await plugin.observe();
  status = 500;
  const second = await plugin.observe();

  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(second[0]?.providerSessionId, "session-one");
  assert.deepEqual(diagnostics, []);
});

test("a programming error during observation is reported rather than swallowed", async () => {
  const diagnostics: unknown[] = [];
  let now = TEST_TIME;
  const stub = stubFetch();
  const plugin = stubPluginFor(stub.fetch, {
    now: () => now,
    minimumRefreshIntervalMs: 60_000,
    onDiagnostic: (kind, error) => diagnostics.push([kind, error]),
  });
  plugin.collected = [observation("session-one")];

  const first = await plugin.observe();
  now += 60_000;
  const bug = new TypeError("sessions is not iterable");
  plugin.collectError = bug;

  await assert.rejects(() => plugin.observe(), bug);
  assert.deepEqual(diagnostics, [[ADAPTER_DIAGNOSTIC_KIND.PASS_FAILURE, bug]]);

  plugin.collectError = undefined;
  const cached = await plugin.observe();
  assert.equal(first.length, 1);
  assert.equal(cached.length, 1);
  assert.equal(cached[0]?.providerSessionId, "session-one");
  // The interval has not elapsed, so the snapshot the programming error failed
  // to replace is still served rather than collected again.
  assert.equal(plugin.passes, 2);
});

test("issues no request at all when the credential cannot be read", async () => {
  const stub = stubFetch();
  const plugin = stubPluginFor(stub.fetch, {
    readApiKey: async () => {
      throw new Error("settings are unreadable");
    },
  });
  plugin.collected = [observation("session-one")];

  assert.deepEqual(await plugin.observe(), []);
  assert.deepEqual(stub.requests, []);
  assert.equal(plugin.passes, 0);
});

test("sends a user message through the route and body the provider documents", async () => {
  const stub = stubFetch();
  const plugin = stubPluginFor(stub.fetch);
  plugin.collected = [observation("session-one", { advertises: [{ kind: ACTION_KIND.MESSAGE }] })];
  await plugin.observe();

  const result = await dispatchAction(
    plugin,
    "message",
    admittedForTest({ providerSessionId: "session-one", text: "go on" }),
  );

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

test("refuses to send once the credential is gone, whatever was observed with it", async () => {
  const stub = stubFetch();
  let apiKey: string | undefined = TEST_API_KEY;
  const plugin = stubPluginFor(stub.fetch, { readApiKey: async () => apiKey });
  plugin.collected = [observation("session-one", { advertises: [{ kind: ACTION_KIND.MESSAGE }] })];
  await plugin.observe();
  const observationRequests = stub.requests.length;

  apiKey = undefined;
  const result = await dispatchAction(
    plugin,
    "message",
    admittedForTest({ providerSessionId: "session-one", text: "go on" }),
  );

  // A refusal with the actual reason, not "unsupported": the session
  // advertised taking messages while a key stood behind it, and a key that has
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // since gone must not be reported as the session having moved on.
  assert.equal(result.status, "rejected");
  assert.equal(stub.requests.length, observationRequests);
});

test("reports what became of a send the provider refused", async () => {
  let status: number = HTTP_STATUS.OK;
  const stub = stubFetch(() => status);
  const plugin = stubPluginFor(stub.fetch);
  plugin.collected = [observation("session-one", { advertises: [{ kind: ACTION_KIND.MESSAGE }] })];
  await plugin.observe();
  const message = { providerSessionId: "session-one", text: "go on" };

  status = HTTP_STATUS.UNAUTHORIZED;
  const unauthorized = await dispatchAction(plugin, "message", admittedForTest(message));
  status = HTTP_STATUS.NOT_FOUND;
  const missing = await dispatchAction(plugin, "message", admittedForTest(message));
  status = HTTP_STATUS.CONFLICT;
  const conflicted = await dispatchAction(plugin, "message", admittedForTest(message));
  status = HTTP_STATUS.SERVER_ERROR;
  const failed = await dispatchAction(plugin, "message", admittedForTest(message));

  assert.equal(unauthorized.status, "rejected");
  assert.equal(missing.status, "rejected");
  assert.equal(conflicted.status, "rejected");
  assert.equal(failed.status, "rejected");
});

test("reports an unanswered send as indeterminate and makes the next refresh ask", async () => {
  let failWrites = false;
  const { fetch } = recordingFetch((request) => {
    if (failWrites && request.method === "POST") throw new Error("connection reset");
    return jsonResponse({});
  });
  const plugin = stubPluginFor(fetch, { minimumRefreshIntervalMs: 60_000 });
  plugin.collected = [observation("session-one", { advertises: [{ kind: ACTION_KIND.MESSAGE }] })];
  await plugin.observe();

  failWrites = true;
  const result = await dispatchAction(
    plugin,
    "message",
    admittedForTest({ providerSessionId: "session-one", text: "go on" }),
  );

  // A thrown fetch cannot say whether the request landed — the provider may
  // have taken it and only the answer was lost — so the refusal must hedge
  // rather than claim nothing was sent.
  assert.equal(result.status, "rejected");
  // And because it may have landed, the next refresh asks the provider
  // instead of serving the cache for the rest of the interval.
  await plugin.observe();
  assert.equal(plugin.passes, 2);
});

test("a write answered with an unnamed status makes the next refresh ask", async () => {
  let status: number = HTTP_STATUS.OK;
  const stub = stubFetch(() => status);
  const plugin = stubPluginFor(stub.fetch, { minimumRefreshIntervalMs: 60_000 });
  plugin.collected = [observation("session-one", { advertises: [{ kind: ACTION_KIND.MESSAGE }] })];
  await plugin.observe();

  status = HTTP_STATUS.SERVER_ERROR;
  const result = await dispatchAction(
    plugin,
    "message",
    admittedForTest({ providerSessionId: "session-one", text: "go on" }),
  );

  assert.equal(result.status, "rejected");
  // A gateway that gave up may stand in front of a write that finished, so
  // the cache must not keep advertising what the provider may have taken.
  await plugin.observe();
  assert.equal(plugin.passes, 2);
});

test("a write runs on the deadline its own route asked for", async () => {
  const { fetch } = recordingFetch((request) => {
    if (request.method !== "POST") return jsonResponse({});
    // An action still in progress at the deadline: the response arrives only as
    // the refusal the route's own signal raises.
    return new Promise((_resolve, reject) => {
      request.init.signal?.addEventListener("abort", () => reject(new Error("deadline")));
    });
  });
  const plugin = stubPluginFor(fetch, { minimumRefreshIntervalMs: 60_000 });
  plugin.collected = [observation("session-slow", { advertises: [STUB_SLOW_ACTION_CONTROL] })];
  await plugin.observe();

  const startedAt = performance.now();
  const result = await dispatchAction(
    plugin,
    "control",
    admittedForTest({
      providerSessionId: "session-slow",
      control: STUB_SLOW_ACTION_CONTROL,
    }),
  );

  assert.equal(result.status, "rejected");
  // Refused by the route's own short deadline, not the shared bound: waiting
  // out the shared bound here would mean the route's ask never reached the
  // request.
  assert.ok(performance.now() - startedAt < CLOUD_ADAPTER_DEFAULTS.REQUEST_TIMEOUT_MS / 2);
  // The action may have finished behind the lost answer, so the next refresh
  // asks the provider instead of serving the cache.
  await plugin.observe();
  assert.equal(plugin.passes, 2);
});

test("no route can widen a request past the slow bound", () => {
  assert.equal(requestDeadlineMs(undefined), CLOUD_ADAPTER_DEFAULTS.REQUEST_TIMEOUT_MS);
  assert.equal(
    requestDeadlineMs(CLOUD_ADAPTER_DEFAULTS.SLOW_REQUEST_TIMEOUT_MS),
    CLOUD_ADAPTER_DEFAULTS.SLOW_REQUEST_TIMEOUT_MS,
  );
  assert.equal(
    requestDeadlineMs(Number.MAX_SAFE_INTEGER),
    CLOUD_ADAPTER_DEFAULTS.SLOW_REQUEST_TIMEOUT_MS,
  );
});

test("runs an advertised control through its documented route, sending no body", async () => {
  const stub = stubFetch();
  const plugin = stubPluginFor(stub.fetch);
  plugin.collected = [
    observation("session-plan", { advertises: [STUB_APPROVE_CONTROL] }),
    observation("session-quiet"),
  ];
  await plugin.observe();
  const observationRequests = stub.requests.length;

  const approved = await dispatchAction(
    plugin,
    "control",
    admittedForTest({
      providerSessionId: "session-plan",
      control: STUB_APPROVE_CONTROL,
    }),
  );
  const unadvertised = await dispatchAction(
    plugin,
    "control",
    admittedForTest({
      providerSessionId: "session-quiet",
      control: STUB_APPROVE_CONTROL,
    }),
  );
  const unknown = await dispatchAction(
    plugin,
    "control",
    admittedForTest({
      providerSessionId: "session-plan",
      control: { kind: ACTION_KIND.CONTROL, id: "terminate", label: "Terminate" },
    }),
  );

  assert.deepEqual(approved, { status: "accepted" });
  const write = stub.requests.at(-1);
  assert.equal(write?.url, `${TEST_BASE_URL}/v0/sessions/session-plan/approve`);
  assert.equal(write?.method, "POST");
  // An endpoint that documents an empty request gets exactly that.
  assert.equal(write?.contentType, undefined);
  assert.equal(write?.body, undefined);
  assert.deepEqual(unadvertised, {
    status: "unsupported",
    reason: UNSUPPORTED_BY_OBSERVATION,
  });
  assert.deepEqual(unknown, {
    status: "unsupported",
    reason: UNSUPPORTED_BY_OBSERVATION,
  });
  assert.equal(stub.requests.length, observationRequests + 1);
});

/** A fetch that answers 429 for the first `limited` reads and 200 after, recording every call. */
function rateLimitedFetch(limited: number, retryAfter?: string) {
  let answered = 0;
  return recordingFetch(() => {
    answered += 1;
    if (answered <= limited) {
      return new Response("{}", {
        status: HTTP_STATUS.TOO_MANY_REQUESTS,
        headers: retryAfter === undefined ? {} : { "retry-after": retryAfter },
      });
    }
    return jsonResponse({});
  });
}

test("a 429 is retried on a doubling wait and the pass completes once the provider answers", async () => {
  const waits: number[] = [];
  const stub = rateLimitedFetch(2);
  const plugin = stubPluginFor(stub.fetch, {
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
  plugin.collected = [observation("session-one")];

  const observations = await plugin.observe();

  assert.equal(observations.length, 1);
  assert.equal(stub.requests.length, 3);
  assert.deepEqual(waits, [
    RATE_LIMIT_BACKOFF.INITIAL_DELAY_MS,
    RATE_LIMIT_BACKOFF.INITIAL_DELAY_MS * 2,
  ]);
  assert.equal(plugin.lastObservationFailure(), undefined);
});

test("a Retry-After in seconds is honoured in place of the doubled wait", async () => {
  const waits: number[] = [];
  const stub = rateLimitedFetch(1, "3");
  const plugin = stubPluginFor(stub.fetch, {
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
  plugin.collected = [observation("session-one")];

  await plugin.observe();

  assert.deepEqual(waits, [3_000]);
});

test("a rate limit that outlasts the backoff ends the pass as rate limited and keeps the previous snapshot", async () => {
  const waits: number[] = [];
  let limited = 0;
  const stub = recordingFetch(() =>
    limited > 0 ? new Response("{}", { status: HTTP_STATUS.TOO_MANY_REQUESTS }) : jsonResponse({}),
  );
  const plugin = stubPluginFor(stub.fetch, {
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
  plugin.collected = [observation("session-one")];
  const first = await plugin.observe();
  assert.equal(first.length, 1);

  limited = 1;
  const requestsBefore = stub.requests.length;
  const second = await plugin.observe();

  assert.deepEqual(sessionIds(second), ["session-one"]);
  assert.equal(plugin.lastObservationFailure(), ADAPTER_FAILURE.RATE_LIMITED);
  assert.equal(stub.requests.length - requestsBefore, RATE_LIMIT_BACKOFF.MAXIMUM_RETRIES + 1);
  assert.deepEqual(waits, [500, 1_000, 2_000, 4_000]);
  assert.equal(plugin.forgottenIdentities, 1);
});

test("a Retry-After past a single wait's maximum gives the request up at once", async () => {
  const waits: number[] = [];
  const stub = rateLimitedFetch(1, String(RATE_LIMIT_BACKOFF.MAXIMUM_DELAY_MS / 1000 + 1));
  const plugin = stubPluginFor(stub.fetch, {
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
  plugin.collected = [observation("session-one")];

  await plugin.observe();

  assert.deepEqual(waits, []);
  assert.equal(stub.requests.length, 1);
  assert.equal(plugin.lastObservationFailure(), ADAPTER_FAILURE.RATE_LIMITED);
});

test("the backoff budget is the pass's, spent by every request in it", () => {
  const budget = backoffBudget();
  const wait = (attempt: number) =>
    rateLimitDelayMs({ attempt, retryAfter: null, budget, now: TEST_TIME });
  let spent = 0;
  for (const delay of [wait(0), wait(1), wait(2), wait(3)]) {
    assert.ok(delay !== undefined);
    budget.spentMs += delay;
    spent += delay;
  }
  assert.equal(spent, 7_500);
  // Another leg of the same pass starts its own doubling but draws on the same ceiling.
  budget.spentMs = RATE_LIMIT_BACKOFF.PASS_CEILING_MS - 100;
  assert.equal(wait(0), undefined);
  assert.equal(
    rateLimitDelayMs({
      attempt: RATE_LIMIT_BACKOFF.MAXIMUM_RETRIES,
      retryAfter: null,
      budget: backoffBudget(),
      now: TEST_TIME,
    }),
    undefined,
  );
  const dated = new Date(TEST_TIME + 2_000).toUTCString();
  assert.equal(
    rateLimitDelayMs({ attempt: 0, retryAfter: dated, budget: backoffBudget(), now: TEST_TIME }),
    2_000,
  );
  assert.equal(
    rateLimitDelayMs({ attempt: 0, retryAfter: "soon", budget: backoffBudget(), now: TEST_TIME }),
    RATE_LIMIT_BACKOFF.INITIAL_DELAY_MS,
  );
});

test("a pass with no credential reports it has nothing to observe with, and a whole pass reports no failure", async () => {
  const stub = stubFetch();
  const keyed = stubPluginFor(stub.fetch);
  keyed.collected = [observation("session-one")];
  await keyed.observe();
  assert.equal(keyed.lastObservationFailure(), undefined);

  const keyless = stubPluginFor(stub.fetch, { apiKey: undefined });
  await keyless.observe();
  assert.equal(keyless.lastObservationFailure(), ADAPTER_FAILURE.UNAVAILABLE);

  let status: number = HTTP_STATUS.OK;
  const failing = stubPluginFor(stubFetch(() => status).fetch);
  failing.collected = [observation("session-one")];
  await failing.observe();
  status = HTTP_STATUS.SERVER_ERROR;
  await failing.observe();
  assert.equal(failing.lastObservationFailure(), ADAPTER_FAILURE.TRANSIENT);
  status = HTTP_STATUS.UNAUTHORIZED;
  await failing.observe();
  assert.equal(failing.lastObservationFailure(), ADAPTER_FAILURE.UNAUTHORIZED);
});
