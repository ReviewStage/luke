import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as SqlClient from "@effect/sql/SqlClient";
import { it } from "@effect/vitest";
import { Effect, Exit, Option } from "effect";
import { payloadKeyRing } from "../server/hosted/encryption";
import { userSeal } from "../server/hosted/store/database";
import {
  deleteWorkspaceFile,
  listWorkspaceFiles,
  readWorkspaceFile,
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

it.layer(testSqlClient)("the workspace files over @effect/sql", (it) => {
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
