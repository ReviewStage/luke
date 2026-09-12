import assert from "node:assert/strict";
import * as SqlClient from "@effect/sql/SqlClient";
import { Effect, Schema } from "effect";
import { afterAll, test } from "vitest";
import { CONVERSATION_KIND } from "../server/db/storage-vocabulary";
import { payloadKeyRing } from "../server/hosted/encryption";
import { CONSUMED_ROSTER } from "../server/hosted/store";
import { EpochMillisColumnSchema, userSeal } from "../server/hosted/store/database";
import { keepConsumedRoster, readRosterSnapshot } from "../server/hosted/store/roster-snapshot";
import { openHostedStoreTestDatabase, TEST_PAYLOAD_SECRET } from "./support/hosted-store-database";
import { countRowsForUser, deleteUser, insertDevice } from "./support/store-rows";

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
  assert.equal(await countRowsForUser(database.run, "workspace_file", userId), 1);

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
  assert.equal(await countRowsForUser(database.run, "roster_snapshot", userId), 1);
  await database.run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        update roster_snapshot set sealed_body = '1:not-an-envelope' where user_id = ${userId}
      `;
    }),
  );
  await assert.rejects(database.store.roster.read(userId));
  assert.equal(await database.store.roster.observedAt(userId), NOW + 1);
});

test("a pass advances the snapshot only over the one it read against, and the opener's bookmark over the roster is sealed, absent until kept, and kept only over the instant the read began from", async () => {
  const userId = await database.createUser();
  const { roster } = database.store;
  assert.equal(
    await roster.advance(
      userId,
      { body: JSON.stringify({ first: true }), observedAt: NOW },
      undefined,
    ),
    true,
  );
  assert.equal(
    await roster.advance(
      userId,
      { body: JSON.stringify({ second: true }), observedAt: NOW + 1 },
      NOW,
    ),
    true,
  );
  // A pass that read the first snapshot but lands after the second writes nothing.
  assert.equal(
    await roster.advance(
      userId,
      { body: JSON.stringify({ stale: true }), observedAt: NOW + 2 },
      NOW,
    ),
    false,
  );
  assert.equal(await roster.advance(userId, { body: "{}", observedAt: NOW + 2 }, undefined), false);
  assert.equal((await roster.read(userId))?.observedAt, NOW + 1);

  assert.deepEqual(await roster.consumed(userId), { state: CONSUMED_ROSTER.ABSENT });
  const heard = { body: JSON.stringify({ heard: 1 }), observedAt: NOW + 1 };
  // A first bookmark lands only where none stands; one over a wrong instant does not.
  assert.equal(await database.run(roster.keepConsumed(userId, heard, NOW)), false);
  assert.deepEqual(await roster.consumed(userId), { state: CONSUMED_ROSTER.ABSENT });
  assert.equal(await database.run(roster.keepConsumed(userId, heard, undefined)), true);
  assert.deepEqual(await roster.consumed(userId), {
    state: CONSUMED_ROSTER.STANDING,
    roster: heard,
  });
  const later = { body: JSON.stringify({ heard: 2 }), observedAt: NOW + 5 };
  assert.equal(await database.run(roster.keepConsumed(userId, later, NOW)), false);
  assert.equal(await database.run(roster.keepConsumed(userId, later, undefined)), false);
  assert.deepEqual(await roster.consumed(userId), {
    state: CONSUMED_ROSTER.STANDING,
    roster: heard,
  });
  assert.equal(await database.run(roster.keepConsumed(userId, later, NOW + 1)), true);
  assert.deepEqual(await roster.consumed(userId), {
    state: CONSUMED_ROSTER.STANDING,
    roster: later,
  });

  const [row] = await database.run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql`select * from roster_consumed where user_id = ${userId}`;
    }),
  );
  assert.ok(row);
  assert.notEqual(row.sealed_body, later.body);
  assert.equal(Schema.decodeUnknownSync(EpochMillisColumnSchema)(row.observed_at), NOW + 5);

  // A bookmark sealed under another account stands but cannot be opened here: answered as such, with the instant a replacement must be kept over.
  const other = await database.createUser();
  assert.deepEqual(await roster.consumed(other), { state: CONSUMED_ROSTER.ABSENT });
  await database.run(
    keepConsumedRoster(
      userSeal(payloadKeyRing(TEST_PAYLOAD_SECRET), userId),
      other,
      { body: JSON.stringify({ heard: 3 }), observedAt: NOW + 7 },
      undefined,
    ),
  );
  assert.deepEqual(await roster.consumed(other), {
    state: CONSUMED_ROSTER.UNREADABLE,
    observedAt: NOW + 7,
  });
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
    await database.run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`
          insert into provider_key (user_id, provider_id, ciphertext)
          values (${id}, ${"conductor"}, ${"sealed"})
        `;
      }),
    );
  }
  await insertDevice(database.run, {
    id: `device-${keyed}`,
    userId: keyed,
    installationId: `install-${keyed}`,
    platform: "ios",
    lastSeenAt: new Date(NOW),
  });
  await insertDevice(database.run, {
    id: `device-${unseen}`,
    userId: unseen,
    installationId: `install-${unseen}`,
    platform: "ios",
    lastSeenAt: new Date(NOW - 1),
  });
  // Keyless and unseen like `userId`, but outside the accounts the sweep is
  // told of: what another test file's account looks like on a shared Postgres.
  const bystander = await database.createUser();
  for (const id of [userId, keyed, unseen, bystander]) {
    await roster.advance(id, { body: "{}", observedAt: NOW }, undefined);
    await roster.recordPass(id, { attemptedAt: NOW });
    await database.run(
      roster.keepConsumed(id, { body: JSON.stringify({ heard: id }), observedAt: NOW }, undefined),
    );
  }
  await roster.forgetIneligible({
    providerIds: ["conductor"],
    seenAfter: NOW,
    userIds: [userId, keyed, unseen],
  });
  for (const gone of [userId, unseen]) {
    assert.equal(await roster.read(gone), undefined);
    assert.deepEqual(await roster.consumed(gone), { state: CONSUMED_ROSTER.ABSENT });
    assert.equal(await roster.pass(gone), undefined);
  }
  for (const standing of [keyed, bystander]) {
    assert.equal((await roster.read(standing))?.observedAt, NOW);
    assert.equal((await roster.consumed(standing)).state, CONSUMED_ROSTER.STANDING);
    assert.equal((await roster.pass(standing))?.attemptedAt, NOW);
  }
});

test("deleting the user row cascades through every notebook, fact, and roster table and leaves another user's rows standing", async () => {
  const userId = await database.createUser();
  const other = await database.createUser();
  for (const id of [userId, other]) {
    await database.store.facts.replace(id, [{ id: "f-1", words: "a fact" }], NOW);
    await database.store.workspace.write(id, "USER.md", "# user", NOW);
    await database.store.roster.advance(id, { body: "{}", observedAt: NOW }, undefined);
    await database.store.roster.recordPass(id, { attemptedAt: NOW });
    await database.run(
      database.store.roster.keepConsumed(
        id,
        { body: JSON.stringify({ heard: id }), observedAt: NOW },
        undefined,
      ),
    );
  }

  await deleteUser(database.run, userId);

  // roster_diff stands unwritten and unread until its drop lands; nothing seeds it, so nothing here can prove it.
  for (const table of [
    "personal_fact",
    "workspace_file",
    "roster_snapshot",
    "roster_consumed",
    "observation_pass",
  ]) {
    assert.equal(
      await countRowsForUser(database.run, table, userId),
      0,
      `${table} still holds rows for the deleted user`,
    );
    assert.ok(
      (await countRowsForUser(database.run, table, other)) > 0,
      `${table} lost the other user's rows`,
    );
  }
});

