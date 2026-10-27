import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { eq, inArray } from "drizzle-orm";
import { DateTime, Effect } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { sessionSandboxCleanup } from "../../schemas/session-sandbox.js";
import { conversations } from "../../schemas/storage.js";
import { CONVERSATION_KIND } from "../../storage-vocabulary.js";
import { getTestDB, planOf, plansOf } from "../../testing/index.js";
import {
  CLEARED_CONVERSATION_RETENTION_MS,
  purgeClearedConversations,
  purgeDeletedTaskCalls,
  stampConversationsDeleted,
} from "../soft-delete.js";

/**
 * soft-delete.test.ts -- a conversation stamped deleted with every one delegated from it, and the purge thirty days on queueing each one's sandbox, a worker's beside its agent's.
 *
 * Synthetic accounts and conversations throughout.
 */

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

const openConversation = (userId: string, parentConversationId?: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = randomUUID();
    yield* db.insert(conversations).values({
      id,
      userId,
      kind: CONVERSATION_KIND.CODING_AGENT,
      runtimeSessionId: `session-${id}`,
      ...(parentConversationId === undefined ? undefined : { parentConversationId }),
    });
    return id;
  });

it.layer(getTestDB())("the soft delete", (it) => {
  it.effect(
    "an agent's conversation is stamped with its workers' and theirs, a sibling stands, and the purge thirty days on queues every stamped one's sandbox",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const agent = yield* openConversation(owner);
        const worker = yield* openConversation(owner, agent);
        const nested = yield* openConversation(owner, worker);
        const sibling = yield* openConversation(owner);
        const db = yield* Database;

        yield* stampConversationsDeleted([agent]);

        const stamped = yield* db
          .select({ id: conversations.id, deletedAt: conversations.deletedAt })
          .from(conversations)
          .where(inArray(conversations.id, [agent, worker, nested, sibling]));
        assert.deepEqual(
          new Set(stamped.filter((row) => row.deletedAt !== null).map((row) => row.id)),
          new Set([agent, worker, nested]),
        );

        const stampedAt = yield* DateTime.nowAsDate;
        const purged = yield* purgeClearedConversations(
          new Date(stampedAt.getTime() + CLEARED_CONVERSATION_RETENTION_MS),
        );
        const queued = yield* db
          .select({ sessionId: sessionSandboxCleanup.sessionId })
          .from(sessionSandboxCleanup)
          .where(
            inArray(sessionSandboxCleanup.sessionId, [
              `session-${agent}`,
              `session-${worker}`,
              `session-${nested}`,
              `session-${sibling}`,
            ]),
          );
        assert.equal(purged, 3);
        assert.deepEqual(
          new Set(queued.map((row) => row.sessionId)),
          new Set([`session-${agent}`, `session-${worker}`, `session-${nested}`]),
        );
        const left = yield* db
          .select({ id: conversations.id })
          .from(conversations)
          .where(eq(conversations.id, sibling));
        assert.deepEqual(left, [{ id: sibling }]);
      }),
  );
});

it.layer(getTestDB())("the soft delete's reads and the purge's cascade", (it) => {
  it.effect(
    "a delete's stamp finds the conversations delegated from those it stamps through their parent's index",
    () =>
      Effect.gen(function* () {
        const plans = yield* plansOf(stampConversationsDeleted([randomUUID()]));
        const children = plans.find(({ sql }) => /^select/i.test(sql));

        assert.match(children?.plan ?? "", /conversations_parent/);
      }),
  );

  it.effect("the sweep finds a deleted task's calls through their task's index", () =>
    Effect.gen(function* () {
      const [purge] = yield* plansOf(purgeDeletedTaskCalls(new Date("2026-10-20T12:00:00Z")));

      assert.match(purge?.plan ?? "", /voice_sessions_task/);
    }),
  );

  // Note that these are the statements Postgres's own foreign key triggers run for each row a
  // purge deletes, which no store call sends and so none can be captured from.
  it.effect("the purge's cascade finds each deleted conversation's children by their parent", () =>
    Effect.gen(function* () {
      const plan = yield* planOf(
        `DELETE FROM ONLY "public"."conversations" WHERE $1 OPERATOR(pg_catalog.=) "parent_conversation_id"`,
      );

      assert.match(plan, /conversations_parent/);
    }),
  );

  it.effect("the check on each turn deleted finds the messages it wrote by their turn", () =>
    Effect.gen(function* () {
      const plan = yield* planOf(
        `SELECT 1 FROM ONLY "public"."messages" x WHERE "turn_id" OPERATOR(pg_catalog.=) $1 FOR KEY SHARE OF x`,
      );

      assert.match(plan, /messages_turn/);
    }),
  );
});
