import assert from "node:assert/strict";
import { eq, getTableName, sql } from "drizzle-orm";
import { afterAll, test } from "vitest";
import {
  devices,
  observationPass,
  personalFact,
  providerKey,
  rosterDiff,
  rosterSnapshot,
  user,
  workspaceFile,
} from "../server/db/schema";
import { payloadKeyRing } from "../server/hosted/encryption";
import { MAXIMUM_PENDING_ROSTER_DIFFS } from "../server/hosted/store";
import { userSeal } from "../server/hosted/store/database";
import { readRosterSnapshot } from "../server/hosted/store/roster-snapshot";
import { openHostedStoreTestDatabase, TEST_PAYLOAD_SECRET } from "./support/hosted-store-database";

/** Synthetic fixtures: no real title, branch, or transcript anywhere. */

const NOW = 1_800_000_000_000;

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

test("facts are listed in order and replaced whole, a kept id keeping its first instant, and sealed at rest", async () => {
  const userId = await database.createUser();
  assert.deepEqual(await database.store.facts.list(userId), []);
  const first = await database.store.facts.replace(
    userId,
    [
      { id: "fact-1", words: "prefers short replies" },
      { id: "fact-2", words: "works in the mornings" },
    ],
    NOW,
  );
  assert.deepEqual(first, [
    { id: "fact-1", words: "prefers short replies", createdAt: NOW },
    { id: "fact-2", words: "works in the mornings", createdAt: NOW },
  ]);
  const second = await database.store.facts.replace(
    userId,
    [
      { id: "fact-3", words: "uses a standing desk" },
      { id: "fact-1", words: "prefers short replies" },
    ],
    NOW + 5,
  );
  assert.deepEqual(second, [
    { id: "fact-3", words: "uses a standing desk", createdAt: NOW + 5 },
    { id: "fact-1", words: "prefers short replies", createdAt: NOW },
  ]);
});

test("workspace files are read and written whole per user and path, seeded once, and refuse a path outside the workspace", async () => {
  const userId = await database.createUser();
  const workspace = database.store.workspace;
  assert.equal(await workspace.read(userId, "AGENTS.md"), undefined);
  assert.equal(await workspace.seed(userId, "AGENTS.md", "# seed", NOW), true);
  assert.equal(await workspace.seed(userId, "AGENTS.md", "# a later seed", NOW + 1), false);
  await workspace.write(userId, "memory/2026-09-09.md", "- a note", NOW + 2);
  await workspace.write(userId, "AGENTS.md", "# edited", NOW + 3);
  assert.deepEqual(await workspace.read(userId, "AGENTS.md"), {
    path: "AGENTS.md",
    content: "# edited",
    createdAt: NOW,
    updatedAt: NOW + 3,
  });
  assert.deepEqual(await workspace.list(userId), [
    { path: "AGENTS.md", updatedAt: NOW + 3 },
    { path: "memory/2026-09-09.md", updatedAt: NOW + 2 },
  ]);
  for (const path of ["/etc/passwd", "../SOUL.md", "memory/../../x", "", "a//b", "a\\b"]) {
    await assert.rejects(workspace.write(userId, path, "x", NOW), /workspace path/);
    await assert.rejects(workspace.read(userId, path), /workspace path/);
  }
  assert.equal(await workspace.delete(userId, "memory/2026-09-09.md"), true);
  assert.equal(await workspace.delete(userId, "memory/2026-09-09.md"), false);
  const rows = await database.db
    .select()
    .from(workspaceFile)
    .where(eq(workspaceFile.userId, userId));
  assert.equal(rows.length, 1);

  const other = await database.createUser();
  assert.equal(await workspace.read(other, "AGENTS.md"), undefined);
});

test("the roster snapshot is one sealed row per user, replaced whole, and its instant is readable without its body", async () => {
  const userId = await database.createUser();
  assert.equal(await database.store.roster.read(userId), undefined);
  assert.equal(await database.store.roster.observedAt(userId), undefined);
  await database.store.roster.write(userId, {
    body: JSON.stringify({ sessions: ["a"] }),
    observedAt: NOW,
  });
  await database.store.roster.write(userId, {
    body: JSON.stringify({ sessions: ["b"] }),
    observedAt: NOW + 1,
  });
  assert.deepEqual(await database.store.roster.read(userId), {
    body: JSON.stringify({ sessions: ["b"] }),
    observedAt: NOW + 1,
  });
  const rows = await database.db
    .select()
    .from(rosterSnapshot)
    .where(eq(rosterSnapshot.userId, userId));
  assert.equal(rows.length, 1);
  await database.db
    .update(rosterSnapshot)
    .set({ sealedBody: "1:not-an-envelope" })
    .where(eq(rosterSnapshot.userId, userId));
  await assert.rejects(database.store.roster.read(userId));
  assert.equal(await database.store.roster.observedAt(userId), NOW + 1);
});

