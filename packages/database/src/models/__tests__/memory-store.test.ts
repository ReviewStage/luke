import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { MEMORY_BOUNDS } from "@luke/features/memory-wire";
import { eq } from "drizzle-orm";
import { Duration, Effect } from "effect";
import { TestClock } from "effect/testing";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { memory } from "../../schemas/memory.js";
import { getTestDB, joinWorkspace, leaveWorkspace, openWorkspace } from "../../testing/index.js";
import {
  forgetMemory,
  listMemories,
  MEMORY_FORGET,
  MEMORY_OUTCOME,
  type MemoryOutcome,
  rememberMemory,
} from "../memory-store.js";

/**
 * A workspace's shared memories as the planning model keeps and corrects
 * them and Settings reads and forgets them, over a real dialect: every
 * member keeps into and reads the same memory, and nothing crosses into
 * another workspace; the same words kept twice stand once and stay the
 * words of whoever kept them first; a correction rewrites the memory in
 * place as the corrector's words; two corrections at once leave one memory;
 * a forgotten memory is gone for good, and only the member whose words it
 * holds or one who manages the workspace may forget it; the bound refuses a
 * new memory and never a correction; and a memory outlives the member who
 * said it, as git history outlives its committers: one who leaves leaves
 * their memories with the workspace, and an account deleted leaves them too,
 * named by nobody, which then only a manager may forget.
 *
 * Synthetic accounts, workspaces, and words throughout.
 */

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

/** A workspace with its owner and one more member. */
const openTeam = Effect.gen(function* () {
  const owner = yield* openAccount;
  const teammate = yield* openAccount;
  const workspaceId = yield* openWorkspace(owner);
  yield* joinWorkspace(workspaceId, teammate);
  return { owner, teammate, workspaceId };
});

const TESTS_RUN = "The web server's store tests run on PGlite through test:store.";
const DEPLOYS = "Deployments go out from the main branch through Vercel.";
const DEPLOYS_CORRECTED = "Deployments go out from the release branch through Vercel.";

/** The id of the memory a keep or a correction wrote. */
function keptId(outcome: MemoryOutcome): string {
  assert.ok("memory" in outcome, `nothing was written: ${outcome.kind}`);
  return outcome.memory.id;
}

const wordsOf = (workspaceId: string) =>
  Effect.map(listMemories(workspaceId), (memories) => memories.map((kept) => kept.text));

