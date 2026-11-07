import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { inArray } from "drizzle-orm";
import { Effect } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { conversations } from "../../schemas/storage.js";
import { CONVERSATION_KIND } from "../../storage-vocabulary.js";
import { getTestDB, planOf } from "../../testing/index.js";
import { deleteConversations } from "../conversation-delete.js";

/**
 * conversation-delete.test.ts -- a conversation deleted with every one delegated from it, a worker's beside its agent's, and the cascade that takes them found through indexes.
 *
 * Synthetic accounts and conversations throughout.
 */

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  return id;
});

const openConversation = (userId: string, parentConversationId?: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = randomUUID();
    yield* db.insert(conversations).values({
      id,
      userId,
      kind: CONVERSATION_KIND.AGENT,
      runtimeSessionId: `session-${id}`,
      ...(parentConversationId === undefined ? undefined : { parentConversationId }),
    });
    return id;
  });

it.layer(getTestDB())("the delete", (it) => {
  it.effect(
    "an agent's conversation goes at once with its workers' and theirs, and a sibling stands",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const agent = yield* openConversation(owner);
        const worker = yield* openConversation(owner, agent);
        const nested = yield* openConversation(owner, worker);
        const sibling = yield* openConversation(owner);
        const db = yield* Database;

        yield* deleteConversations([agent]);

        const left = yield* db
          .select({ id: conversations.id })
          .from(conversations)
          .where(inArray(conversations.id, [agent, worker, nested, sibling]));
        assert.deepEqual(left, [{ id: sibling }]);
      }),
  );
});

it.layer(getTestDB())("the delete's cascade", (it) => {
  // Note that these are the statements Postgres's own foreign key triggers run for each row a
  // delete removes, which no store call sends and so none can be captured from.
  it.effect("the cascade finds each deleted conversation's children by their parent", () =>
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
