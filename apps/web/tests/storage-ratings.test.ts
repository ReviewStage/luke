import assert from "node:assert/strict";
import {
  CONVERSATION_EVENT_KIND,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_RATING,
  MESSAGE_ROLE,
} from "@sidecar/wire";
import { asc, eq } from "drizzle-orm";
import { afterAll, test } from "vitest";
import { CONVERSATION_KIND, conversations, events, messages } from "../server/db/schema";
import { RATING_REFUSAL, type RatingStore, rateMessage, storeWriter } from "../server/hosted/store";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";

/**
 * Ratings against the real migrations on PGlite: a rating is an event on one
 * of Luke's messages and nothing else, a second rating is a second event the
 * latest read answers, and the two refusals hold — a message the account
 * does not own, and a message the account owns but Luke did not write.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const NOW = new Date("2026-09-11T09:00:00.000Z");
const DEVICE_ID = "6c1f2f14-9a0b-4c2d-8e3f-0a1b2c3d4e50";
const OTHER_DEVICE_ID = "7d2f3f25-ab1c-4d3e-9f4a-1b2c3d4e5f61";

const store: RatingStore = {
  db: database.db,
  writer: await storeWriter({ run: database.run, tools: {}, now: () => NOW }),
};

async function insertConversation(
  userId: string,
  row: Partial<typeof conversations.$inferInsert> = {},
): Promise<string> {
  const [inserted] = await database.db
    .insert(conversations)
    .values({ userId, kind: CONVERSATION_KIND.MAIN, ...row })
    .returning({ id: conversations.id });
  assert.ok(inserted);
  return inserted.id;
}

async function insertMessage(
  userId: string,
  conversationId: string,
  seq: number,
  row: Pick<typeof messages.$inferInsert, "role" | "metadata">,
): Promise<string> {
  const [inserted] = await database.db
    .insert(messages)
    .values({
      userId,
      conversationId,
      seq,
      clientId: `client-${seq}`,
      parts: [{ type: "text", text: `words ${seq}` }],
      ...row,
    })
    .returning({ id: messages.id });
  assert.ok(inserted);
  return inserted.id;
}

/** A main with the developer's ask, an observation note of the brain's, and Luke's reply. */
async function populate(userId: string) {
  const main = await insertConversation(userId);
  const ask = await insertMessage(userId, main, 1, {
    role: MESSAGE_ROLE.USER,
    metadata: { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.TYPED },
  });
  const note = await insertMessage(userId, main, 2, {
    role: MESSAGE_ROLE.USER,
    metadata: { author: MESSAGE_AUTHOR.BRAIN, source: "roster_look" },
  });
  const reply = await insertMessage(userId, main, 3, {
    role: MESSAGE_ROLE.ASSISTANT,
    metadata: { author: MESSAGE_AUTHOR.BRAIN },
  });
  return { main, ask, note, reply };
}

test("a rating is one event on Luke's message, carrying the verdict, the note, and the device", async () => {
  const userId = await database.createUser();
  const { main, reply } = await populate(userId);

  const written = await rateMessage(store, userId, reply, {
    rating: MESSAGE_RATING.DOWN,
    note: "It answered a different question.",
    deviceId: DEVICE_ID,
  });
  assert.equal(written.ok, true);
  if (!written.ok) return;

  const rows = await database.db
    .select()
    .from(events)
    .where(eq(events.conversationId, main))
    .orderBy(asc(events.seq));
  assert.deepEqual(
    rows.map((row) => [row.id, row.seq, row.messageId, row.kind, row.deviceId, row.payload]),
    [
      [
        written.id,
        written.seq,
        reply,
        CONVERSATION_EVENT_KIND.RATING,
        DEVICE_ID,
        { rating: MESSAGE_RATING.DOWN, note: "It answered a different question." },
      ],
    ],
  );
  assert.deepEqual(await database.store.ratings.latest(userId, reply), {
    id: written.id,
    seq: written.seq,
    rating: MESSAGE_RATING.DOWN,
    note: "It answered a different question.",
    deviceId: DEVICE_ID,
    ratedAt: NOW,
  });
});