it.layer(getTestDB())("the workspace's memory store", (it) => {
  it.effect(
    "every member keeps into one memory, listed most recently kept first, and the same words kept again stand once as the first keeper's",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, workspaceId } = yield* openTeam;

        assert.equal(
          (yield* rememberMemory(workspaceId, owner, TESTS_RUN, undefined)).kind,
          MEMORY_OUTCOME.KEPT,
        );
        yield* TestClock.adjust(Duration.seconds(1));
        yield* rememberMemory(workspaceId, teammate, DEPLOYS, undefined);
        yield* TestClock.adjust(Duration.seconds(1));
        // A teammate's call settling the same fact, spelled a little differently, is the same memory.
        const again = yield* rememberMemory(
          workspaceId,
          teammate,
          `  ${TESTS_RUN.toUpperCase()}`,
          undefined,
        );

        assert.equal(again.kind, MEMORY_OUTCOME.ALREADY_KEPT);
        const standing = yield* listMemories(workspaceId);
        assert.deepEqual(
          standing.map((kept) => [kept.text, kept.userId]),
          [
            [`  ${TESTS_RUN.toUpperCase()}`, owner],
            [DEPLOYS, teammate],
          ],
        );
      }),
  );

  it.effect(
    "a correction rewrites the memory in place under its id, as the corrector's words",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, workspaceId } = yield* openTeam;
        const id = keptId(yield* rememberMemory(workspaceId, owner, DEPLOYS, undefined));

        const corrected = yield* rememberMemory(
          workspaceId,
          teammate,
          DEPLOYS_CORRECTED,
          id.toUpperCase(),
        );

        assert.equal(corrected.kind, MEMORY_OUTCOME.CORRECTED);
        assert.equal(keptId(corrected), id);
        assert.deepEqual(
          (yield* listMemories(workspaceId)).map((kept) => [kept.text, kept.userId]),
          [[DEPLOYS_CORRECTED, teammate]],
        );
      }),
  );

  it.effect("a correction into words another memory already holds leaves that one memory", () =>
    Effect.gen(function* () {
      const { owner, workspaceId } = yield* openTeam;
      const old = keptId(yield* rememberMemory(workspaceId, owner, DEPLOYS, undefined));
      const standing = keptId(
        yield* rememberMemory(workspaceId, owner, DEPLOYS_CORRECTED, undefined),
      );

      const folded = yield* rememberMemory(workspaceId, owner, DEPLOYS_CORRECTED, old);

      assert.equal(keptId(folded), standing);
      assert.deepEqual(yield* wordsOf(workspaceId), [DEPLOYS_CORRECTED]);
    }),
  );

  it.effect(
    "two members' corrections of one memory at once leave one memory, holding one of them whole",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, workspaceId } = yield* openTeam;
        const id = keptId(yield* rememberMemory(workspaceId, owner, DEPLOYS, undefined));
        const first = "Deployments go out from the release branch.";
        const second = "Deployments go out from a tag.";

        yield* Effect.all(
          [
            rememberMemory(workspaceId, owner, first, id),
            rememberMemory(workspaceId, teammate, second, id),
          ],
          { concurrency: "unbounded" },
        );

        const standing = yield* wordsOf(workspaceId);
        assert.equal(standing.length, 1);
        assert.ok([first, second].includes(standing[0] ?? ""));
      }),
  );

  it.effect("another workspace's memory is never listed, corrected, or forgotten", () =>
    Effect.gen(function* () {
      const { owner, workspaceId } = yield* openTeam;
      // The same account in a second workspace of its own still reaches none of the first's memories.
      const elsewhere = yield* openWorkspace(owner);
      const id = keptId(yield* rememberMemory(workspaceId, owner, DEPLOYS, undefined));

      assert.deepEqual(yield* listMemories(elsewhere), []);
      assert.equal(
        (yield* rememberMemory(elsewhere, owner, DEPLOYS_CORRECTED, id)).kind,
        MEMORY_OUTCOME.NOT_FOUND,
      );
      yield* forgetMemory(elsewhere, id, { userId: owner, manages: true });

      assert.deepEqual(yield* wordsOf(workspaceId), [DEPLOYS]);
    }),
  );

  it.effect(
    "a memory is forgotten by the member whose words it holds or one who manages the workspace, and by no other member",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, workspaceId } = yield* openTeam;
        const third = yield* openAccount;
        yield* joinWorkspace(workspaceId, third);
        const owners = keptId(yield* rememberMemory(workspaceId, owner, DEPLOYS, undefined));
        const teammates = keptId(
          yield* rememberMemory(workspaceId, teammate, TESTS_RUN, undefined),
        );

        const refused = yield* forgetMemory(workspaceId, owners, { userId: third, manages: false });
        const ownWords = yield* forgetMemory(workspaceId, teammates, {
          userId: teammate,
          manages: false,
        });
        const managed = yield* forgetMemory(workspaceId, owners, { userId: third, manages: true });

        assert.equal(refused, MEMORY_FORGET.NOT_PERMITTED);
        assert.equal(ownWords, MEMORY_FORGET.FORGOTTEN);
        assert.equal(managed, MEMORY_FORGET.FORGOTTEN);
        assert.deepEqual(yield* wordsOf(workspaceId), []);
      }),
  );

  it.effect("a forgotten memory is gone for good, and a correction of it writes nothing", () =>
    Effect.gen(function* () {
      const { owner, workspaceId } = yield* openTeam;
      const id = keptId(yield* rememberMemory(workspaceId, owner, DEPLOYS, undefined));
      yield* rememberMemory(workspaceId, owner, TESTS_RUN, undefined);
      const by = { userId: owner, manages: false };

      assert.equal(yield* forgetMemory(workspaceId, id, by), MEMORY_FORGET.FORGOTTEN);
      // Forgetting twice, or by an id that is no memory's, answers the same and fails nothing.
      assert.equal(yield* forgetMemory(workspaceId, id, by), MEMORY_FORGET.FORGOTTEN);
      assert.equal(yield* forgetMemory(workspaceId, "not-a-memory", by), MEMORY_FORGET.FORGOTTEN);

      const late = yield* rememberMemory(workspaceId, owner, DEPLOYS_CORRECTED, id);
      assert.equal(late.kind, MEMORY_OUTCOME.NOT_FOUND);
      assert.deepEqual(yield* wordsOf(workspaceId), [TESTS_RUN]);
    }),
  );

  it.effect("a full workspace refuses a new memory and still takes a correction", () =>
    Effect.gen(function* () {
      const db = yield* Database;
      const { owner, workspaceId } = yield* openTeam;
      const now = new Date(0);
      yield* db.insert(memory).values(
        Array.from({ length: MEMORY_BOUNDS.MAX_MEMORIES }, (_, index) => ({
          organizationId: workspaceId,
          userId: owner,
          text: `Convention number ${index}.`,
          createdAt: now,
          updatedAt: now,
        })),
      );
      const [oldest] = yield* listMemories(workspaceId);
      assert.ok(oldest !== undefined);

      const refused = yield* rememberMemory(workspaceId, owner, DEPLOYS, undefined);
      const corrected = yield* rememberMemory(workspaceId, owner, DEPLOYS, oldest.id);

      assert.equal(refused.kind, MEMORY_OUTCOME.FULL);
      assert.equal(corrected.kind, MEMORY_OUTCOME.CORRECTED);
      assert.equal((yield* listMemories(workspaceId)).length, MEMORY_BOUNDS.MAX_MEMORIES);
    }),
  );

  it.effect(
    "a memory outlives its member: one who leaves leaves it with the workspace, and an account deleted leaves it named by nobody, which then only a manager may forget",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const { owner, teammate, workspaceId } = yield* openTeam;
        yield* rememberMemory(workspaceId, owner, DEPLOYS, undefined);
        yield* rememberMemory(workspaceId, teammate, TESTS_RUN, undefined);

        yield* leaveWorkspace(workspaceId, teammate);
        const afterLeaving = yield* wordsOf(workspaceId);
        yield* db.delete(user).where(eq(user.id, teammate));
        const afterDeleting = yield* listMemories(workspaceId);
        const orphan = afterDeleting.find((kept) => kept.text === TESTS_RUN);
        assert.ok(orphan !== undefined);
        const byMember = yield* forgetMemory(workspaceId, orphan.id, {
          userId: owner,
          manages: false,
        });

        assert.deepEqual(afterLeaving.toSorted(), [DEPLOYS, TESTS_RUN].toSorted());
        assert.deepEqual(
          afterDeleting.map((kept) => [kept.text, kept.userId]).toSorted(),
          [
            [DEPLOYS, owner],
            [TESTS_RUN, null],
          ].toSorted(),
        );
        assert.equal(byMember, MEMORY_FORGET.NOT_PERMITTED);
        assert.equal(
          yield* forgetMemory(workspaceId, orphan.id, { userId: owner, manages: true }),
          MEMORY_FORGET.FORGOTTEN,
        );
      }),
  );

  it.effect("a workspace that names nothing keeps nothing", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const gone = randomUUID();

      assert.equal(
        (yield* rememberMemory(gone, owner, DEPLOYS, undefined)).kind,
        MEMORY_OUTCOME.NOT_FOUND,
      );
      assert.deepEqual(yield* listMemories(gone), []);
    }),
  );
});
