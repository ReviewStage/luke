import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import type { LiveStatement } from "@luke/database/core/live-statement";
import { Database } from "@luke/database/core/query";
import { createCodingAgent } from "@luke/database/models/coding-agent-store";
import { listRevisions } from "@luke/database/models/plan-revisions";
import { user } from "@luke/database/schemas/auth";
import { planRevision } from "@luke/database/schemas/plan-revision";
import { getTestDB, startTask } from "@luke/database/testing";
import { revisionsOfLiveRows, taskHistoryLiveRowsSchema } from "@luke/features/live-wire";
import { PLAN_ACTOR, PLAN_HISTORY_BOUNDS } from "@luke/features/task-wire";
import { Duration, Effect, Option, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { added } from "../testing/task-contents.js";
import { restoreRevision, saveNotes } from "./plan-notes.js";
import { taskHistoryLiveStatements } from "./task-history-live.js";

/**
 * A task's newest page of plan history as Realtime would deliver it, over
 * the real migrations on PGlite: the statement run as Realtime runs it, its
 * rows decoded and ordered as the desktop does, beside `listRevisions`, the
 * held read the version history read it with. The two agree as Luke, a
 * coding agent, and the developer save, a revision is restored,
 * the history outgrows a page, and for an account that does not reach the
 * task.
 *
 * Synthetic accounts, tasks, and words throughout.
 */

/** A new account, as the store holds one. */
const openUser = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

/** The statement run as Realtime runs it. */
const runLive = (statement: LiveStatement) =>
  Effect.flatMap(SqlClient.SqlClient, (sql) => sql.unsafe(statement.sql, [...statement.params]));

/** The newest page of the task's history as Realtime would deliver it to `reader`, as the desktop reads it. */
const liveHistoryOf = (reader: string, taskId: string) =>
  Effect.gen(function* () {
    const statements = Option.getOrThrow(taskHistoryLiveStatements(reader, taskId));
    const rows = yield* Schema.decodeUnknownEffect(taskHistoryLiveRowsSchema)({
      revisions: yield* runLive(statements.revisions),
    });
    return revisionsOfLiveRows(rows);
  });

it.layer(getTestDB())("a task's history followed live", (it) => {
  it.effect(
    "answers what listRevisions answers for its newest page as saves land, and nothing to a stranger",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const stranger = yield* openUser;
        const task = yield* startTask(owner, { name: "Teammate invitations" });
        const binding = { userId: owner, taskId: task.id };
        const agrees = Effect.gen(function* () {
          const held = yield* listRevisions(owner, task.id);
          assert.deepEqual(yield* liveHistoryOf(owner, task.id), held);
          return held;
        });
        const later = TestClock.adjust(Duration.hours(1));

        assert.deepEqual(yield* agrees, { revisions: [] });

        const db = yield* Database;
        yield* saveNotes(binding, [added("Context", "A member cannot bring a teammate in.")], {
          actor: PLAN_ACTOR.NOTETAKER,
        });
        const started = yield* createCodingAgent(owner, {
          taskId: task.id,
          idempotencyKey: randomUUID(),
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          planSnapshot: "# Teammate invitations",
          prompt: null,
          repository: "acme/relay",
        });
        yield* later;
        yield* saveNotes(binding, [added("Open questions", "- Who may withdraw an invite?")], {
          actor: PLAN_ACTOR.AGENT,
          agentId: Option.getOrThrow(started).agent.id,
        });
        yield* later;
        yield* saveNotes(binding, [added("Hard parts", "- Links expire.")], {
          actor: PLAN_ACTOR.DEVELOPER,
        });
        yield* later;
        yield* restoreRevision(binding, 1);
        const written = yield* agrees;
        assert.equal(written.revisions.length, 4);
        assert.ok(written.revisions.some((line) => line.restoredFrom !== undefined));

        // A history longer than a page answers its newest page and where the older one is read from.
        yield* db.insert(planRevision).values(
          Array.from({ length: PLAN_HISTORY_BOUNDS.PAGE }, (_, index) => ({
            taskId: task.id,
            seq: 5 + index,
            actor: PLAN_ACTOR.DEVELOPER,
            userId: owner,
            document: `# Teammate invitations\n\nSave ${index}.`,
            changes: 1,
            startedAt: new Date(10_000_000 + index),
            at: new Date(10_000_000 + index),
          })),
        );
        const paged = yield* agrees;
        assert.equal(paged.revisions.length, PLAN_HISTORY_BOUNDS.PAGE);
        assert.notEqual(paged.earlier, undefined);

        assert.deepEqual(yield* liveHistoryOf(stranger, task.id), { revisions: [] });
      }),
  );
});
