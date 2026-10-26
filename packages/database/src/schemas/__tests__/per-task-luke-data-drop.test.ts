import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { inArray } from "drizzle-orm";
import { Effect, Exit, Option } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import { Database } from "../../core/query.js";
import { createCodingAgent } from "../../models/coding-agent-store.js";
import {
  conversationReachableBy,
  runtimeSessionReachableBy,
} from "../../models/recorded-session.js";
import {
  CLEARED_CONVERSATION_RETENTION_MS,
  purgeClearedConversations,
} from "../../models/soft-delete.js";
import { createTask, deleteTask } from "../../models/task-store.js";
import { getTestDB, migrationStatements, openWorkspace, replayable } from "../../testing/index.js";
import { user } from "../auth.js";
import { sessionSandboxCleanup } from "../session-sandbox.js";
import { conversations } from "../storage.js";

/**
 * The migration that drops the per-task Luke's data: his conversations,
 * stamped deleted with every child under them so the sweep purges them; the
 * words said on calls with no agent; and `task.conversation_id`. Each test
 * stands its own database where it stood before the migration, the migration
 * undone over it, and runs the migration's own statements, less those on the
 * tables a later migration dropped (`replayable`). Synthetic accounts and
 * rows throughout.
 */

const MIGRATION = "20261021105816_per_task_luke_data_drop";

/** The migration undone, so the database stands as one from before it. */
const UNDO = [
  `ALTER TABLE "task" ADD COLUMN "conversation_id" uuid`,
  `ALTER TABLE "task" ADD CONSTRAINT "plan_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE set null`,
];

/** The per-task Luke's conversation kind, as old rows store it; no code names it now. */
const OLD_KIND = { CONVERSATION: "plan" } as const;

/** The database stood where it was before the migration. */
const undo = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const statement of UNDO) yield* sql.unsafe(statement);
});

/** The migration's statements, run in one transaction as the migrator runs them; its exit. */
const migrate = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const statements = replayable(yield* migrationStatements(MIGRATION));
  return yield* Effect.exit(
    sql.withTransaction(Effect.forEach(statements, (statement) => sql.unsafe(statement))),
  );
});

/** An account with a workspace and a task in it. */
const openTask = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Dean", email: `${userId}@luke.test` });
  const organizationId = yield* openWorkspace(userId);
  const task = yield* createTask(userId, { organizationId, name: "Teammate invitations" });
  return { userId, organizationId, taskId: task.id };
});

/** A conversation of the kind given, under the parent given, stamped where a stamp is given; its id. */
const openConversation = (
  userId: string,
  kind: string,
  options: { parent?: string; sessionId?: string; deletedAt?: string } = {},
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const [row] = yield* sql<{ readonly id: string }>`
      INSERT INTO conversations (user_id, kind, parent_conversation_id, runtime_session_id, deleted_at)
      VALUES (${userId}, ${kind}, ${options.parent ?? null}, ${options.sessionId ?? null}, ${options.deletedAt ?? null})
      RETURNING id
    `;
    assert.ok(row);
    return row.id;
  });

/** Each conversation's stamp, as an ISO string, or null where it stands unstamped; null too for one the purge took. */
const stampsOf = (ids: readonly string[]) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ readonly id: string; readonly deleted_at: Date | null }>`
      SELECT id, deleted_at FROM conversations WHERE id IN ${sql.in(ids)}
    `;
    return ids.map((id) => {
      const stamp = rows.find((row) => row.id === id)?.deleted_at;
      return stamp === undefined || stamp === null ? null : new Date(stamp).toISOString();
    });
  });

it.layer(getTestDB())("a task deleted after the migration", (it) => {
  it.effect(
    "leaves nothing of its old Luke's conversation unstamped, and the purge takes it, its child, and its session's sandbox seven days on",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* undo;
        const { userId, taskId } = yield* openTask;
        const sessionId = `wrun_${randomUUID()}`;
        const luke = yield* openConversation(userId, OLD_KIND.CONVERSATION, { sessionId });
        const worker = yield* openConversation(userId, "child", { parent: luke });
        yield* sql`UPDATE task SET conversation_id = ${luke} WHERE id = ${taskId}`;

        assert.ok(Exit.isSuccess(yield* migrate));
        assert.equal(yield* deleteTask(userId, taskId), true);

        const stamps = yield* stampsOf([luke, worker]);
        assert.ok(
          stamps.every((stamp) => stamp !== null),
          "the task's old conversation and its child stand stamped",
        );
        const latest = Math.max(...stamps.map((stamp) => Date.parse(stamp ?? "")));
        yield* purgeClearedConversations(new Date(latest + CLEARED_CONVERSATION_RETENTION_MS));
        const db = yield* Database;
        const left = yield* db
          .select({ id: conversations.id })
          .from(conversations)
          .where(inArray(conversations.id, [luke, worker]));
        const queued = yield* db.select().from(sessionSandboxCleanup);
        assert.deepEqual(left, []);
        assert.deepEqual(
          queued.map((row) => row.sessionId),
          [sessionId],
        );
      }),
  );
});

