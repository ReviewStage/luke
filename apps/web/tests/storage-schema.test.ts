import assert from "node:assert/strict";
import {
  CONVERSATION_EVENT_KIND,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  TURN_ORIGIN,
  TURN_STATUS,
} from "@sidecar/wire";
import { and, eq, getTableName, type SQL, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { afterAll, test } from "vitest";
import { user } from "../server/db/auth-schema";
import {
  CONVERSATION_KIND,
  conversationLease,
  conversations,
  events,
  messages,
  prompts,
  providerCursors,
  toolSets,
  turns,
} from "../server/db/storage-schema";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";

/**
 * The v2 conversation tables have no reader yet, so what these tests hold to
 * is the shape the migration built: every row cascades with its account, a
 * child goes with its parent, the idempotency key and the observed-session
 * key refuse the duplicate and admit the neighbour, a fresh conversation
 * numbers its messages and events from one, one claim stands per briefing,
 * a prompt or tool set is one row however often it is written, and an
 * observed session keeps one cursor per account.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const UNIQUE_VIOLATION = "23505";

/** Drizzle wraps the driver's error, so the Postgres code stands on the cause rather than the top. */
async function assertUniqueViolation(insert: Promise<unknown>): Promise<void> {
  await assert.rejects(insert, (error) => {
    assert.ok(error instanceof Error);
    const { cause } = error;
    assert.ok(cause instanceof Error && "code" in cause);
    assert.equal(cause.code, UNIQUE_VIOLATION);
    return true;
  });
}

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

async function insertTurn(userId: string, conversationId: string): Promise<string> {
  const [inserted] = await database.db
    .insert(turns)
    .values({
      userId,
      conversationId,
      origin: TURN_ORIGIN.TYPED,
      status: TURN_STATUS.SETTLED,
      responseIds: ["resp_1"],
      usage: { inputTokens: 1, outputTokens: 2, cachedInputTokens: 0, reasoningTokens: 0 },
    })
    .returning({ id: turns.id });
  assert.ok(inserted);
  return inserted.id;
}

async function insertMessage(
  userId: string,
  conversationId: string,
  row: Partial<typeof messages.$inferInsert> = {},
): Promise<string> {
  const [inserted] = await database.db
    .insert(messages)
    .values({
      userId,
      conversationId,
      seq: 1,
      clientId: "client-1",
      role: MESSAGE_ROLE.USER,
      parts: [{ type: "text", text: "hello" }],
      metadata: { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.TYPED },
      ...row,
    })
    .returning({ id: messages.id });
  assert.ok(inserted);
  return inserted.id;
}

async function insertEvent(
  userId: string,
  conversationId: string,
  messageId: string,
  row: Partial<typeof events.$inferInsert> = {},
): Promise<string> {
  const [inserted] = await database.db
    .insert(events)
    .values({
      userId,
      conversationId,
      messageId,
      seq: 1,
      kind: CONVERSATION_EVENT_KIND.SPEECH_OFFERED,
      ...row,
    })
    .returning({ id: events.id });
  assert.ok(inserted);
  return inserted.id;
}

async function countRows(table: PgTable, where: SQL): Promise<number> {
  const [row] = await database.db
    .select({ count: sql<number>`count(*)::int` })
    .from(table)
    .where(where);
  return row?.count ?? 0;
}

/** One account's full set of rows: a main conversation with a turn and a message, a child of it, and the lease. */
async function populateAccount(userId: string): Promise<{ main: string; child: string }> {
  const main = await insertConversation(userId);
  const turnId = await insertTurn(userId, main);
  const spawnedBy = await insertMessage(userId, main, { turnId });
  const child = await insertConversation(userId, {
    kind: CONVERSATION_KIND.CHILD,
    parentConversationId: main,
    spawnedByMessageId: spawnedBy,
    forkOfSeq: 1,
  });
  await insertTurn(userId, child);
  await insertMessage(userId, child, { role: MESSAGE_ROLE.ASSISTANT, metadata: undefined });
  await insertEvent(userId, main, spawnedBy);
  await database.db.insert(providerCursors).values({
    userId,
    providerId: "conductor",
    providerSessionId: "session-1",
    cursor: "after-1",
  });
  const now = new Date();
  await database.db.insert(conversationLease).values({
    userId,
    owner: "drainer-1",
    acquiredAt: now,
    heartbeatAt: now,
    expiresAt: now,
  });
  return { main, child };
}

test("every v2 row cascades with its account and no other account's", async () => {
  const userId = await database.createUser();
  const other = await database.createUser();
  await populateAccount(userId);
  await populateAccount(other);

  await database.db.delete(user).where(eq(user.id, userId));

  for (const table of [
    conversations,
    messages,
    turns,
    events,
    providerCursors,
    conversationLease,
  ]) {
    assert.equal(
      await countRows(table, eq(table.userId, userId)),
      0,
      `${getTableName(table)} still holds rows for the deleted user`,
    );
    assert.ok(
      (await countRows(table, eq(table.userId, other))) > 0,
      `${getTableName(table)} lost the other user's rows`,
    );
  }
});

test("deleting a parent conversation takes its descendants, their turns, and their messages", async () => {
  const userId = await database.createUser();
  const { main, child } = await populateAccount(userId);
  const grandchild = await insertConversation(userId, {
    kind: CONVERSATION_KIND.CHILD,
    parentConversationId: child,
  });
  const bystander = await insertConversation(userId, { kind: CONVERSATION_KIND.THREAD });
  await insertMessage(userId, bystander, { turnId: await insertTurn(userId, bystander) });

  await database.db.delete(conversations).where(eq(conversations.id, main));

  for (const gone of [main, child, grandchild]) {
    assert.equal(await countRows(conversations, eq(conversations.id, gone)), 0);
    assert.equal(await countRows(messages, eq(messages.conversationId, gone)), 0);
    assert.equal(await countRows(turns, eq(turns.conversationId, gone)), 0);
    assert.equal(await countRows(events, eq(events.conversationId, gone)), 0);
  }
  assert.equal(await countRows(conversations, eq(conversations.id, bystander)), 1);
  assert.equal(await countRows(messages, eq(messages.conversationId, bystander)), 1);
  assert.equal(await countRows(turns, eq(turns.conversationId, bystander)), 1);
  assert.equal(await countRows(conversationLease, eq(conversationLease.userId, userId)), 1);
});

test("a message's client id is unique within its conversation and free in another", async () => {
  const userId = await database.createUser();
  const first = await insertConversation(userId);
  const second = await insertConversation(userId, { kind: CONVERSATION_KIND.THREAD });
  await insertMessage(userId, first, { clientId: "ask-1" });

  await assertUniqueViolation(insertMessage(userId, first, { clientId: "ask-1", seq: 2 }));
  await insertMessage(userId, second, { clientId: "ask-1" });

  assert.equal(await countRows(messages, eq(messages.conversationId, first)), 1);
  assert.equal(await countRows(messages, eq(messages.conversationId, second)), 1);
});

test("a message's sequence is unique within its conversation and free in another", async () => {
  const userId = await database.createUser();
  const first = await insertConversation(userId);
  const second = await insertConversation(userId, { kind: CONVERSATION_KIND.THREAD });
  await insertMessage(userId, first, { clientId: "ask-1", seq: 7 });

  await assertUniqueViolation(insertMessage(userId, first, { clientId: "ask-2", seq: 7 }));
  await insertMessage(userId, second, { clientId: "ask-2", seq: 7 });

  assert.equal(await countRows(messages, eq(messages.conversationId, first)), 1);
  assert.equal(await countRows(messages, eq(messages.conversationId, second)), 1);
});

test("an observed session has one conversation per account, and unobserved kinds never collide", async () => {
  const userId = await database.createUser();
  const other = await database.createUser();
  const observed = {
    kind: CONVERSATION_KIND.OBSERVED,
    providerId: "conductor",
    providerSessionId: "session-1",
  } as const;
  await insertConversation(userId, observed);

  await assertUniqueViolation(insertConversation(userId, observed));
  await insertConversation(other, observed);
  await insertConversation(userId, { ...observed, providerSessionId: "session-2" });
  await insertConversation(userId, { kind: CONVERSATION_KIND.THREAD });
  await insertConversation(userId, { kind: CONVERSATION_KIND.THREAD });

  assert.equal(await countRows(conversations, eq(conversations.userId, userId)), 4);
  assert.equal(await countRows(conversations, eq(conversations.userId, other)), 1);
});

test("a new conversation numbers its messages and events from one and stands undeleted", async () => {
  const userId = await database.createUser();
  const id = await insertConversation(userId);

  const [row] = await database.db.select().from(conversations).where(eq(conversations.id, id));
  assert.ok(row);
  assert.equal(row.nextMessageSeq, 1);
  assert.equal(row.nextEventSeq, 1);
  assert.equal(row.deletedAt, null);
  assert.equal(row.parentConversationId, null);
  assert.equal(row.spawnedByMessageId, null);
  assert.ok(row.createdAt instanceof Date);
  assert.ok(row.lastActivityAt instanceof Date);
});

test("a turn keeps its response ids in order and its usage as the four counts", async () => {
  const userId = await database.createUser();
  const conversationId = await insertConversation(userId);
  const turnId = await insertTurn(userId, conversationId);

  const [row] = await database.db.select().from(turns).where(eq(turns.id, turnId));
  assert.ok(row);
  assert.deepEqual(row.responseIds, ["resp_1"]);
  assert.deepEqual(row.usage, {
    inputTokens: 1,
    outputTokens: 2,
    cachedInputTokens: 0,
    reasoningTokens: 0,
  });
  assert.equal(row.status, TURN_STATUS.SETTLED);
  assert.equal(row.origin, TURN_ORIGIN.TYPED);
  assert.equal(row.startedAt, null);
  assert.equal(row.cancelRequestedAt, null);
});

test("a message takes one speech.claimed event, and the claim refuses every second claimant", async () => {
  const userId = await database.createUser();
  const conversationId = await insertConversation(userId);
  const briefing = await insertMessage(userId, conversationId, { role: MESSAGE_ROLE.ASSISTANT });
  await insertEvent(userId, conversationId, briefing, {
    seq: 1,
    kind: CONVERSATION_EVENT_KIND.SPEECH_OFFERED,
  });
  await insertEvent(userId, conversationId, briefing, {
    seq: 2,
    kind: CONVERSATION_EVENT_KIND.SPEECH_CLAIMED,
    deviceId: "mac-1",
  });

  await assertUniqueViolation(
    insertEvent(userId, conversationId, briefing, {
      seq: 3,
      kind: CONVERSATION_EVENT_KIND.SPEECH_CLAIMED,
      deviceId: "phone-1",
    }),
  );

  const claims = await database.db
    .select({ deviceId: events.deviceId })
    .from(events)
    .where(
      and(eq(events.messageId, briefing), eq(events.kind, CONVERSATION_EVENT_KIND.SPEECH_CLAIMED)),
    );
  assert.deepEqual(claims, [{ deviceId: "mac-1" }]);
});

test("the claim binds one message alone: other kinds on it and claims on other messages are admitted", async () => {
  const userId = await database.createUser();
  const conversationId = await insertConversation(userId);
  const first = await insertMessage(userId, conversationId, {
    clientId: "briefing-1",
    seq: 1,
    role: MESSAGE_ROLE.ASSISTANT,
  });
  const second = await insertMessage(userId, conversationId, {
    clientId: "briefing-2",
    seq: 2,
    role: MESSAGE_ROLE.ASSISTANT,
  });
  await insertEvent(userId, conversationId, first, {
    seq: 1,
    kind: CONVERSATION_EVENT_KIND.SPEECH_CLAIMED,
  });

  await insertEvent(userId, conversationId, first, {
    seq: 2,
    kind: CONVERSATION_EVENT_KIND.SPEECH_SPOKEN,
  });
  await insertEvent(userId, conversationId, first, {
    seq: 3,
    kind: CONVERSATION_EVENT_KIND.RATING,
    payload: { rating: "up" },
  });
  await insertEvent(userId, conversationId, second, {
    seq: 4,
    kind: CONVERSATION_EVENT_KIND.SPEECH_CLAIMED,
  });

  assert.equal(await countRows(events, eq(events.messageId, first)), 3);
  assert.equal(await countRows(events, eq(events.messageId, second)), 1);
});

test("an event's sequence is unique within its conversation and free in another", async () => {
  const userId = await database.createUser();
  const first = await insertConversation(userId);
  const second = await insertConversation(userId, { kind: CONVERSATION_KIND.THREAD });
  const firstMessage = await insertMessage(userId, first);
  const secondMessage = await insertMessage(userId, second);
  await insertEvent(userId, first, firstMessage, { seq: 7 });

  await assertUniqueViolation(insertEvent(userId, first, firstMessage, { seq: 7 }));
  await insertEvent(userId, second, secondMessage, { seq: 7 });

  assert.equal(await countRows(events, eq(events.conversationId, first)), 1);
  assert.equal(await countRows(events, eq(events.conversationId, second)), 1);
});

test("deleting a message takes its events and leaves its neighbour's", async () => {
  const userId = await database.createUser();
  const conversationId = await insertConversation(userId);
  const gone = await insertMessage(userId, conversationId, { clientId: "m-1", seq: 1 });
  const kept = await insertMessage(userId, conversationId, { clientId: "m-2", seq: 2 });
  await insertEvent(userId, conversationId, gone, { seq: 1 });
  await insertEvent(userId, conversationId, gone, {
    seq: 2,
    kind: CONVERSATION_EVENT_KIND.SPEECH_CLAIMED,
  });
  await insertEvent(userId, conversationId, kept, { seq: 3 });

  await database.db.delete(messages).where(eq(messages.id, gone));

  assert.equal(await countRows(events, eq(events.messageId, gone)), 0);
  assert.equal(await countRows(events, eq(events.messageId, kept)), 1);
});

test("an event keeps its kind, device, and payload as written", async () => {
  const userId = await database.createUser();
  const conversationId = await insertConversation(userId);
  const messageId = await insertMessage(userId, conversationId);
  const id = await insertEvent(userId, conversationId, messageId, {
    kind: CONVERSATION_EVENT_KIND.SPEECH_HELD,
    deviceId: "mac-1",
    payload: { until: 1_700_000_000_000 },
  });

  const [row] = await database.db.select().from(events).where(eq(events.id, id));
  assert.ok(row);
  assert.equal(row.kind, CONVERSATION_EVENT_KIND.SPEECH_HELD);
  assert.equal(row.deviceId, "mac-1");
  assert.deepEqual(row.payload, { until: 1_700_000_000_000 });
  assert.equal(row.seq, 1);
  assert.ok(row.createdAt instanceof Date);
});

test("a prompt and a tool set are one row per hash however often they are written", async () => {
  const prompt = { hash: "prompt-hash-1", text: "You are Luke." };
  const toolSet = { hash: "tools-hash-1", schemas: [{ name: "read_transcript" }] };

  await database.db.insert(prompts).values(prompt);
  await database.db.insert(prompts).values(prompt).onConflictDoNothing();
  await assertUniqueViolation(database.db.insert(prompts).values(prompt));
  await database.db.insert(toolSets).values(toolSet);
  await database.db.insert(toolSets).values(toolSet).onConflictDoNothing();

  const promptRows = await database.db.select().from(prompts).where(eq(prompts.hash, prompt.hash));
  assert.equal(promptRows.length, 1);
  assert.equal(promptRows[0]?.text, prompt.text);
  const toolSetRows = await database.db
    .select()
    .from(toolSets)
    .where(eq(toolSets.hash, toolSet.hash));
  assert.equal(toolSetRows.length, 1);
  assert.deepEqual(toolSetRows[0]?.schemas, toolSet.schemas);
});

test("an observed session keeps one cursor per account, advanced in place", async () => {
  const userId = await database.createUser();
  const other = await database.createUser();
  const session = { providerId: "conductor", providerSessionId: "session-1" } as const;
  await database.db.insert(providerCursors).values({ userId, ...session, cursor: "after-1" });

  await assertUniqueViolation(
    database.db.insert(providerCursors).values({ userId, ...session, cursor: "after-2" }),
  );
  await database.db
    .insert(providerCursors)
    .values({ userId, ...session, cursor: "after-2" })
    .onConflictDoUpdate({
      target: [
        providerCursors.userId,
        providerCursors.providerId,
        providerCursors.providerSessionId,
      ],
      set: { cursor: "after-2" },
    });
  await database.db
    .insert(providerCursors)
    .values({ userId: other, ...session, cursor: "after-9" });
  await database.db
    .insert(providerCursors)
    .values({ userId, ...session, providerSessionId: "session-2", cursor: "after-3" });

  const rows = await database.db
    .select({
      providerSessionId: providerCursors.providerSessionId,
      cursor: providerCursors.cursor,
    })
    .from(providerCursors)
    .where(eq(providerCursors.userId, userId))
    .orderBy(providerCursors.providerSessionId);
  assert.deepEqual(rows, [
    { providerSessionId: "session-1", cursor: "after-2" },
    { providerSessionId: "session-2", cursor: "after-3" },
  ]);
});
