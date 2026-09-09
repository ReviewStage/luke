import assert from "node:assert/strict";
import test from "node:test";
import { SESSION_STATUS } from "@sidecar/session";
import {
  fakeConductorApi,
  LUKE_PROJECT,
  ownedWorkspace,
  TEST_API_KEY,
  TEST_CONDUCTOR_STATUS,
  TEST_SESSION_NAME,
  TEST_TIME,
  TEST_USER_ID,
  type TestSession,
} from "../../../packages/providers/src/testing/conductor-api.js";
import { HTTP_STATUS } from "../../../packages/wire/src/testing/http-fake.js";
import { CLOUD_OBSERVE_FAILURE } from "../server/hosted/cloud-observe";
import { encryptProviderKey } from "../server/hosted/encryption";
import {
  keyedCloudProviderIds,
  observeAndSnapshot,
  storedRoster,
} from "../server/hosted/observation-pass";
import { decodeRosterDiff } from "../server/hosted/roster-diff";
import type { VaultKeyRow } from "../server/hosted/vault-route";
import { memoryObservationStore } from "./support/observation-store";

const SECRET = "a".repeat(64);
const KEY_ROWS: VaultKeyRow[] = [
  { providerId: "conductor", ciphertext: encryptProviderKey(TEST_API_KEY, SECRET) },
];

function sessions(status: string): TestSession[] {
  return [
    {
      id: "session-one",
      workspaceId: "workspace-active",
      name: TEST_SESSION_NAME,
      status,
      statusUpdatedAt: TEST_TIME - 5_000,
    },
  ];
}

function api(status: string = TEST_CONDUCTOR_STATUS.WORKING) {
  return fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-active", TEST_TIME - 30_000)],
    sessions: sessions(status),
  });
}

test("only cloud providers with a stored key are observed", () => {
  assert.deepEqual(keyedCloudProviderIds([]), []);
  assert.deepEqual(
    keyedCloudProviderIds([
      { providerId: "conductor", ciphertext: "c" },
      { providerId: "conductor", ciphertext: "d" },
      { providerId: "linear", ciphertext: "e" },
    ]),
    ["conductor"],
  );
});

test("a whole pass stores the roster with its projects, dated by the pass, and takes no diff against nothing", async () => {
  const store = memoryObservationStore();
  const outcome = await observeAndSnapshot({
    userId: "user-1",
    rows: KEY_ROWS,
    secret: SECRET,
    store,
    seams: { fetch: api().fetch, now: () => TEST_TIME },
    now: TEST_TIME,
  });

  assert.equal(outcome.complete, true);
  assert.equal(outcome.changed, false);
  assert.equal(outcome.observedAt, TEST_TIME);
  const stored = await storedRoster(store, "user-1");
  assert.ok(stored);
  assert.equal(stored.observedAt, TEST_TIME);
  const [provider] = stored.roster.providers;
  assert.equal(provider?.providerId, "conductor");
  assert.equal(provider?.observations[0]?.providerSessionId, "session-one");
  assert.equal(provider?.observations[0]?.status, SESSION_STATUS.WORKING);
  assert.deepEqual(
    provider?.projects.map((project) => project.providerProjectId),
    [LUKE_PROJECT.id],
  );
  assert.deepEqual(await store.roster.pendingDiffs("user-1"), []);
  assert.deepEqual(store.passes.get("user-1"), { attemptedAt: TEST_TIME, observedAt: TEST_TIME });
});

