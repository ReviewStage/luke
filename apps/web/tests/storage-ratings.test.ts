import assert from "node:assert/strict";
import {
  CONVERSATION_EVENT_KIND,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_RATING,
  MESSAGE_ROLE,
  RATING_WORD,
} from "@sidecar/wire";
import { Result, Schema } from "effect";
import { afterAll, test } from "vitest";
import { db } from "../server/db/query";
import { events } from "../server/db/storage-schema";
import { rateMessage, storeWriter } from "../server/hosted/store";
import { EpochMillisColumnSchema } from "../server/hosted/store/database";
import { RATING_REFUSAL, type RatingStore } from "../server/hosted/store/ratings";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import {
  insertConversation,
  insertEvent,
  insertMessage,
  readEventsByConversation,
} from "./support/store-rows";

/**
 * Ratings against the real migrations on PGlite: a rating is an event on one
 * of Luke's messages and nothing else, a second rating is a second event the
 * latest read answers, and the two refusals hold — a message the account
 * does not own, and a message the account owns but Luke did not write.
 */

const NOW = new Date("2026-09-11T09:00:00.000Z");
const database = await openHostedStoreTestDatabase({ at: NOW.getTime() });
afterAll(() => database.close());

const DEVICE_ID = "6c1f2f14-9a0b-4c2d-8e3f-0a1b2c3d4e50";
const OTHER_DEVICE_ID = "7d2f3f25-ab1c-4d3e-9f4a-1b2c3d4e5f61";

const store: RatingStore = {
  writer: await database.run(storeWriter({ tools: {} })),
};

/** A main with the developer's ask, an observation note of the brain's, and Luke's reply. */
async function populate(userId: string) {
  const main = await insertConversation(database.run, { userId });
  const ask = await insertMessage(database.run, {
    userId,
    conversationId: main,
    seq: 1,
    clientId: "client-1",
    parts: [{ type: "text", text: "words 1" }],
    role: MESSAGE_ROLE.USER,
    metadata: { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.TYPED },
  });
  const note = await insertMessage(database.run, {
    userId,
    conversationId: main,
    seq: 2,
    clientId: "client-2",
    parts: [{ type: "text", text: "words 2" }],
    role: MESSAGE_ROLE.USER,
    metadata: { author: MESSAGE_AUTHOR.BRAIN, source: "transcript_change" },
  });
  const reply = await insertMessage(database.run, {
    userId,
    conversationId: main,
    seq: 3,
    clientId: "client-3",
    parts: [{ type: "text", text: "words 3" }],
    role: MESSAGE_ROLE.ASSISTANT,
    metadata: { author: MESSAGE_AUTHOR.BRAIN },
  });
  return { main, ask, note, reply };
}

test("a rating is one event on Luke's message, carrying the verdict, the note, and the device", async () => {
  const userId = await database.createUser();
  const { main, reply } = await populate(userId);

  const written = await database.run(
    rateMessage(store, userId, reply, {
      rating: MESSAGE_RATING.DOWN,
      note: "It answered a different question.",
      deviceId: DEVICE_ID,
    }),
  );
  assert.ok(Result.isSuccess(written));
  if (!Result.isSuccess(written)) return;

  const rows = await readEventsByConversation(database.run, main);
  assert.deepEqual(
    rows.map((row) => [
      row.id,
      Schema.decodeUnknownSync(EpochMillisColumnSchema)(row.seq),
      row.messageId,
      row.kind,
      row.deviceId,
      row.payload,
    ]),
    [
      [
        written.success.id,
        written.success.seq,
        reply,
        CONVERSATION_EVENT_KIND.RATING,
        DEVICE_ID,
        { rating: MESSAGE_RATING.DOWN, note: "It answered a different question." },
      ],
    ],
  );
  assert.deepEqual(await database.run(database.store.ratings.latest(userId, reply)), {
    id: written.success.id,
    seq: written.success.seq,
    rating: MESSAGE_RATING.DOWN,
    note: "It answered a different question.",
    deviceId: DEVICE_ID,
    ratedAt: NOW,
  });
});

test("a later rating is a second event and the one the latest read answers; the first still stands", async () => {
  const userId = await database.createUser();
  const { main, reply } = await populate(userId);
  const first = await database.run(
    rateMessage(store, userId, reply, {
      rating: MESSAGE_RATING.DOWN,
      deviceId: DEVICE_ID,
    }),
  );
  const second = await database.run(
    rateMessage(store, userId, reply, {
      rating: MESSAGE_RATING.UP,
      note: "On reflection it was right.",
      deviceId: OTHER_DEVICE_ID,
    }),
  );
  assert.ok(Result.isSuccess(first) && Result.isSuccess(second));
  if (!Result.isSuccess(first) || !Result.isSuccess(second)) return;
  assert.equal(second.success.seq, first.success.seq + 1);

  const latest = await database.run(database.store.ratings.latest(userId, reply));
  assert.deepEqual(
    [latest?.id, latest?.rating, latest?.note, latest?.deviceId],
    [second.success.id, MESSAGE_RATING.UP, "On reflection it was right.", OTHER_DEVICE_ID],
  );
  const ratings = await readEventsByConversation(database.run, main);
  assert.deepEqual(
    ratings.map((row) => row.id).sort(),
    [first.success.id, second.success.id].sort(),
  );
  assert.deepEqual(
    (await database.run(database.store.events.list(userId, main))).map((event) => [
      event.seq,
      event.kind,
    ]),
    [
      [first.success.seq, CONVERSATION_EVENT_KIND.RATING],
      [second.success.seq, CONVERSATION_EVENT_KIND.RATING],
    ],
  );
});

