import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import type { LiveStatement } from "@luke/database/core/live-statement";
import { Database, type DatabaseServices } from "@luke/database/core/query";
import { listPages, writePage } from "@luke/database/models/plan-pages";
import { readTaskPlan, savePlanText, updateTask } from "@luke/database/models/task-store";
import { user } from "@luke/database/schemas/auth";
import { getTestDB, joinWorkspace, startTask } from "@luke/database/testing";
import { type TaskRecordLiveRows, taskRecordLiveRowsSchema } from "@luke/features/live-wire";
import { PAGE_SHOWER, taskPageOwner } from "@luke/features/page-wire";
import { Duration, Effect, Option, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { taskRecordLiveStatements } from "./task-record-live.js";

/**
 * An open task's record as Realtime would deliver it, over the real
 * migrations on PGlite: each part's statement run as Realtime runs it and its
 * rows decoded as the desktop decodes them, beside the held reads the desktop
 * reads that part with (`listPages`, `readTranscript`). A part
 * moves exactly when its held read would answer something new.
 *
 * Synthetic accounts, pages, and words throughout.
 */

const PARTS = ["plan", "pages", "calls", "code"] as const;

type Part = (typeof PARTS)[number];

/** The parts a held read answers: the plan and the pages; no desktop reads the calls or the code again. */
const HELD_PARTS = ["plan", "pages"] as const;

/** A new account, as the store holds one. */
const openUser = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

/** One part's statement run as Realtime runs it. */
const runLive = (statement: LiveStatement) =>
  Effect.flatMap(SqlClient.SqlClient, (sql) => sql.unsafe(statement.sql, [...statement.params]));

/** The task's record as Realtime would deliver it to `reader`, decoded as the desktop decodes it. */
const liveRecordOf = (reader: string, taskId: string) =>
  Effect.gen(function* () {
    const statements = Option.getOrThrow(taskRecordLiveStatements(reader, taskId));
    return yield* Schema.decodeUnknownEffect(taskRecordLiveRowsSchema)({
      plan: yield* runLive(statements.plan),
      pages: yield* runLive(statements.pages),
      calls: yield* runLive(statements.calls),
      code: yield* runLive(statements.code),
    });
  });

/** The parts as the desktop reads them today, each as its held read answers it. */
const heldRecordOf = (reader: string, taskId: string) =>
  Effect.gen(function* () {
    return {
      plan: yield* readTaskPlan(reader, taskId),
      pages: yield* listPages(reader, taskPageOwner(taskId)),
    };
  });

/** The record as its held reads answer it. */
type HeldRecord = Effect.Success<ReturnType<typeof heldRecordOf>>;

/** The parts whose value differs between two live readings, by their text, as the desktop compares deliveries. */
function movedParts(before: TaskRecordLiveRows, after: TaskRecordLiveRows): readonly Part[] {
  return PARTS.filter((part) => JSON.stringify(before[part]) !== JSON.stringify(after[part]));
}

/** The parts whose value differs between two held readings: the moves a live delivery says, the calls apart. */
function movedHeld(before: HeldRecord, after: HeldRecord): readonly Part[] {
  return HELD_PARTS.filter((part) => JSON.stringify(before[part]) !== JSON.stringify(after[part]));
}

/** The moves a held reading makes for the live ones expected: the plan's and the pages'. */
function heldOf(expected: readonly Part[]): readonly Part[] {
  return expected.filter((part) => part !== "calls" && part !== "code");
}

it.layer(getTestDB())("a task's record followed live", (it) => {
  it.effect(
    "each part moves exactly when its held read would answer something new, as a page is shown; and a stranger reads no rows",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const stranger = yield* openUser;
        const task = yield* startTask(owner, { name: "Teammate invitations" });
        const other = yield* startTask(owner, { name: "Billing" });

        let live = yield* liveRecordOf(owner, task.id);
        let held = yield* heldRecordOf(owner, task.id);
        const step = (
          expected: readonly Part[],
          write: Effect.Effect<unknown, unknown, DatabaseServices>,
        ) =>
          Effect.gen(function* () {
            yield* Effect.orDie(write);
            const nextLive = yield* liveRecordOf(owner, task.id);
            const nextHeld = yield* heldRecordOf(owner, task.id);
            assert.deepEqual(movedHeld(held, nextHeld), heldOf(expected), "the held reads moved");
            assert.deepEqual(movedParts(live, nextLive), expected, "the live marks moved");
            live = nextLive;
            held = nextHeld;
          });

        assert.deepEqual(live, {
          plan: [{ taskId: task.id, savedAt: Option.getOrThrow(held.plan).updatedAt }],
          pages: [],
          calls: [],
          code: [],
        });

        const shown = Option.getOrThrow(
          yield* writePage(
            owner,
            taskPageOwner(task.id),
            { title: "Invite funnel", html: "<p>One</p>" },
            { kind: PAGE_SHOWER.LUKE },
          ),
        );
        live = yield* liveRecordOf(owner, task.id);
        held = yield* heldRecordOf(owner, task.id);
        assert.deepEqual(live.pages, [{ pageId: shown.id, version: 1 }]);
        yield* step(
          ["pages"],
          writePage(
            owner,
            taskPageOwner(task.id),
            { pageId: shown.id, title: "Invite funnel", html: "<p>Two</p>" },
            { kind: PAGE_SHOWER.LUKE },
          ),
        );

        // Another task's record moving moves nothing of this one's.
        yield* step(
          [],
          writePage(
            owner,
            taskPageOwner(other.id),
            { title: "Billing funnel", html: "<p>One</p>" },
            { kind: PAGE_SHOWER.LUKE },
          ),
        );
        assert.deepEqual(yield* liveRecordOf(stranger, task.id), {
          plan: [],
          pages: [],
          calls: [],
          code: [],
        });
      }),
  );

  it.effect(
    "the plan moves for a teammate as anyone saves its text, at the instant the open document reads as its last save, and not as it is renamed; a stranger reads none",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const teammate = yield* openUser;
        const stranger = yield* openUser;
        const task = yield* startTask(owner, { name: "Teammate invitations" });
        yield* joinWorkspace(task.workspaceId, teammate);

        let live = yield* liveRecordOf(teammate, task.id);
        const step = (
          expected: readonly Part[],
          write: Effect.Effect<unknown, unknown, DatabaseServices>,
        ) =>
          Effect.gen(function* () {
            yield* TestClock.adjust(Duration.seconds(1));
            yield* Effect.orDie(write);
            const nextLive = yield* liveRecordOf(teammate, task.id);
            const nextHeld = yield* heldRecordOf(teammate, task.id);
            assert.deepEqual(movedParts(live, nextLive), expected, "the live marks moved");
            assert.deepEqual(
              nextLive.plan.map((plan) => plan.savedAt),
              [Option.getOrThrow(nextHeld.plan).updatedAt],
              "the mark is the open document's last save",
            );
            live = nextLive;
          });

        yield* step(["plan"], savePlanText(owner, task.id, "## Invites\n\nThey expire."));
        yield* step(["plan"], savePlanText(teammate, task.id, "## Invites\n\nA week."));
        yield* step([], updateTask(owner, task.id, { name: "Invitations" }));
        assert.deepEqual((yield* liveRecordOf(stranger, task.id)).plan, []);
      }),
  );
});