test("a changed roster moves the snapshot and records the diff; an unchanged one moves only the snapshot", async () => {
  const store = memoryObservationStore();
  const pass = (status: string, now: number) =>
    observeAndSnapshot({
      userId: "user-1",
      rows: KEY_ROWS,
      secret: SECRET,
      store,
      seams: { fetch: api(status).fetch, now: () => now },
      now,
    });

  await pass(TEST_CONDUCTOR_STATUS.WORKING, TEST_TIME);
  const same = await pass(TEST_CONDUCTOR_STATUS.WORKING, TEST_TIME + 60_000);
  assert.equal(same.changed, false);
  assert.equal(store.snapshots.get("user-1")?.observedAt, TEST_TIME + 60_000);
  assert.deepEqual(await store.roster.pendingDiffs("user-1"), []);

  const changed = await pass(TEST_CONDUCTOR_STATUS.ERROR, TEST_TIME + 120_000);
  assert.equal(changed.changed, true);
  const [diff] = await store.roster.pendingDiffs("user-1");
  assert.ok(diff);
  assert.equal(diff.observedAt, TEST_TIME + 120_000);
  assert.equal(diff.previousObservedAt, TEST_TIME + 60_000);
  const decoded = decodeRosterDiff(diff.payload);
  assert.equal(decoded?.statusChanged[0]?.from, SESSION_STATUS.WORKING);
  assert.equal(decoded?.statusChanged[0]?.to, SESSION_STATUS.ERROR);
  assert.equal(decoded?.errorChanged.length, 1);
});

test("a pass the provider rate limits past its backoff leaves the previous snapshot standing and is recorded as failed", async () => {
  const store = memoryObservationStore();
  const healthy = api();
  await observeAndSnapshot({
    userId: "user-1",
    rows: KEY_ROWS,
    secret: SECRET,
    store,
    seams: { fetch: healthy.fetch, now: () => TEST_TIME },
    now: TEST_TIME,
  });

  const waits: number[] = [];
  const limited = api(TEST_CONDUCTOR_STATUS.ERROR);
  const outcome = await observeAndSnapshot({
    userId: "user-1",
    rows: KEY_ROWS,
    secret: SECRET,
    store,
    seams: {
      fetch: async (url, init) => {
        const { pathname } = new URL(url);
        if (pathname.endsWith("/status")) {
          return new Response("{}", { status: HTTP_STATUS.TOO_MANY_REQUESTS });
        }
        return limited.fetch(url, init);
      },
      now: () => TEST_TIME + 60_000,
      sleep: async (ms) => {
        waits.push(ms);
      },
    },
    now: TEST_TIME + 60_000,
  });

  assert.equal(outcome.complete, false);
  assert.equal(outcome.failure, CLOUD_OBSERVE_FAILURE.RATE_LIMITED);
  assert.equal(outcome.observedAt, TEST_TIME);
  assert.equal(outcome.roster?.providers[0]?.observations[0]?.status, SESSION_STATUS.WORKING);
  assert.ok(waits.length > 0);
  assert.equal(store.snapshots.get("user-1")?.observedAt, TEST_TIME);
  assert.deepEqual(await store.roster.pendingDiffs("user-1"), []);
  assert.deepEqual(store.passes.get("user-1"), {
    attemptedAt: TEST_TIME + 60_000,
    failure: CLOUD_OBSERVE_FAILURE.RATE_LIMITED,
    observedAt: TEST_TIME,
  });
});

test("a refused key, an unreachable provider, and an unreadable key each fail the pass by name", async () => {
  const store = memoryObservationStore();
  const attempt = (
    rows: VaultKeyRow[],
    fetch: (url: string, init: RequestInit) => Promise<Response>,
  ) =>
    observeAndSnapshot({
      userId: "user-1",
      rows,
      secret: SECRET,
      store,
      seams: { fetch },
      now: TEST_TIME,
    });

  assert.equal(
    (await attempt(KEY_ROWS, async () => new Response("{}", { status: HTTP_STATUS.UNAUTHORIZED })))
      .failure,
    CLOUD_OBSERVE_FAILURE.UNAUTHORIZED,
  );
  assert.equal(
    (
      await attempt(KEY_ROWS, async () => {
        throw new Error("connection refused");
      })
    ).failure,
    CLOUD_OBSERVE_FAILURE.TRANSIENT,
  );
  assert.equal(
    (
      await attempt([{ providerId: "conductor", ciphertext: "not-a-ciphertext" }], async () => {
        throw new Error("no request may be made without a key");
      })
    ).failure,
    CLOUD_OBSERVE_FAILURE.KEY_UNREADABLE,
  );
  assert.equal(store.snapshots.size, 0);
});

