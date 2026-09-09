import assert from "node:assert/strict";
import test from "node:test";
import { OBSERVE_QUERY, observeAnswerSchema } from "@sidecar/hosted";
import { SESSION_STATUS } from "@sidecar/session";
import {
  fakeConductorApi,
  LUKE_PROJECT,
  ownedWorkspace,
  TEST_CONDUCTOR_STATUS,
  TEST_SESSION_NAME,
  TEST_TIME,
  TEST_USER_ID,
} from "../../../packages/providers/src/testing/conductor-api.js";
import { encryptProviderKey } from "../server/hosted/encryption";
import { HOSTED_API_ERROR } from "../server/hosted/http";
import { handleObserve, observedSessionForResponse } from "../server/hosted/observe";
import { encodeObservedRoster } from "../server/hosted/observed-roster";
import type { VaultKeyRow } from "../server/hosted/vault-route";
import { memoryObservationStore } from "./support/observation-store";

const SECRET = "a".repeat(64);
const KEY_ROWS: VaultKeyRow[] = [
  { providerId: "conductor", ciphertext: encryptProviderKey("conductor-test-key", SECRET) },
];

function observeRequest(headers: Record<string, string> = {}, fresh = false): Request {
  const url = new URL("https://luke.test/api/observe");
  if (fresh) url.searchParams.set(OBSERVE_QUERY.FRESH, OBSERVE_QUERY.FRESH_VALUE);
  return new Request(url, {
    method: "GET",
    headers: { authorization: "Bearer token-1", ...headers },
  });
}

function observeOptions(
  overrides: Partial<Parameters<typeof handleObserve>[0]> = {},
): Parameters<typeof handleObserve>[0] {
  const store = memoryObservationStore();
  return {
    request: observeRequest(),
    encryptionSecret: SECRET,
    resolveUserId: async () => "user-1",
    readVaultKeys: async (_userId: string): Promise<VaultKeyRow[]> => [],
    store: () => store,
    ...overrides,
  };
}

/** Conductor's fake API with one working chat in one workspace the observed user created. */
function conductorApi(status: string = TEST_CONDUCTOR_STATUS.WORKING) {
  return fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-active", TEST_TIME - 30_000)],
    sessions: [
      {
        id: "session-working",
        workspaceId: "workspace-active",
        name: TEST_SESSION_NAME,
        status,
        statusUpdatedAt: TEST_TIME - 5_000,
      },
    ],
  });
}

// --- Gate checks ---

test("the observe gate order is method, secret, token", async () => {
  const wrongMethod = await handleObserve(
    observeOptions({
      request: new Request("https://luke.test/api/observe", { method: "POST" }),
    }),
  );
  assert.equal(wrongMethod.status, 405);

  const noSecret = await handleObserve(observeOptions({ encryptionSecret: undefined }));
  assert.equal(noSecret.status, 503);
  assert.equal((await noSecret.json()).error, HOSTED_API_ERROR.UNAVAILABLE);

  const blankSecret = await handleObserve(observeOptions({ encryptionSecret: "  " }));
  assert.equal(blankSecret.status, 503);

  const anonymous = await handleObserve(observeOptions({ resolveUserId: async () => undefined }));
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error, HOSTED_API_ERROR.INVALID_TOKEN);
});

// --- No keys → empty roster, and nothing read or stored ---

test("with no vault keys stored the response is 200 with an empty sessions array, and the store is not read", async () => {
  const store = memoryObservationStore();
  store.snapshots.set("user-1", {
    body: encodeObservedRoster({ version: 1, providers: [] }),
    observedAt: TEST_TIME,
  });
  const response = await handleObserve(observeOptions({ store: () => store }));

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { sessions: [] });
});

// --- The stored snapshot is what the endpoint answers ---

