import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { askRecord } from "@luke/database/models/asks";
import { conversations } from "@luke/database/schemas/storage";
import { CONVERSATION_KIND } from "@luke/database/storage-vocabulary";
import { openHostedStoreTestDatabase } from "@luke/database/testing";
import { ASK_ORIGIN } from "@luke/features";
import { Effect, Schema } from "effect";
import { afterAll } from "vitest";

/**
 * The ask record over the real migrations, and the two compositions that
 * stand on it: the ask accepted over the real record rather than a memory
 * one, and the relay binding eve's deliveries to the turn that ran them.
 * Every row here belongs to an account the test created, because on CI this
 * file shares one database with every other store file.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const NOW = 1_800_000_000_000;
/** The record itself, for the seams that take the effect rather than the promise. */
const askEffects = askRecord();
const asks = {
  record: (write: Parameters<typeof askEffects.record>[0]) =>
    database.run(askEffects.record(write)),
  named: (userId: string, id: string) => database.run(askEffects.named(userId, id)),
  latestSession: (userId: string, conversationId: string) =>
    database.run(askEffects.latestSession(userId, conversationId)),
  dispatchOnce: (
    target: Parameters<typeof askEffects.dispatchOnce>[0],
    id: string,
    dispatch: Parameters<typeof askEffects.dispatchOnce>[2],
  ) => database.run(askEffects.dispatchOnce(target, id, dispatch)),
  cancelRequested: (id: string, at: Date) => database.run(askEffects.cancelRequested(id, at)),
  bindDeliveries: (
    target: Parameters<typeof askEffects.bindDeliveries>[0],
    deliveryIds: Parameters<typeof askEffects.bindDeliveries>[1],
    turnId: string,
  ) => database.run(askEffects.bindDeliveries(target, deliveryIds, turnId)),
  stoppedOn: (target: Parameters<typeof askEffects.stoppedOn>[0], turnId: string) =>
    database.run(askEffects.stoppedOn(target, turnId)),
};

const IdRowSchema = Schema.Struct({ id: Schema.String });

async function conversation(userId: string): Promise<string> {
  const row = await database.run(
    Effect.gen(function* () {
      const db = yield* Database;
      const rows = yield* db
        .insert(conversations)
        .values({ userId, kind: CONVERSATION_KIND.MAIN })
        .returning({ id: conversations.id });
      return yield* Schema.decodeUnknownEffect(IdRowSchema)(rows[0]);
    }),
  );
  return row.id;
}

function write(userId: string, conversationId: string, clientId = randomUUID()) {
  return {
    userId,
    conversationId,
    clientId,
    origin: ASK_ORIGIN.TYPED,
    createdAt: new Date(NOW),
  };
}

it.effect(
  "a read is the account's own: an ask is named for its account and for nobody else, and the latest session is the newest by eve's sortable ids whichever ask holds it",
  () =>
    Effect.promise(async () => {
      const owner = await database.createUser();
      const other = await database.createUser();
      const conversationId = await conversation(owner);
      const earlier = await asks.record(write(owner, conversationId));
      const later = await asks.record({
        ...write(owner, conversationId),
        createdAt: new Date(NOW + 1),
      });
      assert.deepEqual(await asks.named(owner, earlier.id), earlier);
      assert.equal(await asks.named(other, earlier.id), undefined);
      assert.equal(await asks.latestSession(owner, conversationId), undefined);

      await asks.dispatchOnce({ userId: owner, conversationId }, earlier.id, () =>
        Effect.succeed({
          sessionId: "wrun_02_newer",
        }),
      );
      await asks.dispatchOnce({ userId: owner, conversationId }, later.id, () =>
        Effect.succeed({
          sessionId: "wrun_01_older",
          deliveryId: "delivery-2",
        }),
      );
      assert.equal(await asks.latestSession(owner, conversationId), "wrun_02_newer");
      assert.equal(await asks.latestSession(other, conversationId), undefined);
    }),
);

it.effect(
  "a fresh call reads back the conversation's spoken asks from any earlier call that are neither told to their end nor stopped, inside the window, for the account alone",
  () =>
    Effect.promise(async () => {
      const owner = await database.createUser();
      const other = await database.createUser();
      const conversationId = await conversation(owner);
      const spoken = (voiceSessionId: string, at: number) =>
        asks.record({
          ...write(owner, conversationId),
          origin: ASK_ORIGIN.SPOKEN,
          createdAt: new Date(at),
          voice: { sessionId: voiceSessionId, revision: 1 },
        });
      const old = await spoken("voice-a", NOW - 60_000);
      const told = await spoken("voice-a", NOW);
      const stopped = await spoken("voice-a", NOW + 1);
      const running = await spoken("voice-b", NOW + 2);
      await asks.record({ ...write(owner, conversationId), createdAt: new Date(NOW + 3) });
      await database.run(askEffects.told(told.id, { seq: 4, endAt: new Date(NOW + 10) }));
      await asks.cancelRequested(stopped.id, new Date(NOW + 10));
      const since = new Date(NOW - 1_000);

      const unended = await database.run(askEffects.unendedSpoken(owner, conversationId, since));
      assert.deepEqual(
        unended.map((ask) => ask.id),
        [running.id],
      );
      assert.ok(!unended.some((ask) => ask.id === old.id));
      assert.deepEqual(
        await database.run(askEffects.unendedSpoken(other, conversationId, since)),
        [],
      );
    }),
);