it.layer(getTestDB())("the per-task Luke's conversations", (it) => {
  it.effect(
    "are stamped, every child under one with them and the ones already stamped as they were, no other kind is, and a second run changes nothing",
    () =>
      Effect.gen(function* () {
        yield* undo;
        const { userId, taskId } = yield* openTask;
        const luke = yield* openConversation(userId, OLD_KIND.CONVERSATION);
        const worker = yield* openConversation(userId, "child", { parent: luke });
        const nested = yield* openConversation(userId, "child", { parent: worker });
        const gone = yield* openConversation(userId, OLD_KIND.CONVERSATION, {
          deletedAt: "2026-09-01T00:00:00.000Z",
        });
        const agent = Option.getOrThrow(
          yield* createCodingAgent(userId, {
            taskId,
            idempotencyKey: randomUUID(),
            model: "anthropic/claude-opus-5.5",
            effort: "high",
            repository: "acme/relay",
            planSnapshot: "# Teammate invitations\n",
            prompt: null,
          }),
        ).agent;
        const agentsChild = yield* openConversation(userId, "child", {
          parent: agent.conversationId,
        });
        const others = [agent.conversationId, agentsChild];

        assert.ok(Exit.isSuccess(yield* migrate));
        const first = yield* stampsOf([luke, worker, nested, gone, ...others]);
        assert.ok(first.slice(0, 3).every((stamp) => stamp !== null));
        assert.deepEqual(first.slice(3), ["2026-09-01T00:00:00.000Z", null, null]);

        assert.ok(Exit.isSuccess(yield* migrate), "the migration runs a second time");
        assert.deepEqual(yield* stampsOf([luke, worker, nested, gone, ...others]), first);
      }),
  );
});

it.layer(getTestDB())("the per-task Luke's conversations, once stamped", (it) => {
  it.effect(
    "are reached by no one, their opener included, with every worker's under them, while the opener's own conversation and its worker's stay theirs",
    () =>
      Effect.gen(function* () {
        yield* undo;
        const { userId } = yield* openTask;
        const sessionId = `wrun_${randomUUID()}`;
        const luke = yield* openConversation(userId, OLD_KIND.CONVERSATION, { sessionId });
        const worker = yield* openConversation(userId, "child", { parent: luke });
        const own = yield* openConversation(userId, "main");
        const ownWorker = yield* openConversation(userId, "child", { parent: own });

        assert.ok(Exit.isSuccess(yield* migrate));
        assert.deepEqual(
          yield* Effect.forEach([luke, worker, own, ownWorker], (id) =>
            conversationReachableBy(userId, id),
          ),
          [false, false, true, true],
        );
        assert.equal(yield* runtimeSessionReachableBy(userId, sessionId), false);
      }),
  );
});

it.layer(getTestDB())("calls with no agent", (it) => {
  it.effect(
    "lose the words said on them once they have ended, closed or started over an hour ago, and keep their rows and avatar sessions; a call still live and an agent's call keep theirs",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* undo;
        const { userId, taskId } = yield* openTask;
        const agentId = Option.getOrThrow(
          yield* createCodingAgent(userId, {
            taskId,
            idempotencyKey: randomUUID(),
            model: "anthropic/claude-opus-5.5",
            effort: "high",
            repository: "acme/relay",
            planSnapshot: "# Teammate invitations\n",
            prompt: null,
          }),
        ).agent.id;
        const call = (agent: string | null, closed: boolean, startedHoursAgo: number) =>
          Effect.gen(function* () {
            const [row] = yield* sql<{ readonly id: string }>`
              INSERT INTO voice_sessions (user_id, task_id, agent_id, live_session_id, delegation_mode, started_at, closed_at)
              VALUES (${userId}, ${taskId}, ${agent}, ${`live-${randomUUID()}`}, 'client',
                now() - make_interval(hours => ${startedHoursAgo}), ${closed ? sql`now()` : null})
              RETURNING id
            `;
            assert.ok(row);
            yield* sql`
              INSERT INTO voice_transcript_segments (voice_session_id, seq, role, text, start_ms, end_ms)
              VALUES (${row.id}, 0, 'user', 'Ship it.', 0, 900)
            `;
            yield* sql`
              INSERT INTO voice_avatar_sessions (voice_session_id, user_id, persona_id, started_at)
              VALUES (${row.id}, ${userId}, 'persona', now())
            `;
            return row.id;
          });
        const closed = yield* call(null, true, 0);
        const lapsed = yield* call(null, false, 2);
        const live = yield* call(null, false, 0);
        const agents = yield* call(agentId, true, 0);
        const calls = [closed, lapsed, live, agents];

        assert.ok(Exit.isSuccess(yield* migrate));
        const rows = yield* sql<{
          readonly id: string;
          readonly segments: number;
          readonly avatars: number;
        }>`
          SELECT v.id,
            (SELECT count(*)::int FROM voice_transcript_segments s WHERE s.voice_session_id = v.id) AS segments,
            (SELECT count(*)::int FROM voice_avatar_sessions a WHERE a.voice_session_id = v.id) AS avatars
          FROM voice_sessions v WHERE v.id IN ${sql.in(calls)}
        `;
        assert.deepEqual(
          calls.map((id) => {
            const row = rows.find((each) => each.id === id);
            return row === undefined ? undefined : [row.segments, row.avatars];
          }),
          [
            [0, 1],
            [0, 1],
            [1, 1],
            [1, 1],
          ],
        );
      }),
  );
});