test("a user with a snapshot is answered from it, dated, and the provider is not asked", async () => {
  const api = conductorApi();
  const store = memoryObservationStore();
  const seeded = await handleObserve(
    observeOptions({
      readVaultKeys: async () => KEY_ROWS,
      store: () => store,
      fetch: api.fetch,
      now: () => TEST_TIME,
    }),
  );
  assert.equal(seeded.status, 200);
  const seededBody = await seeded.json();
  assert.equal(seededBody.sessions.length, 1);
  assert.equal(seededBody.sessions[0].sessionId, "session-working");
  assert.equal(seededBody.observedAt, TEST_TIME);
  assert.equal(store.snapshots.has("user-1"), true);
  const readsAfterSeeding = api.requests.length;

  const stored = await handleObserve(
    observeOptions({
      readVaultKeys: async () => KEY_ROWS,
      store: () => store,
      fetch: async () => {
        throw new Error("a stored roster is not re-observed");
      },
      now: () => TEST_TIME + 60_000,
    }),
  );
  assert.equal(stored.status, 200);
  const storedBody = await stored.json();
  assert.deepEqual(storedBody, seededBody);
  assert.equal(api.requests.length, readsAfterSeeding);
  assert.equal(observeAnswerSchema.parse(storedBody)?.observedAt, TEST_TIME);
});

test("a fresh read runs the pass again, stores it, and answers the new roster", async () => {
  const store = memoryObservationStore();
  const working = conductorApi();
  await handleObserve(
    observeOptions({
      readVaultKeys: async () => KEY_ROWS,
      store: () => store,
      fetch: working.fetch,
      now: () => TEST_TIME,
    }),
  );

  const idle = conductorApi(TEST_CONDUCTOR_STATUS.IDLE);
  const response = await handleObserve(
    observeOptions({
      request: observeRequest({}, true),
      readVaultKeys: async () => KEY_ROWS,
      store: () => store,
      fetch: idle.fetch,
      now: () => TEST_TIME + 1_000,
    }),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.sessions[0].status, SESSION_STATUS.WAITING);
  assert.equal(body.observedAt, TEST_TIME + 1_000);
  assert.equal(store.snapshots.get("user-1")?.observedAt, TEST_TIME + 1_000);
  assert.equal(store.diffs.get("user-1")?.length, 1);
});

// --- Provider error leaves the previous snapshot standing ---

test("a pass the provider refuses answers what stood before, and stores no roster", async () => {
  const store = memoryObservationStore();
  const api = conductorApi();
  await handleObserve(
    observeOptions({
      readVaultKeys: async () => KEY_ROWS,
      store: () => store,
      fetch: api.fetch,
      now: () => TEST_TIME,
    }),
  );

  const response = await handleObserve(
    observeOptions({
      request: observeRequest({}, true),
      readVaultKeys: async () => KEY_ROWS,
      store: () => store,
      fetch: async () => new Response(null, { status: 401 }),
      now: () => TEST_TIME + 1_000,
    }),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.sessions.length, 1);
  assert.equal(body.observedAt, TEST_TIME);
  assert.equal(store.snapshots.get("user-1")?.observedAt, TEST_TIME);
  assert.equal(store.passes.get("user-1")?.failure, "unauthorized");
});

