import assert from "node:assert/strict";
import { SESSION_STATUS } from "@sidecar/session";
import { Effect } from "effect";
import { test } from "vitest";
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
  keyFingerprint,
  observeAndSnapshot,
  storedRoster,
} from "../server/hosted/observation-pass";
import type { VaultKeyRow } from "../server/hosted/vault-route";
import { runWithoutDatabase } from "./support/no-database";
import { memoryObservationStore, UNOPENABLE_BODY } from "./support/observation-store";

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

test("a whole pass stores the roster with its projects, dated by the pass", async () => {
  const store = memoryObservationStore();
  const outcome = await runWithoutDatabase(
    observeAndSnapshot({
      userId: "user-1",
      rows: KEY_ROWS,
      secret: SECRET,
      store,
      seams: { fetch: api().fetch, now: () => TEST_TIME },
      now: TEST_TIME,
    }),
  );

  assert.equal(outcome.complete, true);
  assert.equal(outcome.changed, false);
  assert.equal(outcome.observedAt, TEST_TIME);
  const stored = await runWithoutDatabase(storedRoster(store, "user-1", KEY_ROWS, SECRET));
  assert.ok(stored?.roster);
  assert.equal(stored.observedAt, TEST_TIME);
  const [provider] = stored.roster.providers;
  assert.equal(provider?.providerId, "conductor");
  assert.equal(provider?.observations[0]?.providerSessionId, "session-one");
  assert.equal(provider?.observations[0]?.status, SESSION_STATUS.WORKING);
  assert.deepEqual(
    provider?.projects.map((project) => project.providerProjectId),
    [LUKE_PROJECT.id],
  );
  assert.deepEqual(store.passes.get("user-1"), { attemptedAt: TEST_TIME, observedAt: TEST_TIME });
});

test("a changed roster moves the snapshot and says so; an unchanged one moves only the snapshot and says nothing changed", async () => {
  const store = memoryObservationStore();
  const pass = (status: string, now: number) =>
    runWithoutDatabase(
      observeAndSnapshot({
        userId: "user-1",
        rows: KEY_ROWS,
        secret: SECRET,
        store,
        seams: { fetch: api(status).fetch, now: () => now },
        now,
      }),
    );

  await pass(TEST_CONDUCTOR_STATUS.WORKING, TEST_TIME);
  const same = await pass(TEST_CONDUCTOR_STATUS.WORKING, TEST_TIME + 60_000);
  assert.equal(same.changed, false);
  assert.equal(store.snapshots.get("user-1")?.observedAt, TEST_TIME + 60_000);

  const changed = await pass(TEST_CONDUCTOR_STATUS.ERROR, TEST_TIME + 120_000);
  assert.equal(changed.changed, true);
  assert.equal(store.snapshots.get("user-1")?.observedAt, TEST_TIME + 120_000);
  assert.deepEqual(
    store.advances.map((advance) => advance.observedAt),
    [TEST_TIME, TEST_TIME + 60_000, TEST_TIME + 120_000],
  );
});

// The 429 cadence now runs on the fiber's own clock rather than an injected
// `sleep` seam, so this pass genuinely spends the backoff budget's waits —
// bounded by `RATE_LIMIT_BACKOFF.PASS_CEILING_MS` — and the timeout is raised
// to cover them.
test("a pass the provider rate limits past its backoff leaves the previous snapshot standing and is recorded as failed", async () => {
  const store = memoryObservationStore();
  const healthy = api();
  await runWithoutDatabase(
    observeAndSnapshot({
      userId: "user-1",
      rows: KEY_ROWS,
      secret: SECRET,
      store,
      seams: { fetch: healthy.fetch, now: () => TEST_TIME },
      now: TEST_TIME,
    }),
  );

  const limited = api(TEST_CONDUCTOR_STATUS.ERROR);
  const outcome = await runWithoutDatabase(
    observeAndSnapshot({
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
      },
      now: TEST_TIME + 60_000,
    }),
  );

  assert.equal(outcome.complete, false);
  assert.equal(outcome.failure, CLOUD_OBSERVE_FAILURE.RATE_LIMITED);
  assert.equal(outcome.observedAt, TEST_TIME);
  assert.equal(outcome.roster?.providers[0]?.observations[0]?.status, SESSION_STATUS.WORKING);
  assert.equal(store.snapshots.get("user-1")?.observedAt, TEST_TIME);
  assert.deepEqual(store.passes.get("user-1"), {
    attemptedAt: TEST_TIME + 60_000,
    failure: CLOUD_OBSERVE_FAILURE.RATE_LIMITED,
    observedAt: TEST_TIME,
  });
}, 15_000);

