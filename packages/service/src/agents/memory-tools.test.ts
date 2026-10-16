import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { listMemories, MEMORY_OUTCOME } from "@luke/database/models/memory-store";
import { user } from "@luke/database/schemas/auth";
import { getTestDB, openWorkspace } from "@luke/database/testing";
import { noDatabase } from "@luke/database/testing/no-database";
import { MEMORY_BOUNDS } from "@luke/features/memory-wire";
import { Duration, Effect } from "effect";
import { TestClock } from "effect/testing";
import { ACTION_RESULT_STATUS, isRecord, isWireString, type WireRecord } from "../core.js";
import { type MemoryCall, runRecall, runRemember } from "./memory-tools.js";

/**
 * The planning model's `remember` and `recall` through their public
 * functions, over a real dialect: a memory kept is recalled by the words it
 * holds, best match first, a correction leaves only the corrected words to
 * recall, words that look like a credential are never kept, an input that
 * does not read keeps and recalls nothing, and a store that cannot be
 * reached answers the model rather than failing the turn.
 *
 * Synthetic accounts, workspaces, and words throughout.
 */

/** A call in a workspace of its own, as the member who owns it. */
const openCall = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  const call: MemoryCall = { workspaceId: yield* openWorkspace(userId), userId };
  return call;
});

const TESTS_RUN = "The web server's store tests run on PGlite through test:store.";
const DEPLOYS = "Deployments go out from the main branch through Vercel.";
const DEPLOYS_CORRECTED = "Deployments go out from the release branch through Vercel.";

/** A recall's answer, the memories it names by their words. */
function recalledWords(answer: WireRecord): readonly unknown[] {
  assert.equal(answer.status, ACTION_RESULT_STATUS.ACCEPTED);
  assert.ok(Array.isArray(answer.memories));
  return answer.memories.map((memory) => (isRecord(memory) ? memory.text : memory));
}

/** The id of the memory a remember answer kept. */
function keptId(answer: WireRecord): string {
  assert.equal(answer.status, ACTION_RESULT_STATUS.ACCEPTED);
  const kept = answer.memory;
  assert.ok(isRecord(kept) && isWireString(kept.id));
  return kept.id;
}

it.layer(getTestDB())("the planning model's memory tools", (it) => {
  it.effect(
    "a memory kept is recalled by the words it holds, a query with none answers the newest first, and one that finds nothing answers none",
    () =>
      Effect.gen(function* () {
        const call = yield* openCall;

        assert.equal((yield* runRemember(call, { text: TESTS_RUN })).outcome, MEMORY_OUTCOME.KEPT);
        yield* TestClock.adjust(Duration.seconds(1));
        yield* runRemember(call, { text: DEPLOYS });

        assert.deepEqual(recalledWords(yield* runRecall(call, { query: "how do tests run" })), [
          TESTS_RUN,
        ]);
        // A query word finds the memory words it begins.
        assert.deepEqual(recalledWords(yield* runRecall(call, { query: "deploy" })), [DEPLOYS]);
        assert.deepEqual(recalledWords(yield* runRecall(call, { query: "kubernetes" })), []);
        const recent = yield* runRecall(call, {});
        assert.deepEqual(recalledWords(recent), [DEPLOYS, TESTS_RUN]);
        assert.equal(recent.total, 2);
      }),
  );

  it.effect("a correction leaves only the corrected words to recall", () =>
    Effect.gen(function* () {
      const call = yield* openCall;
      const id = keptId(yield* runRemember(call, { text: DEPLOYS }));

      const corrected = yield* runRemember(call, { text: DEPLOYS_CORRECTED, replaces: id });

      assert.equal(corrected.outcome, MEMORY_OUTCOME.CORRECTED);
      assert.equal(keptId(corrected), id);
      assert.deepEqual(recalledWords(yield* runRecall(call, { query: "deployments branch" })), [
        DEPLOYS_CORRECTED,
      ]);
    }),
  );

  it.effect(
    "a correction of a memory that is gone, or a new memory past the bound, is refused",
    () =>
      Effect.gen(function* () {
        const call = yield* openCall;
        const gone = randomUUID();

        const late = yield* runRemember(call, { text: DEPLOYS, replaces: gone });
        for (let index = 0; index < MEMORY_BOUNDS.MAX_MEMORIES; index += 1) {
          yield* runRemember(call, { text: `Convention number ${index}.` });
        }
        const past = yield* runRemember(call, { text: DEPLOYS });

        assert.equal(late.status, ACTION_RESULT_STATUS.REJECTED);
        assert.equal(past.status, ACTION_RESULT_STATUS.REJECTED);
        assert.notEqual(late.reason, past.reason);
        assert.equal((yield* listMemories(call.workspaceId)).length, MEMORY_BOUNDS.MAX_MEMORIES);
      }),
  );

  it.effect("words that look like a credential are never kept, and the fact without it is", () =>
    Effect.gen(function* () {
      const call = yield* openCall;
      const credentials = [
        // Note that the token-shaped samples are built here rather than written whole, so no tracked line holds a credential's shape.
        `The staging key is ${["sk", "proj", "AbCdEfGh1234567890IjKlMnOp"].join("-")}.`,
        `CI pushes with ${["ghp", "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"].join("_")}.`,
        "The database is postgres://deploy:hunter2hunter2@db.internal:5432/app.",
        "Staging password: correct-horse-battery",
        "The webhook secret is Zx81kQp0Lm3NvB7tR2yWc5dF9gH4jK6s.",
        `${"-".repeat(5)}BEGIN RSA PRIVATE KEY${"-".repeat(5)} MIIEow`,
      ];

      for (const text of credentials) {
        const answer = yield* runRemember(call, { text });
        assert.equal(answer.status, ACTION_RESULT_STATUS.REJECTED, text);
      }
      const fact =
        "Staging credentials live in the team's 1Password vault, commit 3f2a9c1e8b7d6a5f4e3d2c1b0a9f8e7d6c5b4a39.";
      assert.equal((yield* runRemember(call, { text: fact })).outcome, MEMORY_OUTCOME.KEPT);

      assert.deepEqual(
        (yield* listMemories(call.workspaceId)).map((kept) => kept.text),
        [fact],
      );
    }),
  );

  it.effect("a call that does not read keeps and recalls nothing", () =>
    Effect.gen(function* () {
      const call = yield* openCall;

      const unread = [
        yield* runRemember(call, { text: "   " }),
        yield* runRemember(call, { text: "x".repeat(MEMORY_BOUNDS.MAX_CHARS + 1) }),
        yield* runRemember(call, { text: DEPLOYS, replaces: "not-an-id" }),
        yield* runRecall(call, { query: 7 }),
      ];

      assert.deepEqual(
        unread.map((answer) => answer.status),
        unread.map(() => ACTION_RESULT_STATUS.REJECTED),
      );
      assert.deepEqual(yield* listMemories(call.workspaceId), []);
    }),
  );
});

it.effect(
  "a store that cannot be reached answers the model that memory is unavailable, and fails nothing",
  () =>
    Effect.gen(function* () {
      const call = { workspaceId: randomUUID(), userId: "user-unreached" };

      const remembered = yield* runRemember(call, { text: DEPLOYS });
      const recalled = yield* runRecall(call, { query: "deployments" });

      assert.equal(remembered.status, ACTION_RESULT_STATUS.REJECTED);
      assert.equal(recalled.status, ACTION_RESULT_STATUS.REJECTED);
      assert.equal(remembered.reason, recalled.reason);
    }).pipe(Effect.provide(noDatabase)),
);
