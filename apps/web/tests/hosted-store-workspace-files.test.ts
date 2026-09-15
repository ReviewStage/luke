import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Effect, Exit, Option } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { payloadKeyRing } from "../server/hosted/encryption";
import { userSeal } from "../server/hosted/store/database";
import {
  deleteWorkspaceFile,
  listDailyNotes,
  listWorkspaceFiles,
  readWorkspaceFile,
  reviseWorkspaceFile,
  seedWorkspaceFile,
  writeWorkspaceFile,
} from "../server/hosted/store/workspace-files";
import { TEST_PAYLOAD_SECRET } from "./support/hosted-store-database";
import { testSqlClient } from "./support/sql-client";

/**
 * The first store module read as what it now is: effects over the ambient
 * `SqlClient`, on whichever dialect this run stands over. `hosted-store.test.ts`
 * holds the same behaviour through the promise door the routes hold; these are
 * the two things only the effect surface can state — that the instants decode
 * to numbers whichever driver read the `bigint`, and that a path outside the
 * workspace fails the effect rather than reaching a statement.
 *
 * Synthetic fixtures: no real path or note anywhere.
 */

const NOW = 1_800_000_000_000;

const NOTE_PATH = "memory/2026-09-09.md";

const OUTSIDE_PATHS = ["/etc/passwd", "../SOUL.md", "memory/../../x", "", "a//b", "a\\b"];

const openUser = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const userId = `user-${randomUUID()}`;
  yield* sql`
    insert into "user" (id, name, email)
    values (${userId}, ${"Test User"}, ${`${userId}@luke.test`})
  `;
  return { userId, seal: userSeal(payloadKeyRing(TEST_PAYLOAD_SECRET), userId) };
});

it.layer(testSqlClient)("the workspace files over effect/unstable/sql", (it) => {
  it.effect("seeds once, writes whole, and answers the instants as numbers", () =>
    Effect.gen(function* () {
      const { userId, seal } = yield* openUser;
      assert.equal(Option.isNone(yield* readWorkspaceFile(seal, userId, "AGENTS.md")), true);
      assert.equal(yield* seedWorkspaceFile(seal, userId, "AGENTS.md", "# seed", NOW), true);
      assert.equal(yield* seedWorkspaceFile(seal, userId, "AGENTS.md", "# later", NOW + 1), false);
      yield* writeWorkspaceFile(seal, userId, NOTE_PATH, "- a note", NOW + 2);
      yield* writeWorkspaceFile(seal, userId, "AGENTS.md", "# edited", NOW + 3);

      const found = yield* readWorkspaceFile(seal, userId, "AGENTS.md");
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

      assert.equal(yield* deleteWorkspaceFile(userId, NOTE_PATH), true);
      assert.equal(yield* deleteWorkspaceFile(userId, NOTE_PATH), false);
      assert.equal((yield* listWorkspaceFiles(userId)).length, 1);
    }),
  );

  it.effect(
    "lists the dated notes alone, newest first and bounded, each counted and none of it read back",
    () =>
      Effect.gen(function* () {
        const { userId, seal } = yield* openUser;
        yield* writeWorkspaceFile(seal, userId, "MEMORY.md", "# MEMORY.md", NOW);
        yield* writeWorkspaceFile(seal, userId, "memory/2026-09-07.md", "- oldest", NOW);
        yield* writeWorkspaceFile(seal, userId, NOTE_PATH, "- middle note", NOW + 1);
        yield* writeWorkspaceFile(seal, userId, "memory/2026-09-11.md", "", NOW + 2);
        yield* writeWorkspaceFile(seal, userId, "memory/2026-09-09-standup.md", "- slug", NOW + 3);
        // Newest day first; within a day the plain note precedes its slugged variants, in byte order.
        assert.deepEqual(
          [...(yield* listDailyNotes(seal, userId, 60))],
          [
            { path: "memory/2026-09-11.md", chars: 0 },
            { path: NOTE_PATH, chars: 13 },
            { path: "memory/2026-09-09-standup.md", chars: 6 },
            { path: "memory/2026-09-07.md", chars: 8 },
          ],
        );
        assert.deepEqual(
          [...(yield* listDailyNotes(seal, userId, 2))],
          [
            { path: "memory/2026-09-11.md", chars: 0 },
            { path: NOTE_PATH, chars: 13 },
          ],
        );
        // Another account's notes are not this one's.
        const other = yield* openUser;
        assert.deepEqual([...(yield* listDailyNotes(other.seal, other.userId, 60))], []);
      }),
  );

  it.effect(
    "revises a file from what stands, creating it where none does, and leaves it as it was where the revision declines",
    () =>
      Effect.gen(function* () {
        const { userId, seal } = yield* openUser;
        const grow = (entry: string) => (existing: string | undefined) =>
          existing === undefined ? entry : `${existing}\n\n${entry}`;
        assert.equal(
          yield* reviseWorkspaceFile(seal, userId, NOTE_PATH, grow("- one"), NOW),
          "- one",
        );
        assert.equal(
          yield* reviseWorkspaceFile(seal, userId, NOTE_PATH, grow("- two"), NOW + 1),
          "- one\n\n- two",
        );
        assert.equal(
          yield* reviseWorkspaceFile(seal, userId, NOTE_PATH, () => undefined, NOW + 2),
          undefined,
        );
        assert.deepEqual(Option.getOrUndefined(yield* readWorkspaceFile(seal, userId, NOTE_PATH)), {
          path: NOTE_PATH,
          content: "- one\n\n- two",
          createdAt: NOW,
          updatedAt: NOW + 1,
        });
        // A declined revision of a file that never stood creates nothing.
        assert.equal(
          yield* reviseWorkspaceFile(seal, userId, "memory/2026-09-10.md", () => undefined, NOW),
          undefined,
        );
        assert.equal((yield* listWorkspaceFiles(userId)).length, 1);
        // Revisions in flight together land one after the other: every entry survives.
        const entries = ["- a", "- b", "- c", "- d", "- e", "- f"];
        yield* Effect.forEach(
          entries,
          (entry) => reviseWorkspaceFile(seal, userId, NOTE_PATH, grow(entry), NOW + 3),
          { concurrency: "unbounded" },
        );
        const grown = Option.getOrUndefined(yield* readWorkspaceFile(seal, userId, NOTE_PATH));
        assert.ok(grown);
        for (const entry of entries) assert.ok(grown.content.includes(entry), entry);
        assert.equal(grown.content.split("\n\n").length, 2 + entries.length);
        const outside = yield* Effect.exit(
          reviseWorkspaceFile(seal, userId, "../SOUL.md", grow("- x"), NOW),
        );
        assert.equal(Exit.isFailure(outside), true);
      }),
  );

  it.effect("fails a path outside the workspace and writes nothing for it", () =>
    Effect.gen(function* () {
      const { userId, seal } = yield* openUser;
      for (const path of OUTSIDE_PATHS) {
        const written = yield* Effect.exit(writeWorkspaceFile(seal, userId, path, "x", NOW));
        assert.equal(Exit.isFailure(written), true);
        const read = yield* Effect.exit(readWorkspaceFile(seal, userId, path));
        assert.equal(Exit.isFailure(read), true);
        const removed = yield* Effect.exit(deleteWorkspaceFile(userId, path));
        assert.equal(Exit.isFailure(removed), true);
      }
      assert.deepEqual([...(yield* listWorkspaceFiles(userId))], []);
    }),
  );
});
