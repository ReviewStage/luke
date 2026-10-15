import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { standingSessionsOf } from "@luke/database/models/recorded-session";
import { user } from "@luke/database/schemas/auth";
import { conversations } from "@luke/database/schemas/storage";
import { CONVERSATION_KIND } from "@luke/database/storage-vocabulary";
import { getTestDB } from "@luke/database/testing";
import { Effect } from "effect";

/**
 * The queue of eve sessions whose Vercel Sandboxes are still to be deleted,
 * over a real dialect: what lets go of a session queues it in its own
 * transaction, the purge and an account's deletion, and the sweep works the
 * queue against a Vercel Sandbox that answers from a script, dequeuing a
 * session whose sandboxes went and keeping one Vercel refused, behind the
 * rest. Every session id is minted per test, and every read is of those
 * ids, since the queue is the deployment's and not an account's.
 */

const openUser = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

/** A conversation of the account that ran in the session named, stamped deleted where an instant is given. */
const openConversation = (
  userId: string,
  options: {
    readonly kind: (typeof CONVERSATION_KIND)[keyof typeof CONVERSATION_KIND];
    readonly sessionId?: string;
    readonly deletedAt?: Date;
  },
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const [row] = yield* db
      .insert(conversations)
      .values({
        userId,
        kind: options.kind,
        runtimeSessionId: options.sessionId ?? null,
        deletedAt: options.deletedAt ?? null,
      })
      .returning({ id: conversations.id });
    assert.ok(row);
    return row.id;
  });

const mintSession = () => `wrun_${randomUUID()}`;

it.layer(getTestDB())("the session sandbox queue", (it) => {
  it.effect(
    "the standing sessions read names the account's standing conversations' sessions by kind, the ones asked for where it is asked, and none of another account's",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const other = yield* openUser;
        const tasks = mintSession();
        const agent = mintSession();
        const taskConversation = yield* openConversation(userId, {
          kind: CONVERSATION_KIND.TASK,
          sessionId: tasks,
        });
        yield* openConversation(userId, { kind: CONVERSATION_KIND.CODING_AGENT, sessionId: agent });
        yield* openConversation(userId, {
          kind: CONVERSATION_KIND.CODING_AGENT,
          sessionId: mintSession(),
          deletedAt: new Date(),
        });
        yield* openConversation(userId, { kind: CONVERSATION_KIND.CHILD });
        yield* openConversation(other, { kind: CONVERSATION_KIND.TASK, sessionId: mintSession() });

        const all = yield* standingSessionsOf(userId);
        assert.deepEqual(
          [...all].sort((a, b) => a.sessionId.localeCompare(b.sessionId)),
          [
            { sessionId: tasks, kind: CONVERSATION_KIND.TASK },
            { sessionId: agent, kind: CONVERSATION_KIND.CODING_AGENT },
          ].sort((a, b) => a.sessionId.localeCompare(b.sessionId)),
        );
        assert.deepEqual(yield* standingSessionsOf(userId, [taskConversation]), [
          { sessionId: tasks, kind: CONVERSATION_KIND.TASK },
        ]);
        assert.deepEqual(yield* standingSessionsOf(other, [taskConversation]), []);
      }),
  );
});