test("a refused key, an unreachable provider, and an unreadable key each fail the pass by name", async () => {
  const store = memoryObservationStore();
  const attempt = (
    rows: VaultKeyRow[],
    fetch: (url: string, init: RequestInit) => Promise<Response>,
  ) =>
    runWithoutDatabase(
      observeAndSnapshot({
        userId: "user-1",
        rows,
        secret: SECRET,
        store,
        seams: { fetch },
        now: TEST_TIME,
      }),
    );

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
  store.roster.recordPass = (userId, attempt) =>
    Effect.suspend(() => {
      recorded.push({
        attemptedAt: attempt.attemptedAt,
        ...(attempt.failure ? { failure: attempt.failure } : undefined),
      });
      return recordPass(userId, attempt);
    });
  const hanging = new Promise<Response>(() => undefined);
  let asked = false;
  const outcome = runWithoutDatabase(
    observeAndSnapshot({
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
    }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(asked, true);
  assert.deepEqual(recorded, [
    { attemptedAt: TEST_TIME, failure: CLOUD_OBSERVE_FAILURE.UNFINISHED },
  ]);
  assert.equal(store.passes.get("user-1")?.failure, CLOUD_OBSERVE_FAILURE.UNFINISHED);
  void outcome;

  const finished = memoryObservationStore();
  await runWithoutDatabase(
    observeAndSnapshot({
      userId: "user-1",
      rows: KEY_ROWS,
      secret: SECRET,
      store: finished,
      seams: { fetch: api().fetch, now: () => TEST_TIME },
      now: TEST_TIME,
    }),
  );
  assert.deepEqual(finished.passes.get("user-1"), {
    attemptedAt: TEST_TIME,
    observedAt: TEST_TIME,
  });
});

test("two passes racing over one user record one transition once, and the later one adopts the roster that landed", async () => {
  const store = memoryObservationStore();
  const pass = (status: string, now: number, gate?: Promise<void>) =>
    runWithoutDatabase(
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
      }),
    );
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
  // The losing pass leaves the winner's pass record standing rather than
  // backdating the account to the head of the schedule's order.
  assert.deepEqual(store.passes.get("user-1"), {
    attemptedAt: TEST_TIME + 2_000,
    observedAt: TEST_TIME + 2_000,
  });
});

test("when the earlier-started pass wins, the later one closes its own unfinished attempt as a whole read", async () => {
  const store = memoryObservationStore();
  const gated = (status: string, now: number) => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const outcome = runWithoutDatabase(
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
      }),
    );
    return { outcome, release };
  };
  const earlier = gated(TEST_CONDUCTOR_STATUS.WORKING, TEST_TIME + 1_000);
  const later = gated(TEST_CONDUCTOR_STATUS.WORKING, TEST_TIME + 2_000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(store.passes.get("user-1")?.failure, CLOUD_OBSERVE_FAILURE.UNFINISHED);

  earlier.release();
  const won = await earlier.outcome;
  assert.equal(won.complete, true);
  assert.equal(store.snapshots.get("user-1")?.observedAt, TEST_TIME + 1_000);
  later.release();
  const lost = await later.outcome;

  assert.equal(lost.complete, true);
  assert.equal(lost.changed, false);
  assert.equal(store.snapshots.get("user-1")?.observedAt, TEST_TIME + 1_000);
  assert.deepEqual(store.passes.get("user-1"), {
    attemptedAt: TEST_TIME + 2_000,
    observedAt: TEST_TIME + 2_000,
  });
});