test("the attempt is on record as unfinished before the provider is asked, and the outcome replaces it", async () => {
  const store = memoryObservationStore();
  const recorded: Array<{ failure?: string; attemptedAt: number }> = [];
  const recordPass = store.roster.recordPass;
  store.roster.recordPass = async (userId, attempt) => {
    recorded.push({
      attemptedAt: attempt.attemptedAt,
      ...(attempt.failure ? { failure: attempt.failure } : undefined),
    });
    await recordPass(userId, attempt);
  };
  const hanging = new Promise<Response>(() => undefined);
  let asked = false;
  const outcome = observeAndSnapshot({
    userId: "user-1",
    rows: KEY_ROWS,
    secret: SECRET,
    store,
    seams: {
      fetch: () => {
        asked = true;
        return hanging;
      },
    },
    now: TEST_TIME,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(asked, true);
  assert.deepEqual(recorded, [
    { attemptedAt: TEST_TIME, failure: CLOUD_OBSERVE_FAILURE.UNFINISHED },
  ]);
  assert.equal(store.passes.get("user-1")?.failure, CLOUD_OBSERVE_FAILURE.UNFINISHED);
  void outcome;

  const finished = memoryObservationStore();
  await observeAndSnapshot({
    userId: "user-1",
    rows: KEY_ROWS,
    secret: SECRET,
    store: finished,
    seams: { fetch: api().fetch, now: () => TEST_TIME },
    now: TEST_TIME,
  });
  assert.deepEqual(finished.passes.get("user-1"), {
    attemptedAt: TEST_TIME,
    observedAt: TEST_TIME,
  });
});

test("two passes racing over one user record one transition once, and the later one adopts the roster that landed", async () => {
  const store = memoryObservationStore();
  const pass = (status: string, now: number, gate?: Promise<void>) =>
    observeAndSnapshot({
      userId: "user-1",
      rows: KEY_ROWS,
      secret: SECRET,
      store,
      seams: {
        fetch: async (url, init) => {
          await gate;
          return api(status).fetch(url, init);
        },
        now: () => now,
      },
      now,
    });
  await pass(TEST_CONDUCTOR_STATUS.WORKING, TEST_TIME);

  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const slow = pass(TEST_CONDUCTOR_STATUS.ERROR, TEST_TIME + 1_000, held);
  const quick = await pass(TEST_CONDUCTOR_STATUS.ERROR, TEST_TIME + 2_000);
  release();
  const late = await slow;

  assert.equal(quick.changed, true);
  assert.equal(late.complete, true);
  assert.equal(late.changed, false);
  assert.equal(late.observedAt, TEST_TIME + 2_000);
  assert.equal(store.snapshots.get("user-1")?.observedAt, TEST_TIME + 2_000);
  assert.equal((await store.roster.pendingDiffs("user-1")).length, 1);
});

test("a store that cannot take the snapshot is a failed pass, never an unrecorded roster", async () => {
  const store = memoryObservationStore();
  store.roster.advance = async () => {
    throw new Error("disk full");
  };
  const outcome = await observeAndSnapshot({
    userId: "user-1",
    rows: KEY_ROWS,
    secret: SECRET,
    store,
    seams: { fetch: api().fetch, now: () => TEST_TIME },
    now: TEST_TIME,
  });

  assert.equal(outcome.complete, false);
  assert.equal(outcome.failure, CLOUD_OBSERVE_FAILURE.PASS_FAILED);
  assert.equal(store.passes.get("user-1")?.failure, CLOUD_OBSERVE_FAILURE.PASS_FAILED);
});