test("a verdict taken back is a third event that says so, the one the latest read answers, and the verdict it took back still stands in the record", async () => {
  const userId = await database.createUser();
  const { main, reply } = await populate(userId);
  const given = await database.run(
    rateMessage(store, userId, reply, { rating: MESSAGE_RATING.UP, deviceId: DEVICE_ID }),
  );
  const withdrawn = await database.run(
    rateMessage(store, userId, reply, { rating: RATING_WORD.WITHDRAWN, deviceId: DEVICE_ID }),
  );
  assert.ok(Result.isSuccess(given) && Result.isSuccess(withdrawn));
  if (!Result.isSuccess(given) || !Result.isSuccess(withdrawn)) return;
  assert.equal(withdrawn.success.seq, given.success.seq + 1);

  const latest = await database.run(database.store.ratings.latest(userId, reply));
  assert.deepEqual(
    [latest?.id, latest?.rating, latest?.note, latest?.deviceId],
    [withdrawn.success.id, RATING_WORD.WITHDRAWN, undefined, DEVICE_ID],
  );
  const payloads = new Map(
    (await readEventsByConversation(database.run, main)).map((row) => [row.id, row.payload]),
  );
  assert.deepEqual(payloads.get(given.success.id), { rating: MESSAGE_RATING.UP });
  assert.deepEqual(payloads.get(withdrawn.success.id), { rating: RATING_WORD.WITHDRAWN });
  assert.deepEqual(
    (await database.run(database.store.events.list(userId, main))).map((event) => [
      event.seq,
      event.kind,
    ]),
    [
      [given.success.seq, CONVERSATION_EVENT_KIND.RATING],
      [withdrawn.success.seq, CONVERSATION_EVENT_KIND.RATING],
    ],
  );
});

test("a message the account does not own is not found, whether another account's or nobody's", async () => {
  const userId = await database.createUser();
  const other = await database.createUser();
  const { reply } = await populate(other);
  const rating = { rating: MESSAGE_RATING.UP, deviceId: DEVICE_ID } as const;

  assert.deepEqual(
    await database.run(rateMessage(store, userId, reply, rating)),
    Result.fail(RATING_REFUSAL.NOT_FOUND),
  );
  assert.deepEqual(
    await database.run(rateMessage(store, userId, "00000000-0000-4000-8000-000000000000", rating)),
    Result.fail(RATING_REFUSAL.NOT_FOUND),
  );
  assert.equal(await database.run(database.store.ratings.latest(userId, reply)), undefined);
  const allEvents = await database.run(db.select({ messageId: events.messageId }).from(events));
  assert.equal(
    allEvents.some((row) => row.messageId === reply),
    false,
  );
});

test("a message the account owns but Luke did not write is not rateable: the developer's ask, the brain's own note, and a compaction summary alike", async () => {
  const userId = await database.createUser();
  const { ask, note, main } = await populate(userId);
  const rating = { rating: MESSAGE_RATING.UP, deviceId: DEVICE_ID } as const;
  const compaction = await insertMessage(database.run, {
    userId,
    conversationId: main,
    seq: 4,
    clientId: "client-4",
    parts: [{ type: "text", text: "words 4" }],
    role: MESSAGE_ROLE.ASSISTANT,
    metadata: {
      author: MESSAGE_AUTHOR.BRAIN,
      compaction: { first_kept_message_id: ask, tokens_before: 1200 },
    },
  });
  assert.deepEqual(
    await database.run(rateMessage(store, userId, compaction, rating)),
    Result.fail(RATING_REFUSAL.NOT_LUKES),
  );

  assert.deepEqual(
    await database.run(rateMessage(store, userId, ask, rating)),
    Result.fail(RATING_REFUSAL.NOT_LUKES),
  );
  assert.deepEqual(
    await database.run(rateMessage(store, userId, note, rating)),
    Result.fail(RATING_REFUSAL.NOT_LUKES),
  );
  assert.deepEqual(await database.run(database.store.events.list(userId, main)), []);
});

test("a message in a cleared conversation is not found, and its earlier rating is no longer read", async () => {
  const userId = await database.createUser();
  const { reply } = await populate(userId);
  const before = await database.run(
    rateMessage(store, userId, reply, {
      rating: MESSAGE_RATING.UP,
      deviceId: DEVICE_ID,
    }),
  );
  assert.ok(Result.isSuccess(before));
  await database.run(database.store.main.clear(userId, NOW));

  assert.deepEqual(
    await database.run(
      rateMessage(store, userId, reply, { rating: MESSAGE_RATING.DOWN, deviceId: DEVICE_ID }),
    ),
    Result.fail(RATING_REFUSAL.NOT_FOUND),
  );
  assert.equal(await database.run(database.store.ratings.latest(userId, reply)), undefined);
});

test("a latest rating whose payload this build cannot read answers nothing rather than an older verdict", async () => {
  const userId = await database.createUser();
  const { main, reply } = await populate(userId);
  const first = await database.run(
    rateMessage(store, userId, reply, {
      rating: MESSAGE_RATING.UP,
      deviceId: DEVICE_ID,
    }),
  );
  assert.ok(Result.isSuccess(first));
  await insertEvent(database.run, {
    userId,
    conversationId: main,
    messageId: reply,
    seq: 99,
    kind: CONVERSATION_EVENT_KIND.RATING,
    payload: { rating: "sideways" },
  });
  assert.equal(await database.run(database.store.ratings.latest(userId, reply)), undefined);
});
