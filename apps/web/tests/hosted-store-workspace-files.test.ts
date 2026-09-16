import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Effect, Exit, Option } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { user } from "../server/db/auth-schema";
import { db } from "../server/db/query";
import {
  listDailyNotes,
  listWorkspaceFiles,
  readWorkspaceFile,
  reviseWorkspaceFile,
  seedWorkspaceFile,
  writeWorkspaceFile,
} from "../server/hosted/store/workspace-files";
import { testSqlClient } from "./support/sql-client";

/**
 * The first store module read as what it now is: effects over the ambient
 * `SqlClient`, on whichever dialect this run stands over. `hosted-store.test.ts`
 * holds the same behaviour through the promise door the routes hold; these are
 * the three things only the effect surface can state — that the instants decode
 * to numbers whichever driver read the `bigint`, that a path outside the
 * workspace fails the effect rather than reaching a statement, and that a
 * revision's statements are inside its own transaction, which is what the
 * module's statements being Drizzle builders now rests on.
 *
 * Synthetic fixtures: no real path or note anywhere.
 */

const NOW = 1_800_000_000_000;

const NOTE_PATH = "memory/2026-09-09.md";

/** What every test user is called; the column is not null and no test reads it. */
const TEST_USER_NAME = "Test User";

const OUTSIDE_PATHS = ["/etc/passwd", "../SOUL.md", "memory/../../x", "", "a//b", "a\\b"];

const openUser = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: TEST_USER_NAME, email: `${userId}@luke.test` });
  return userId;
});

/**
 * The client with every transaction failing after its body ran, and nothing
 * else changed: a proxy over the real one, since the client is a callable
 * with its statements as properties. A write made outside the transaction is
 * committed by the real client and seen by the test.
 */
function transactionsFailingAfter(sql: SqlClient.SqlClient): SqlClient.SqlClient {
  const failing: SqlClient.SqlClient["withTransaction"] = (body) =>
    sql.withTransaction(
      Effect.flatMap(body, () => Effect.die(new Error("the connection dropped before commit"))),
    );
  return new Proxy(sql, {
    // oxlint-disable-next-line anti-slop/no-reflect -- forwarding a call the proxy does not interpret
    apply: (target, receiver, args) => Reflect.apply(target, receiver, args),
    get: (target, property, receiver) =>
      // oxlint-disable-next-line anti-slop/no-reflect -- forwarding a property the proxy does not interpret
      property === "withTransaction" ? failing : Reflect.get(target, property, receiver),
  });
}

