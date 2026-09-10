import assert from "node:assert/strict";
import test, { after } from "node:test";
import { MESSAGE_AUTHOR, MESSAGE_CHANNEL, MESSAGE_ROLE } from "@sidecar/wire";
import { eq, getTableName, type SQL, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { user } from "../server/db/auth-schema";
import {
  CONVERSATION_KIND,
  conversationLease,
  conversations,
  messages,
  TURN_ORIGIN,
  TURN_STATUS,
  turns,
} from "../server/db/storage-schema";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";

/**
 * The v2 conversation tables have no reader yet, so what these tests hold to
 * is the shape the migration built: every row cascades with its account, a
 * child goes with its parent, the idempotency key and the observed-session
 * key refuse the duplicate and admit the neighbour, and a fresh conversation
 * numbers its messages and events from one.
 */

const database = await openHostedStoreTestDatabase();
after(() => database.close());

const UNIQUE_VIOLATION = "23505";

/** Drizzle wraps the driver's error, so the Postgres code stands on the cause rather than the top. */
async function assertUniqueViolation(insert: Promise<string>): Promise<void> {
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

  for (const table of [conversations, messages, turns, conversationLease]) {
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
  await insertConversation(userId);
  await insertConversation(userId);

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