test("a snapshot observed under a key since replaced is another key's roster: not served, and replaced; the same key saved again keeps it", async () => {
  const store = memoryObservationStore();
  const first = await runWithoutDatabase(
    observeAndSnapshot({
      userId: "user-1",
      rows: KEY_ROWS,
      secret: SECRET,
      store,
      seams: { fetch: api().fetch, now: () => TEST_TIME },
      now: TEST_TIME,
    }),
  );
  assert.equal(first.roster?.providers[0]?.keyFingerprint, keyFingerprint(TEST_API_KEY, SECRET));
  assert.ok((await runWithoutDatabase(storedRoster(store, "user-1", KEY_ROWS, SECRET)))?.roster);

  // The Mac re-saves the same key on every launch, under a fresh nonce.
  const resaved: VaultKeyRow[] = [
    { providerId: "conductor", ciphertext: encryptProviderKey(TEST_API_KEY, SECRET) },
  ];
  assert.notEqual(resaved[0]?.ciphertext, KEY_ROWS[0]?.ciphertext);
  assert.ok((await runWithoutDatabase(storedRoster(store, "user-1", resaved, SECRET)))?.roster);

  const replaced: VaultKeyRow[] = [
    { providerId: "conductor", ciphertext: encryptProviderKey("another-key", SECRET) },
  ];
  assert.deepEqual(await runWithoutDatabase(storedRoster(store, "user-1", replaced, SECRET)), {
    observedAt: TEST_TIME,
  });
  assert.equal(
    (await runWithoutDatabase(storedRoster(store, "user-1", [], SECRET)))?.roster,
    undefined,
  );
  const unreadable: VaultKeyRow[] = [{ providerId: "conductor", ciphertext: "not-a-ciphertext" }];
  assert.equal(
    (await runWithoutDatabase(storedRoster(store, "user-1", unreadable, SECRET)))?.roster,
    undefined,
  );

  const second = await runWithoutDatabase(
    observeAndSnapshot({
      userId: "user-1",
      rows: replaced,
      secret: SECRET,
      store,
      seams: { fetch: api(TEST_CONDUCTOR_STATUS.ERROR).fetch, now: () => TEST_TIME + 1_000 },
      now: TEST_TIME + 1_000,
    }),
  );
  assert.equal(second.complete, true);
  assert.equal(second.changed, false);
  assert.ok((await runWithoutDatabase(storedRoster(store, "user-1", replaced, SECRET)))?.roster);
});

test("a snapshot this build cannot open or read is replaced by the next whole pass", async () => {
  for (const body of [UNOPENABLE_BODY, "not json", JSON.stringify({ version: 99 })]) {
    const store = memoryObservationStore();
    store.snapshots.set("user-1", { body, observedAt: TEST_TIME - 60_000 });
    assert.deepEqual(await runWithoutDatabase(storedRoster(store, "user-1", KEY_ROWS, SECRET)), {
      observedAt: TEST_TIME - 60_000,
    });

    const outcome = await runWithoutDatabase(
      observeAndSnapshot({
        userId: "user-1",
        rows: KEY_ROWS,
        secret: SECRET,
        store,
        seams: { fetch: api().fetch, now: () => TEST_TIME },
        now: TEST_TIME,
      }),
    );

    assert.equal(outcome.complete, true, body);
    assert.equal(outcome.changed, false, body);
    assert.equal(store.snapshots.get("user-1")?.observedAt, TEST_TIME, body);
    assert.equal(
      (await runWithoutDatabase(storedRoster(store, "user-1", KEY_ROWS, SECRET)))?.roster?.providers
        .length,
      1,
      body,
    );
  }
});

test("a store that cannot take the snapshot is a failed pass, never an unrecorded roster", async () => {
  const store = memoryObservationStore();
  store.roster.advance = () =>
    Effect.sync(() => {
      throw new Error("disk full");
    });
  const outcome = await runWithoutDatabase(
    observeAndSnapshot({
      userId: "user-1",
      rows: KEY_ROWS,
      secret: SECRET,
      store,
      seams: { fetch: api().fetch, now: () => TEST_TIME },
      now: TEST_TIME,
    }),
  );

  assert.equal(outcome.complete, false);
  assert.equal(outcome.failure, CLOUD_OBSERVE_FAILURE.PASS_FAILED);
  assert.equal(store.passes.get("user-1")?.failure, CLOUD_OBSERVE_FAILURE.PASS_FAILED);
});