test("a sealed row under one user does not open as another, and opens whole under its own", async () => {
  const userId = await database.createUser();
  const other = await database.createUser();
  const keys = payloadKeyRing(TEST_PAYLOAD_SECRET);
  const snapshot = { body: JSON.stringify({ sessions: ["a"] }), observedAt: NOW };
  await database.store.roster.write(userId, snapshot);

  await assert.rejects(database.run(readRosterSnapshot(userSeal(keys, other), userId)));
  assert.deepEqual(
    await database.run(readRosterSnapshot(userSeal(keys, userId), userId)),
    snapshot,
  );
});

test("an observed conversation is opened on its session's first diff and stands for every later one, one per session per account", async () => {
  const userId = await database.createUser();
  const other = await database.createUser();
  const session = { providerId: "conductor", providerSessionId: "s-observed-1" };
  const opened = await database.store.directory.observed(userId, session, NOW);
  assert.ok(opened);
  assert.equal(await database.store.directory.observed(userId, session, NOW + 1), opened);
  const another = await database.store.directory.observed(
    userId,
    { ...session, providerSessionId: "s-observed-2" },
    NOW,
  );
  assert.ok(another);
  assert.notEqual(another, opened);
  const elsewhere = await database.store.directory.observed(other, session, NOW);
  assert.ok(elsewhere);
  assert.notEqual(elsewhere, opened);
  const standing = await database.store.directory.standing(userId);
  assert.deepEqual(
    standing
      .filter((conversation) => conversation.kind === CONVERSATION_KIND.OBSERVED)
      .map((conversation) => conversation.id)
      .sort(),
    [opened, another].sort(),
  );
  const [row] = await database.run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql`
        select kind, provider_session_id as "providerSessionId" from conversations where id = ${opened}
      `;
    }),
  );
  assert.deepEqual(row, { kind: CONVERSATION_KIND.OBSERVED, providerSessionId: "s-observed-1" });
});
