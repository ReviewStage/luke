import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { standingSessionsOf } from "@repo/database/models/recorded-session";
import { user } from "@repo/database/schemas/auth";
import { conversations } from "@repo/database/schemas/storage";
import { CONVERSATION_KIND } from "@repo/database/storage-vocabulary";
import { getTestDB } from "@repo/database/testing";
import { Effect } from "effect";

/**
 * The sessions an account's standing conversations run in, over a real
 * dialect, which the account's delete retires before anything is deleted.
 */

const openUser = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` });
  return userId;
});

/** A conversation of the account that ran in the session named. */
const openConversation = (
  userId: string,
  options: {
    readonly kind: (typeof CONVERSATION_KIND)[keyof typeof CONVERSATION_KIND];
    readonly sessionId?: string;
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
      })
      .returning({ id: conversations.id });
    assert.ok(row);
    return row.id;
  });

const mintSession = () => `wrun_${randomUUID()}`;

it.layer(getTestDB())("the standing sessions read", (it) => {
  it.effect(
    "the standing sessions read names the account's standing conversations' sessions by kind, the ones asked for where it is asked, and none of another account's",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const other = yield* openUser;
        const main = mintSession();
        const agent = mintSession();
        const mainConversation = yield* openConversation(userId, {
          kind: CONVERSATION_KIND.MAIN,
          sessionId: main,
        });
        yield* openConversation(userId, { kind: CONVERSATION_KIND.AGENT, sessionId: agent });
        yield* openConversation(userId, { kind: CONVERSATION_KIND.CHILD });
        yield* openConversation(other, { kind: CONVERSATION_KIND.MAIN, sessionId: mintSession() });

        const all = yield* standingSessionsOf(userId);
        assert.deepEqual(
          [...all].sort((a, b) => a.sessionId.localeCompare(b.sessionId)),
          [
            { sessionId: main, kind: CONVERSATION_KIND.MAIN },
            { sessionId: agent, kind: CONVERSATION_KIND.AGENT },
          ].sort((a, b) => a.sessionId.localeCompare(b.sessionId)),
        );
        assert.deepEqual(yield* standingSessionsOf(userId, [mainConversation]), [
          { sessionId: main, kind: CONVERSATION_KIND.MAIN },
        ]);
        assert.deepEqual(yield* standingSessionsOf(other, [mainConversation]), []);
      }),
  );
});
