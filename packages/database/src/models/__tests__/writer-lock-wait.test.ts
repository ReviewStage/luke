import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sentLineId } from "@luke/wire/host-ids";
import { Deferred, Effect, Option, Result } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import { afterAll, test } from "vitest";
import { Database } from "../../core/query.js";
import { conversations } from "../../schemas/storage.js";
import { CONVERSATION_KIND, MESSAGE_SENDER } from "../../storage-vocabulary.js";
import { openHostedStoreTestDatabase } from "../../testing/index.js";
import { holdConversationDispatch } from "../dispatch-lock.js";
import { readMessageByClientId } from "../message-reads.js";
import { STORE_WRITE_REFUSAL, storeWriter } from "../writer.js";

/**
 * A developer's line to a coding agent waits for its conversation's dispatch
 * lock (`dispatch-lock.ts`), which another send's hand-over to eve holds for
 * as long as eve takes, no longer than its bound: where another transaction
 * holds the lock past it,
 * the send is refused as busy, eve is told nothing, and nothing is written,
 * rather than the send hanging until its function is killed; and the same
 * send once the lock is free lands as it always did. The contended case
 * needs a second connection, which only a real Postgres has: PGlite is one
 * connection and runs the holder and the send one after the other, so the
 * Postgres CI job, which points this harness at its own database, runs it.
 */

/** Long enough for the five-second wait to run out, and far short of the hang it replaces. */
const CONTENDED_TEST_TIMEOUT_MS = 20_000;

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

/** A coding agent's conversation of a fresh account's, as the writer's target. */
async function openTarget() {
  const userId = await database.createUser();
  const conversationId = randomUUID();
  await database.run(
    Effect.asVoid(
      Database.use((db) =>
        db
          .insert(conversations)
          .values({ id: conversationId, userId, kind: CONVERSATION_KIND.CODING_AGENT }),
      ),
    ),
  );
  return { userId, conversationId };
}

/** Sends the line under its key, answering what the write answered and whether eve was handed it. */
async function send(target: { userId: string; conversationId: string }, clientKey: string) {
  let dispatched = 0;
  const dispatch = Effect.sync(() => {
    dispatched += 1;
    return true;
  });
  const written = await database.run(
    Effect.flatMap(storeWriter({ tools: {} }), (writer) =>
      writer.writeAwaitingLine(
        target,
        { text: "Use seven days.", clientKey, sender: { kind: MESSAGE_SENDER.LUKE } },
        dispatch,
      ),
    ),
  );
  const read = await database.run(
    readMessageByClientId(target.userId, target.conversationId, {}, sentLineId(clientKey)),
  );
  assert.ok(read.ok);
  return { written, dispatched, rows: read.value.length };
}

test("a line sent while nothing holds its conversation is handed to eve once and written", async () => {
  const target = await openTarget();

  const sent = await send(target, "send-1");

  assert.ok(Result.isSuccess(sent.written) && Option.isSome(sent.written.success));
  assert.equal(sent.dispatched, 1);
  assert.equal(sent.rows, 1);
});

const anotherConnection = database.anotherConnection;
if (anotherConnection !== undefined) {
  test(
    "a line sent while another transaction holds its conversation's dispatch lock is refused as busy within the bound, with eve told nothing and nothing written, and lands once the lock is free",
    async () => {
      const target = await openTarget();
      const locked = await database.run(Deferred.make<void>());
      const release = await database.run(Deferred.make<void>());
      const holding = database.run(
        Effect.provide(
          Effect.flatMap(SqlClient.SqlClient, (sql) =>
            sql.withTransaction(
              Effect.gen(function* () {
                yield* holdConversationDispatch(target.conversationId);
                yield* Deferred.succeed(locked, undefined);
                yield* Deferred.await(release);
              }),
            ),
          ),
          anotherConnection(),
        ),
      );
      await database.run(Deferred.await(locked));

      const busy = await send(target, "send-1");
      await database.run(Deferred.succeed(release, undefined));
      await holding;
      const freed = await send(target, "send-1");

      assert.deepEqual(busy.written, Result.fail({ refusal: STORE_WRITE_REFUSAL.BUSY }));
      assert.equal(busy.dispatched, 0);
      assert.equal(busy.rows, 0);
      assert.ok(Result.isSuccess(freed.written) && Option.isSome(freed.written.success));
      assert.equal(freed.dispatched, 1);
      assert.equal(freed.rows, 1);
    },
    CONTENDED_TEST_TIMEOUT_MS,
  );
}