it.layer(testSqlClient)("the workspace files over effect/unstable/sql", (it) => {
  it.effect("seeds once, writes whole, and answers the instants as numbers", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      assert.equal(Option.isNone(yield* readWorkspaceFile(userId, "AGENTS.md")), true);
      assert.equal(yield* seedWorkspaceFile(userId, "AGENTS.md", "# seed", NOW), true);
      assert.equal(yield* seedWorkspaceFile(userId, "AGENTS.md", "# later", NOW + 1), false);
      yield* writeWorkspaceFile(userId, NOTE_PATH, "- a note", NOW + 2);
      yield* writeWorkspaceFile(userId, "AGENTS.md", "# edited", NOW + 3);

      const found = yield* readWorkspaceFile(userId, "AGENTS.md");
      assert.deepEqual(Option.getOrUndefined(found), {
        path: "AGENTS.md",
        content: "# edited",
        createdAt: NOW,
        updatedAt: NOW + 3,
      });
      assert.deepEqual(
        [...(yield* listWorkspaceFiles(userId))],
        [
          { path: "AGENTS.md", updatedAt: NOW + 3 },
          { path: NOTE_PATH, updatedAt: NOW + 2 },
        ],
      );
    }),
  );

  it.effect(
    "lists the dated notes alone, newest first and bounded, each counted and none of it read back",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        yield* writeWorkspaceFile(userId, "MEMORY.md", "# MEMORY.md", NOW);
        yield* writeWorkspaceFile(userId, "memory/2026-09-07.md", "- oldest", NOW);
        yield* writeWorkspaceFile(userId, NOTE_PATH, "- middle note", NOW + 1);
        yield* writeWorkspaceFile(userId, "memory/2026-09-11.md", "", NOW + 2);
        yield* writeWorkspaceFile(userId, "memory/2026-09-09-standup.md", "- slug", NOW + 3);
        // Newest day first; within a day the plain note precedes its slugged variants, in byte order.
        assert.deepEqual(
          [...(yield* listDailyNotes(userId, 60))],
          [
            { path: "memory/2026-09-11.md", chars: 0 },
            { path: NOTE_PATH, chars: 13 },
            { path: "memory/2026-09-09-standup.md", chars: 6 },
            { path: "memory/2026-09-07.md", chars: 8 },
          ],
        );
        assert.deepEqual(
          [...(yield* listDailyNotes(userId, 2))],
          [
            { path: "memory/2026-09-11.md", chars: 0 },
            { path: NOTE_PATH, chars: 13 },
          ],
        );
        // Another account's notes are not this one's.
        const other = yield* openUser;
        assert.deepEqual([...(yield* listDailyNotes(other, 60))], []);
      }),
  );

  it.effect(
    "revises a file from what stands, creating it where none does, and leaves it as it was where the revision declines",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const grow = (entry: string) => (existing: string | undefined) =>
          existing === undefined ? entry : `${existing}\n\n${entry}`;
        assert.equal(yield* reviseWorkspaceFile(userId, NOTE_PATH, grow("- one"), NOW), "- one");
        assert.equal(
          yield* reviseWorkspaceFile(userId, NOTE_PATH, grow("- two"), NOW + 1),
          "- one\n\n- two",
        );
        assert.equal(
          yield* reviseWorkspaceFile(userId, NOTE_PATH, () => undefined, NOW + 2),
          undefined,
        );
        assert.deepEqual(Option.getOrUndefined(yield* readWorkspaceFile(userId, NOTE_PATH)), {
          path: NOTE_PATH,
          content: "- one\n\n- two",
          createdAt: NOW,
          updatedAt: NOW + 1,
        });
        // A declined revision of a file that never stood creates nothing.
        assert.equal(
          yield* reviseWorkspaceFile(userId, "memory/2026-09-10.md", () => undefined, NOW),
          undefined,
        );
        assert.equal((yield* listWorkspaceFiles(userId)).length, 1);
        // Revisions in flight together land one after the other: every entry survives.
        const entries = ["- a", "- b", "- c", "- d", "- e", "- f"];
        yield* Effect.forEach(
          entries,
          (entry) => reviseWorkspaceFile(userId, NOTE_PATH, grow(entry), NOW + 3),
          { concurrency: "unbounded" },
        );
        const grown = Option.getOrUndefined(yield* readWorkspaceFile(userId, NOTE_PATH));
        assert.ok(grown);
        for (const entry of entries) assert.ok(grown.content.includes(entry), entry);
        assert.equal(grown.content.split("\n\n").length, 2 + entries.length);
        const outside = yield* Effect.exit(
          reviseWorkspaceFile(userId, "../SOUL.md", grow("- x"), NOW),
        );
        assert.equal(Exit.isFailure(outside), true);
      }),
  );

  it.effect("a revision's lock and write are inside its own transaction and undone with it", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const sql = yield* SqlClient.SqlClient;
      const ended = yield* Effect.exit(
        Effect.provideService(
          reviseWorkspaceFile(userId, NOTE_PATH, () => "- inside", NOW),
          SqlClient.SqlClient,
          transactionsFailingAfter(sql),
        ),
      );
      assert.equal(Exit.isFailure(ended), true);
      // Nothing stands: the bridged lock and upsert ran on the transaction's
      // own connection rather than beside it, so they were undone with it.
      assert.equal(Option.isNone(yield* readWorkspaceFile(userId, NOTE_PATH)), true);
      assert.deepEqual([...(yield* listWorkspaceFiles(userId))], []);
    }),
  );

  it.effect("fails a path outside the workspace and writes nothing for it", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      for (const path of OUTSIDE_PATHS) {
        const written = yield* Effect.exit(writeWorkspaceFile(userId, path, "x", NOW));
        assert.equal(Exit.isFailure(written), true);
        const read = yield* Effect.exit(readWorkspaceFile(userId, path));
        assert.equal(Exit.isFailure(read), true);
      }
      assert.deepEqual([...(yield* listWorkspaceFiles(userId))], []);
    }),
  );
});