test("a first pass the provider refuses answers an empty roster and stores none", async () => {
  const store = memoryObservationStore();
  const response = await handleObserve(
    observeOptions({
      readVaultKeys: async () => KEY_ROWS,
      store: () => store,
      fetch: async () => new Response(null, { status: 401 }),
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { sessions: [] });
  assert.equal(store.snapshots.size, 0);
});

// --- Wire contract ---

test("the observe response carries only a validated published-work address", () => {
  const observation = {
    providerSessionId: "sess-change",
    title: "Published work",
    status: SESSION_STATUS.COMPLETE,
    lastActivityAt: Date.parse("2026-09-02T18:00:00.000Z"),
  };

  assert.deepEqual(
    observedSessionForResponse("conductor", {
      ...observation,
      detail: {
        change: "https://github.com/ReviewStage/luke/pull/642",
      },
    }).change,
    "https://github.com/ReviewStage/luke/pull/642",
  );
  const invalid = observedSessionForResponse("conductor", {
    ...observation,
    detail: {
      change: "javascript:alert(1)",
    },
  });
  assert.equal(invalid.change, undefined);
});

test("the observe response carries only an openable session address", () => {
  const observation = {
    providerSessionId: "sess-link",
    title: "Deep-linked chat",
    status: SESSION_STATUS.WORKING,
    lastActivityAt: Date.parse("2026-09-02T18:00:00.000Z"),
  };

  assert.equal(
    observedSessionForResponse("conductor", {
      ...observation,
      detail: {
        link: "conductor://workspace?id=ws-1&session=sess-link",
      },
    }).link,
    "conductor://workspace?id=ws-1&session=sess-link",
  );
  const invalid = observedSessionForResponse("conductor", {
    ...observation,
    detail: {
      link: "javascript:alert(1)",
    },
  });
  assert.equal(invalid.link, undefined);
});

test("the last activity travels under both its name and the legacy one, and is read from either", () => {
  const lastActivityAt = Date.parse("2026-09-02T18:00:00.000Z");
  const wire = observedSessionForResponse("conductor", {
    providerSessionId: "sess-dated",
    title: "Dated",
    status: SESSION_STATUS.WORKING,
    lastActivityAt,
    detail: {},
  });
  assert.equal(wire.lastActivityAt, lastActivityAt);
  assert.equal(wire.observedAt, lastActivityAt);

  const renamed = observeAnswerSchema.parse({
    sessions: [
      {
        providerId: "conductor",
        sessionId: "s",
        title: "T",
        status: "working",
        lastActivityAt: 2_000,
        observedAt: 1_000,
      },
    ],
  });
  assert.equal(renamed?.sessions[0]?.lastActivityAt, 2_000);
  // A service still sending only the old name dates the session the same way.
  const legacy = observeAnswerSchema.parse({
    sessions: [
      { providerId: "conductor", sessionId: "s", title: "T", status: "working", observedAt: 1_000 },
    ],
  });
  assert.equal(legacy?.sessions[0]?.lastActivityAt, 1_000);
});

test("an observe answer accepts a valid answer", () => {
  const raw = {
    sessions: [
      {
        providerId: "conductor",
        sessionId: "sess-1",
        title: "My PR",
        status: "working",
        workspace: "my-repo",
        branch: "main",
        change: "https://github.com/ReviewStage/luke/pull/642",
        link: "conductor://workspace?id=ws-1&session=sess-1",
      },
    ],
  };
  const answer = observeAnswerSchema.parse(JSON.parse(JSON.stringify(raw)));
  assert.ok(answer);
  assert.equal(answer.sessions.length, 1);
  assert.equal(answer.sessions[0]?.providerId, "conductor");
  assert.equal(answer.sessions[0]?.title, "My PR");
  assert.equal(answer.sessions[0]?.status, "working");
  assert.equal(answer.sessions[0]?.workspace, "my-repo");
  assert.equal(answer.sessions[0]?.change, "https://github.com/ReviewStage/luke/pull/642");
  assert.equal(answer.sessions[0]?.link, "conductor://workspace?id=ws-1&session=sess-1");
});

test("an observe answer drops a published-work address that is not HTTPS", () => {
  const answer = observeAnswerSchema.parse({
    sessions: [
      {
        providerId: "conductor",
        sessionId: "sess-change",
        title: "Published work",
        status: "complete",
        change: "javascript:alert(1)",
      },
    ],
  });

  assert.equal(answer?.sessions[0]?.change, undefined);
});

test("an observe answer drops a session address outside the openable schemes", () => {
  const answer = observeAnswerSchema.parse({
    sessions: [
      {
        providerId: "conductor",
        sessionId: "sess-link",
        title: "Deep-linked chat",
        status: "working",
        link: "javascript:alert(1)",
      },
    ],
  });

  assert.equal(answer?.sessions[0]?.link, undefined);
});

test("an observe answer skips malformed session entries rather than failing", () => {
  const raw = {
    sessions: [
      { providerId: "conductor", sessionId: "good", title: "OK", status: "complete" },
      { providerId: "conductor" }, // missing required fields
      null,
    ],
  };
  const answer = observeAnswerSchema.parse(JSON.parse(JSON.stringify(raw)));
  assert.ok(answer);
  // Only the well-formed entry survives.
  assert.equal(answer.sessions.length, 1);
  assert.equal(answer.sessions[0]?.sessionId, "good");
});

test("an observe answer rejects an unknown status value", () => {
  const raw = {
    sessions: [
      {
        providerId: "conductor",
        sessionId: "sess-2",
        title: "Conductor chat",
        status: "running", // not a known SessionStatus
      },
    ],
  };
  const answer = observeAnswerSchema.parse(JSON.parse(JSON.stringify(raw)));
  // The malformed entry is skipped; the answer still exists with zero sessions.
  assert.ok(answer);
  assert.equal(answer.sessions.length, 0);
});

test("an observe answer carries the action advertisements and bounds them", () => {
  const raw = {
    sessions: [
      {
        providerId: "conductor",
        sessionId: "sess-3",
        title: "Conductor chat",
        status: "waiting",
        canReceiveMessage: true,
        controls: [
          { id: "approve-plan", label: "Approve the plan" },
          { id: "cancel-turn", label: "Stop", kind: "stop" },
          { id: "", label: "nameless" }, // malformed: skipped
          { id: "no-label" }, // malformed: skipped
        ],
        spawnableAgents: ["claude", "codex", ""],
        canRename: true,
        canRenameWorkspace: "yes", // not a boolean: dropped
      },
    ],
  };
  const answer = observeAnswerSchema.parse(JSON.parse(JSON.stringify(raw)));
  assert.ok(answer);
  const session = answer.sessions[0];
  assert.ok(session);
  assert.equal(session.canReceiveMessage, true);
  assert.deepEqual(session.controls, [
    { id: "approve-plan", label: "Approve the plan" },
    { id: "cancel-turn", label: "Stop", kind: "stop" },
  ]);
  assert.deepEqual(session.spawnableAgents, ["claude", "codex"]);
  assert.equal(session.canRename, true);
  assert.equal(session.canRenameWorkspace, undefined);
});

test("an observe answer returns undefined for a non-object", () => {
  assert.equal(observeAnswerSchema.parse("not an object"), undefined);
  assert.equal(observeAnswerSchema.parse(null), undefined);
  assert.equal(observeAnswerSchema.parse(42), undefined);
});

test("an observe answer returns undefined when sessions is not an array", () => {
  assert.equal(
    observeAnswerSchema.parse(JSON.parse(JSON.stringify({ sessions: "wrong" }))),
    undefined,
  );
  assert.equal(observeAnswerSchema.parse(JSON.parse(JSON.stringify({}))), undefined);
});

// --- User id is passed through ---

test("readVaultKeys is called with the resolved user id", async () => {
  let calledWithUserId: string | undefined;

  await handleObserve(
    observeOptions({
      resolveUserId: async () => "user-xyz",
      readVaultKeys: async (userId) => {
        calledWithUserId = userId;
        return [];
      },
    }),
  );

  assert.equal(calledWithUserId, "user-xyz");
});

// --- Rate brake ---

test("fresh reads return 429 after too many in the same window, while stored reads are not braked", async () => {
  // now() stays fixed so all calls land in the same window.
  const now = () => 1_000_000;
  // A userId unique to this test run avoids cross-test pollution of the module-level counter.
  const userId = `ratelimit-${Date.now()}-${process.pid}`;
  const store = memoryObservationStore();
  const api = conductorApi();
  const fresh = () =>
    observeOptions({
      request: observeRequest({}, true),
      resolveUserId: async () => userId,
      readVaultKeys: async () => KEY_ROWS,
      store: () => store,
      fetch: api.fetch,
      now,
    });

  // MAX_REQUESTS_PER_WINDOW is 10; the 11th should be rate-limited.
  for (let i = 0; i < 10; i++) {
    const res = await handleObserve(fresh());
    assert.equal(res.status, 200, `request ${i + 1} should succeed`);
  }

  const limited = await handleObserve(fresh());
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error, HOSTED_API_ERROR.QUOTA_EXHAUSTED);

  const stored = await handleObserve(
    observeOptions({
      resolveUserId: async () => userId,
      readVaultKeys: async () => KEY_ROWS,
      store: () => store,
      now,
    }),
  );
  assert.equal(stored.status, 200);
});