test("a later rating is a second event and the one the latest read answers; the first still stands", async () => {
  const userId = await database.createUser();
  const { main, reply } = await populate(userId);
  const first = await rateMessage(store, userId, reply, {
    rating: MESSAGE_RATING.DOWN,
    deviceId: DEVICE_ID,
  });
  const second = await rateMessage(store, userId, reply, {
    rating: MESSAGE_RATING.UP,
    note: "On reflection it was right.",
    deviceId: OTHER_DEVICE_ID,
  });
  assert.equal(first.ok && second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal(second.seq, first.seq + 1);

  const latest = await database.store.ratings.latest(userId, reply);
  assert.deepEqual(
    [latest?.id, latest?.rating, latest?.note, latest?.deviceId],
    [second.id, MESSAGE_RATING.UP, "On reflection it was right.", OTHER_DEVICE_ID],
  );
  const ratings = await database.db
    .select({ id: events.id })
    .from(events)
    .where(eq(events.conversationId, main));
  assert.deepEqual(ratings.map((row) => row.id).sort(), [first.id, second.id].sort());
  assert.deepEqual(
    (await database.store.events.list(userId, main)).map((event) => [event.seq, event.kind]),
    [
      [first.seq, CONVERSATION_EVENT_KIND.RATING],
      [second.seq, CONVERSATION_EVENT_KIND.RATING],
    ],
  );
});

test("a message the account does not own is not found, whether another account's or nobody's", async () => {
  const userId = await database.createUser();
  const other = await database.createUser();
  const { reply } = await populate(other);
  const rating = { rating: MESSAGE_RATING.UP, deviceId: DEVICE_ID } as const;

  assert.deepEqual(await rateMessage(store, userId, reply, rating), {
    ok: false,
    refusal: RATING_REFUSAL.NOT_FOUND,
  });
  assert.deepEqual(
    await rateMessage(store, userId, "00000000-0000-4000-8000-000000000000", rating),
    { ok: false, refusal: RATING_REFUSAL.NOT_FOUND },
  );
  assert.equal(await database.store.ratings.latest(userId, reply), undefined);
  assert.equal(
    (await database.db.select().from(events)).some((row) => row.messageId === reply),
    false,
  );
});

test("a message the account owns but Luke did not write is not rateable: the developer's ask, the brain's own note, and a compaction summary alike", async () => {
  const userId = await database.createUser();
  const { ask, note, main } = await populate(userId);
  const rating = { rating: MESSAGE_RATING.UP, deviceId: DEVICE_ID } as const;
  const compaction = await insertMessage(userId, main, 4, {
    role: MESSAGE_ROLE.ASSISTANT,
    metadata: {
      author: MESSAGE_AUTHOR.BRAIN,
      compaction: { first_kept_message_id: ask, tokens_before: 1200 },
    },
  });
  assert.deepEqual(await rateMessage(store, userId, compaction, rating), {
    ok: false,
    refusal: RATING_REFUSAL.NOT_LUKES,
  });

  assert.deepEqual(await rateMessage(store, userId, ask, rating), {
    ok: false,
    refusal: RATING_REFUSAL.NOT_LUKES,
  });
  assert.deepEqual(await rateMessage(store, userId, note, rating), {
    ok: false,
    refusal: RATING_REFUSAL.NOT_LUKES,
  });
  assert.deepEqual(await database.store.events.list(userId, main), []);
});

test("a message in a cleared conversation is not found, and its earlier rating is no longer read", async () => {
  const userId = await database.createUser();
  const { reply } = await populate(userId);
  const before = await rateMessage(store, userId, reply, {
    rating: MESSAGE_RATING.UP,
    deviceId: DEVICE_ID,
  });
  assert.equal(before.ok, true);
  await database.store.main.clear(userId, NOW);

  assert.deepEqual(
    await rateMessage(store, userId, reply, { rating: MESSAGE_RATING.DOWN, deviceId: DEVICE_ID }),
    { ok: false, refusal: RATING_REFUSAL.NOT_FOUND },
  );
  assert.equal(await database.store.ratings.latest(userId, reply), undefined);
});

test("a latest rating whose payload this build cannot read answers nothing rather than an older verdict", async () => {
  const userId = await database.createUser();
  const { main, reply } = await populate(userId);
  const first = await rateMessage(store, userId, reply, {
    rating: MESSAGE_RATING.UP,
    deviceId: DEVICE_ID,
  });
  assert.equal(first.ok, true);
  await database.db.insert(events).values({
    userId,
    conversationId: main,
    messageId: reply,
    seq: 99,
    kind: CONVERSATION_EVENT_KIND.RATING,
    payload: { rating: "sideways" },
  });
  assert.equal(await database.store.ratings.latest(userId, reply), undefined);
});