test("a pass advances the snapshot and its diff together, diffs wait sealed until consumed once, and the pending bound drops the oldest", async () => {
  const userId = await database.createUser();
  const { roster } = database.store;
  assert.equal(
    await roster.advance(
      userId,
      { body: JSON.stringify({ first: true }), observedAt: NOW },
      undefined,
      undefined,
    ),
    true,
  );
  assert.deepEqual(await roster.pendingDiffs(userId), []);

  assert.equal(
    await roster.advance(
      userId,
      { body: JSON.stringify({ second: true }), observedAt: NOW + 1 },
      { id: "diff-1", observedAt: NOW + 1, previousObservedAt: NOW, payload: "a session appeared" },
      NOW,
    ),
    true,
  );
  // A pass that read the first snapshot but lands after the second writes nothing.
  assert.equal(
    await roster.advance(
      userId,
      { body: JSON.stringify({ stale: true }), observedAt: NOW + 2 },
      {
        id: "diff-stale",
        observedAt: NOW + 2,
        previousObservedAt: NOW,
        payload: "the same change",
      },
      NOW,
    ),
    false,
  );
  assert.equal(
    await roster.advance(userId, { body: "{}", observedAt: NOW + 2 }, undefined, undefined),
    false,
  );
  assert.equal((await roster.read(userId))?.observedAt, NOW + 1);
  assert.deepEqual(await roster.pendingDiffs(userId), [
    { id: "diff-1", observedAt: NOW + 1, previousObservedAt: NOW, payload: "a session appeared" },
  ]);

  assert.equal(await roster.consumeDiff(userId, "diff-1", NOW + 2), true);
  assert.equal(await roster.consumeDiff(userId, "diff-1", NOW + 3), false);
  assert.equal(await roster.consumeDiff(userId, "diff-missing", NOW + 3), false);
  assert.deepEqual(await roster.pendingDiffs(userId), []);

  for (let index = 0; index < MAXIMUM_PENDING_ROSTER_DIFFS + 3; index += 1) {
    await roster.advance(
      userId,
      { body: "{}", observedAt: NOW + 10 + index },
      {
        id: `diff-${index + 10}`,
        observedAt: NOW + 10 + index,
        previousObservedAt: NOW + 9 + index,
        payload: `change ${index}`,
      },
      index === 0 ? NOW + 1 : NOW + 9 + index,
    );
  }
  const pending = await roster.pendingDiffs(userId);
  assert.equal(pending.length, MAXIMUM_PENDING_ROSTER_DIFFS);
  assert.equal(pending[0]?.id, "diff-13");
  assert.equal(pending.at(-1)?.id, `diff-${MAXIMUM_PENDING_ROSTER_DIFFS + 12}`);
  const rows = await database.db.select().from(rosterDiff).where(eq(rosterDiff.userId, userId));
  assert.equal(
    rows.length,
    MAXIMUM_PENDING_ROSTER_DIFFS,
    "the consumed diff was dropped with the oldest",
  );

  const other = await database.createUser();
  assert.deepEqual(await roster.pendingDiffs(other), []);
});

