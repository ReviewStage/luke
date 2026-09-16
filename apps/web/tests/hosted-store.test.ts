import assert from "node:assert/strict";
import { Effect, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { afterAll, test } from "vitest";
import { CONVERSATION_KIND } from "../server/db/storage-vocabulary";
import { payloadKeyRing } from "../server/hosted/encryption";
import { EpochMillisColumnSchema, userSeal } from "../server/hosted/store/database";
import { readRosterSnapshot } from "../server/hosted/store/roster-snapshot";
import { openHostedStoreTestDatabase, TEST_PAYLOAD_SECRET } from "./support/hosted-store-database";
import { countRowsForUser, deleteUser, insertDevice } from "./support/store-rows";

/** Synthetic fixtures: no real title, branch, or transcript anywhere. */

const NOW = 1_800_000_000_000;

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

test("workspace files are read and written whole per user and path, seeded once, and refuse a path outside the workspace", async () => {
  const userId = await database.createUser();
  const workspace = database.store.workspace;
  assert.equal(await database.run(workspace.read(userId, "AGENTS.md")), undefined);
  assert.equal(await database.run(workspace.seed(userId, "AGENTS.md", "# seed", NOW)), true);
  assert.equal(
    await database.run(workspace.seed(userId, "AGENTS.md", "# a later seed", NOW + 1)),
    false,
  );
  await database.run(workspace.write(userId, "memory/2026-09-09.md", "- a note", NOW + 2));
  await database.run(workspace.write(userId, "AGENTS.md", "# edited", NOW + 3));
  assert.deepEqual(await database.run(workspace.read(userId, "AGENTS.md")), {
    path: "AGENTS.md",
    content: "# edited",
    createdAt: NOW,
    updatedAt: NOW + 3,
  });
  assert.deepEqual(await database.run(workspace.list(userId)), [
    { path: "AGENTS.md", updatedAt: NOW + 3 },
    { path: "memory/2026-09-09.md", updatedAt: NOW + 2 },
  ]);
  for (const path of ["/etc/passwd", "../SOUL.md", "memory/../../x", "", "a//b", "a\\b"]) {
    await assert.rejects(database.run(workspace.write(userId, path, "x", NOW)), /workspace path/);
    await assert.rejects(database.run(workspace.read(userId, path)), /workspace path/);
  }
  assert.equal(await countRowsForUser(database.run, "workspace_file", userId), 2);

  const other = await database.createUser();
  assert.equal(await database.run(workspace.read(other, "AGENTS.md")), undefined);
});

test("the roster snapshot is one sealed row per user, replaced whole, and its instant is readable without its body", async () => {
  const userId = await database.createUser();
  assert.equal(await database.run(database.store.roster.read(userId)), undefined);
  assert.equal(await database.run(database.store.roster.observedAt(userId)), undefined);
  await database.run(
    database.store.roster.write(userId, {
      body: JSON.stringify({ sessions: ["a"] }),
      observedAt: NOW,
    }),
  );
  await database.run(
    database.store.roster.write(userId, {
      body: JSON.stringify({ sessions: ["b"] }),
      observedAt: NOW + 1,
    }),
  );
  assert.deepEqual(await database.run(database.store.roster.read(userId)), {
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
  await assert.rejects(database.run(database.store.roster.read(userId)));
  assert.equal(await database.run(database.store.roster.observedAt(userId)), NOW + 1);
});

test("a pass advances the snapshot only over the one it read against, and the opener's transcript mark is absent until kept and kept only over the mark the read began from", async () => {
  const userId = await database.createUser();
  const { roster } = database.store;
  assert.equal(
    await database.run(
      roster.advance(userId, { body: JSON.stringify({ first: true }), observedAt: NOW }, undefined),
    ),
    true,
  );
  assert.equal(
    await database.run(
      roster.advance(userId, { body: JSON.stringify({ second: true }), observedAt: NOW + 1 }, NOW),
    ),
    true,
  );
  // A pass that read the first snapshot but lands after the second writes nothing.
  assert.equal(
    await database.run(
      roster.advance(userId, { body: JSON.stringify({ stale: true }), observedAt: NOW + 2 }, NOW),
    ),
    false,
  );
  assert.equal(
    await database.run(roster.advance(userId, { body: "{}", observedAt: NOW + 2 }, undefined)),
    false,
  );
  assert.equal((await database.run(roster.read(userId)))?.observedAt, NOW + 1);

  // The opener's mark: absent until kept, a first mark lands only where none stands, and a later one only over the mark it read.
  assert.equal(await database.run(roster.mark(userId)), undefined);
  assert.equal(await database.run(roster.keepMark(userId, NOW + 1, NOW, NOW)), false);
  assert.equal(await database.run(roster.mark(userId)), undefined);
  assert.equal(await database.run(roster.keepMark(userId, NOW + 1, undefined, NOW)), true);
  assert.equal(await database.run(roster.mark(userId)), NOW + 1);
  assert.equal(await database.run(roster.keepMark(userId, NOW + 5, NOW, NOW)), false);
  assert.equal(await database.run(roster.keepMark(userId, NOW + 5, undefined, NOW)), false);
  assert.equal(await database.run(roster.mark(userId)), NOW + 1);
  assert.equal(await database.run(roster.keepMark(userId, NOW + 5, NOW + 1, NOW + 9)), true);
  assert.equal(await database.run(roster.mark(userId)), NOW + 5);

  const [row] = await database.run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql`select mark, updated_at from transcript_mark where user_id = ${userId}`;
    }),
  );
  assert.ok(row);
  assert.equal(Schema.decodeUnknownSync(EpochMillisColumnSchema)(row.mark), NOW + 5);
});