test("a pass record moves the attempt every time, the whole read only on success, and forgetting reaches the keyless and the unseen it is told of and no account beside them", async () => {
  const userId = await database.createUser();
  const { roster } = database.store;
  assert.equal(await roster.pass(userId), undefined);
  await roster.recordPass(userId, { attemptedAt: NOW });
  assert.deepEqual(await roster.pass(userId), { attemptedAt: NOW, observedAt: NOW });
  await roster.recordPass(userId, { attemptedAt: NOW + 1, failure: "rate-limited" });
  assert.deepEqual(await roster.pass(userId), {
    attemptedAt: NOW + 1,
    observedAt: NOW,
    failure: "rate-limited",
  });
  await roster.recordPass(userId, { attemptedAt: NOW + 2 });
  assert.deepEqual(await roster.pass(userId), { attemptedAt: NOW + 2, observedAt: NOW + 2 });
  // A pass that ran long and reports after a later one cannot move the record back.
  await roster.recordPass(userId, { attemptedAt: NOW + 1, failure: "transient" });
  await roster.recordPass(userId, { attemptedAt: NOW });
  assert.deepEqual(await roster.pass(userId), { attemptedAt: NOW + 2, observedAt: NOW + 2 });

  const keyed = await database.createUser();
  const unseen = await database.createUser();
  for (const id of [keyed, unseen]) {
    await database.db
      .insert(providerKey)
      .values({ userId: id, providerId: "conductor", ciphertext: "sealed" });
  }
  await database.db.insert(devices).values([
    {
      id: `device-${keyed}`,
      userId: keyed,
      installationId: `install-${keyed}`,
      platform: "ios",
      lastSeenAt: new Date(NOW),
    },
    {
      id: `device-${unseen}`,
      userId: unseen,
      installationId: `install-${unseen}`,
      platform: "ios",
      lastSeenAt: new Date(NOW - 1),
    },
  ]);
  // Keyless and unseen like `userId`, but outside the accounts the sweep is
  // told of: what another test file's account looks like on a shared Postgres.
  const bystander = await database.createUser();
  for (const id of [userId, keyed, unseen, bystander]) {
    await roster.advance(
      id,
      { body: "{}", observedAt: NOW },
      { id: "diff-1", observedAt: NOW, previousObservedAt: NOW - 1, payload: "x" },
      undefined,
    );
    await roster.recordPass(id, { attemptedAt: NOW });
  }
  await roster.forgetIneligible({
    providerIds: ["conductor"],
    seenAfter: NOW,
    userIds: [userId, keyed, unseen],
  });
  for (const gone of [userId, unseen]) {
    assert.equal(await roster.read(gone), undefined);
    assert.deepEqual(await roster.pendingDiffs(gone), []);
    assert.equal(await roster.pass(gone), undefined);
  }
  for (const standing of [keyed, bystander]) {
    assert.equal((await roster.read(standing))?.observedAt, NOW);
    assert.equal((await roster.pendingDiffs(standing)).length, 1);
    assert.equal((await roster.pass(standing))?.attemptedAt, NOW);
  }
});

test("deleting the user row cascades through every notebook, fact, and roster table and leaves another user's rows standing", async () => {
  const userId = await database.createUser();
  const other = await database.createUser();
  for (const id of [userId, other]) {
    await database.store.facts.replace(id, [{ id: "f-1", words: "a fact" }], NOW);
    await database.store.workspace.write(id, "USER.md", "# user", NOW);
    await database.store.roster.advance(
      id,
      { body: "{}", observedAt: NOW },
      { id: "diff-1", observedAt: NOW, previousObservedAt: NOW - 1, payload: "x" },
      undefined,
    );
    await database.store.roster.recordPass(id, { attemptedAt: NOW });
  }

  await database.db.delete(user).where(eq(user.id, userId));

  for (const table of [personalFact, workspaceFile, rosterSnapshot, rosterDiff, observationPass]) {
    const gone = await database.db
      .select({ count: sql<number>`count(*)::int` })
      .from(table)
      .where(eq(table.userId, userId));
    assert.equal(gone[0]?.count, 0, `${getTableName(table)} still holds rows for the deleted user`);
    const kept = await database.db
      .select({ count: sql<number>`count(*)::int` })
      .from(table)
      .where(eq(table.userId, other));
    assert.ok((kept[0]?.count ?? 0) > 0, `${getTableName(table)} lost the other user's rows`);
  }
});

test("a sealed row under one user does not open as another, and opens whole under its own", async () => {
  const userId = await database.createUser();
  const other = await database.createUser();
  const keys = payloadKeyRing(TEST_PAYLOAD_SECRET);
  const snapshot = { body: JSON.stringify({ sessions: ["a"] }), observedAt: NOW };
  await database.store.roster.write(userId, snapshot);

  await assert.rejects(readRosterSnapshot(database.db, userSeal(keys, other), userId));
  assert.deepEqual(await readRosterSnapshot(database.db, userSeal(keys, userId), userId), snapshot);
});