test("a pass record moves the attempt every time, the whole read only on success, and forgetting reaches the keyless and the unseen it is told of and no account beside them", async () => {
  const userId = await database.createUser();
  const { roster } = database.store;
  assert.equal(await database.run(roster.pass(userId)), undefined);
  await database.run(roster.recordPass(userId, { attemptedAt: NOW }));
  assert.deepEqual(await database.run(roster.pass(userId)), { attemptedAt: NOW, observedAt: NOW });
  await database.run(roster.recordPass(userId, { attemptedAt: NOW + 1, failure: "rate-limited" }));
  assert.deepEqual(await database.run(roster.pass(userId)), {
    attemptedAt: NOW + 1,
    observedAt: NOW,
    failure: "rate-limited",
  });
  await database.run(roster.recordPass(userId, { attemptedAt: NOW + 2 }));
  assert.deepEqual(await database.run(roster.pass(userId)), {
    attemptedAt: NOW + 2,
    observedAt: NOW + 2,
  });
  // A pass that ran long and reports after a later one cannot move the record back.
  await database.run(roster.recordPass(userId, { attemptedAt: NOW + 1, failure: "transient" }));
  await database.run(roster.recordPass(userId, { attemptedAt: NOW }));
  assert.deepEqual(await database.run(roster.pass(userId)), {
    attemptedAt: NOW + 2,
    observedAt: NOW + 2,
  });

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
  for (const id of [userId, keyed, unseen]) {
    await database.run(roster.advance(id, { body: "{}", observedAt: NOW }, undefined));
    await database.run(roster.recordPass(id, { attemptedAt: NOW }));
    await database.run(roster.keepMark(id, NOW, undefined, NOW));
  }
  await database.run(roster.forgetIneligible({ providerIds: ["conductor"], seenAfter: NOW }));
  for (const gone of [userId, unseen]) {
    assert.equal(await database.run(roster.read(gone)), undefined);
    assert.equal(await database.run(roster.mark(gone)), undefined);
    assert.equal(await database.run(roster.pass(gone)), undefined);
  }
  assert.equal((await database.run(roster.read(keyed)))?.observedAt, NOW);
  assert.equal(await database.run(roster.mark(keyed)), NOW);
  assert.equal((await database.run(roster.pass(keyed)))?.attemptedAt, NOW);
});

test("deleting the user row cascades through every notebook and roster table and leaves another user's rows standing", async () => {
  const userId = await database.createUser();
  const other = await database.createUser();
  for (const id of [userId, other]) {
    await database.run(database.store.workspace.write(id, "USER.md", "# user", NOW));
    await database.run(
      database.store.embeddings.write(id, "embed-test", [{ hash: "h-1", vector: [1] }], NOW),
    );
    await database.run(
      database.store.roster.advance(id, { body: "{}", observedAt: NOW }, undefined),
    );
    await database.run(database.store.roster.recordPass(id, { attemptedAt: NOW }));
    await database.run(database.store.roster.keepMark(id, NOW, undefined, NOW));
  }

  await deleteUser(database.run, userId);

  for (const table of [
    "workspace_file",
    "workspace_embedding",
    "roster_snapshot",
    "transcript_mark",
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
  await database.run(database.store.roster.write(userId, snapshot));

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
  const opened = await database.run(database.store.directory.observed(userId, session, NOW));
  assert.ok(opened);
  assert.equal(
    await database.run(database.store.directory.observed(userId, session, NOW + 1)),
    opened,
  );
  const another = await database.run(
    database.store.directory.observed(
      userId,
      { ...session, providerSessionId: "s-observed-2" },
      NOW,
    ),
  );
  assert.ok(another);
  assert.notEqual(another, opened);
  const elsewhere = await database.run(database.store.directory.observed(other, session, NOW));
  assert.ok(elsewhere);
  assert.notEqual(elsewhere, opened);
  const standing = await database.run(database.store.directory.standing(userId));
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

test("an observed conversation keeps the session's title and workspace as the roster last showed them: written on the open, refreshed on a wake that names them, left standing by one that does not", async () => {
  const userId = await database.createUser();
  const session = { providerId: "conductor", providerSessionId: "s-named-1" };
  const namingOf = async (id: string) => {
    const [row] = await database.run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql`select title, workspace from conversations where id = ${id}`;
      }),
    );
    return row;
  };
  // A blank workspace is no name at all, and the title's own whitespace is not kept.
  const opened = await database.run(
    database.store.directory.observed(userId, session, NOW, {
      title: "  Fix the checkout tests ",
      workspace: " ",
    }),
  );
  assert.ok(opened);
  assert.deepEqual(await namingOf(opened), { title: "Fix the checkout tests", workspace: null });
  // The next wake renames the session and names its workspace; the row follows.
  assert.equal(
    await database.run(
      database.store.directory.observed(userId, session, NOW + 1, {
        title: "Fix the checkout tests, again",
        workspace: "power-vacation",
      }),
    ),
    opened,
  );
  assert.deepEqual(await namingOf(opened), {
    title: "Fix the checkout tests, again",
    workspace: "power-vacation",
  });
  // A wake for a session the roster has let go carries no naming and leaves the row's standing.
  assert.equal(
    await database.run(database.store.directory.observed(userId, session, NOW + 2)),
    opened,
  );
  assert.deepEqual(await namingOf(opened), {
    title: "Fix the checkout tests, again",
    workspace: "power-vacation",
  });
});
