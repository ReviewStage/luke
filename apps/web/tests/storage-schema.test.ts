import assert from "node:assert/strict";
import {
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  TURN_ORIGIN,
  TURN_STATUS,
} from "@sidecar/wire";
import { eq, getTableName } from "drizzle-orm";
import { Effect, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { afterAll, test } from "vitest";
import { MIGRATIONS_TABLE } from "../server/db/effect-migrator";
import { db } from "../server/db/query";
import { conversations, messages, turns } from "../server/db/storage-schema";
import { EpochMillisColumnSchema, InstantColumnSchema } from "../server/hosted/store/database";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import {
  assertRefusedWithCode,
  countRowsWhere,
  deleteUser,
  insertConversation,
  insertMessage,
  insertTurn,
  POSTGRES_ERROR,
  readConversationById,
  readTurnById,
} from "./support/store-rows";

/**
 * What these tests hold to is the shape the migrations built: every row
 * cascades with its account and its conversation, the idempotency key and
 * the message sequence refuse the duplicate and admit the neighbour, a fresh
 * conversation numbers its messages from one, every table an earlier build
 * kept is gone, and the latest-turn laterals and the abandoned-turn sweep
 * have the indexes they read through while a conversation keeps only the
 * purge's. The migration runner's own bookkeeping table is not one of them:
 * it records which of these tables a database has, and is declared by no
 * schema file.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

/** Every table the migrations declare, by its Postgres name, better-auth's own alongside Luke's. */
const DECLARED_TABLES = [
  "account",
  "account_preference",
  "admin_favorite",
  "asks",
  "conversations",
  "hosted_usage",
  "jwks",
  "messages",
  "oauth_access_token",
  "oauth_client",
  "oauth_consent",
  "oauth_refresh_token",
  "plan",
  "plan_command",
  "session",
  "turns",
  "user",
  "verification",
  "voice_session_usage",
  "voice_sessions",
  "voice_transcript_segments",
].sort();

async function publicTableNames(): Promise<readonly string[]> {
  const rows = await database.run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql`
        select table_name as name from information_schema.tables where table_schema = 'public'
      `;
    }),
  );
  const NameRowSchema = Schema.Struct({ name: Schema.String });
  return rows
    .map((row) => Schema.decodeUnknownSync(NameRowSchema)(row).name)
    .filter((name) => name !== MIGRATIONS_TABLE)
    .sort();
}

test("the migrations end at the declared schema: every declared table stands, and nothing undeclared, an earlier build's observation, device, vault, and notebook tables included, remains", async () => {
  assert.deepEqual(await publicTableNames(), DECLARED_TABLES);
});

/** The indexes the purge, the latest-turn laterals, and the abandoned-turn sweep read through, as Postgres reads them back. */
const READ_INDEXES = [
  {
    name: "conversations_deleted_at",
    definition:
      "CREATE INDEX conversations_deleted_at ON public.conversations USING btree (deleted_at) " +
      "WHERE (deleted_at IS NOT NULL)",
  },
  {
    name: "turns_conversation_queued",
    definition:
      "CREATE INDEX turns_conversation_queued ON public.turns USING btree (conversation_id, queued_at DESC, id DESC)",
  },
  {
    name: "turns_running_started",
    definition:
      "CREATE INDEX turns_running_started ON public.turns USING btree (started_at, id) WHERE (status = 'running'::text)",
  },
];

test("the purge, the latest-turn laterals, and the abandoned-turn sweep have their indexes, on the columns and in the order they read", async () => {
  const rows = await database.run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql`
        select indexname as name, indexdef as definition from pg_indexes
        where schemaname = 'public' and indexname in ${sql.in(READ_INDEXES.map((index) => index.name))}
        order by indexname
      `;
    }),
  );
  const IndexRowSchema = Schema.Struct({ name: Schema.String, definition: Schema.String });
  assert.deepEqual(
    rows.map((row) => Schema.decodeUnknownSync(IndexRowSchema)(row)),
    READ_INDEXES,
  );
});

test("a conversation keeps its key and the purge's index alone: no index an earlier build's conversation kinds read stands", async () => {
  const rows = await database.run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql`
        select indexname as name from pg_indexes
        where schemaname = 'public' and tablename = 'conversations'
        order by indexname
      `;
    }),
  );
  const NameRowSchema = Schema.Struct({ name: Schema.String });
  assert.deepEqual(
    rows.map((row) => Schema.decodeUnknownSync(NameRowSchema)(row).name),
    ["conversations_deleted_at", "conversations_pkey"],
  );
});

async function insertTestConversation(
  userId: string,
  row: Omit<Parameters<typeof insertConversation>[1], "userId"> = {},
): Promise<string> {
  return insertConversation(database.run, { ...row, userId });
}

async function insertTestTurn(userId: string, conversationId: string): Promise<string> {
  return insertTurn(database.run, {
    userId,
    conversationId,
    origin: TURN_ORIGIN.TYPED,
    status: TURN_STATUS.SETTLED,
    responseIds: ["resp_1"],
    usage: { inputTokens: 1, outputTokens: 2, cachedInputTokens: 0, reasoningTokens: 0 },
  });
}

async function insertTestMessage(
  userId: string,
  conversationId: string,
  row: Partial<Parameters<typeof insertMessage>[1]> = {},
): Promise<string> {
  return insertMessage(database.run, {
    userId,
    conversationId,
    seq: 1,
    clientId: "client-1",
    role: MESSAGE_ROLE.USER,
    parts: [{ type: "text", text: "hello" }],
    metadata: { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.TYPED },
    ...row,
  });
}

/** One account's full set of rows: a plan's conversation with a turn and a message. */
async function populateAccount(userId: string): Promise<string> {
  const conversationId = await insertTestConversation(userId);
  const turnId = await insertTestTurn(userId, conversationId);
  await insertTestMessage(userId, conversationId, { turnId });
  return conversationId;
}

test("every conversation row cascades with its account and no other account's", async () => {
  const userId = await database.createUser();
  const other = await database.createUser();
  await populateAccount(userId);
  await populateAccount(other);

  await deleteUser(database.run, userId);

  for (const column of [conversations.userId, messages.userId, turns.userId]) {
    const table = getTableName(column.table);
    assert.equal(
      await countRowsWhere(database.run, column, userId),
      0,
      `${table} still holds rows for the deleted user`,
    );
    assert.ok(
      (await countRowsWhere(database.run, column, other)) > 0,
      `${table} lost the other user's rows`,
    );
  }
});

test("deleting a conversation takes its turns and its messages and leaves its neighbour's", async () => {
  const userId = await database.createUser();
  const gone = await populateAccount(userId);
  const bystander = await populateAccount(userId);

  await database.run(Effect.asVoid(db.delete(conversations).where(eq(conversations.id, gone))));

  assert.equal(await countRowsWhere(database.run, conversations.id, gone), 0);
  assert.equal(await countRowsWhere(database.run, messages.conversationId, gone), 0);
  assert.equal(await countRowsWhere(database.run, turns.conversationId, gone), 0);
  assert.equal(await countRowsWhere(database.run, conversations.id, bystander), 1);
  assert.equal(await countRowsWhere(database.run, messages.conversationId, bystander), 1);
  assert.equal(await countRowsWhere(database.run, turns.conversationId, bystander), 1);
});

test("a message's client id is unique within its conversation and free in another", async () => {
  const userId = await database.createUser();
  const first = await insertTestConversation(userId);
  const second = await insertTestConversation(userId);
  await insertTestMessage(userId, first, { clientId: "ask-1" });

  await assertRefusedWithCode(
    insertTestMessage(userId, first, { clientId: "ask-1", seq: 2 }),
    POSTGRES_ERROR.UNIQUE_VIOLATION,
  );
  await insertTestMessage(userId, second, { clientId: "ask-1" });

  assert.equal(await countRowsWhere(database.run, messages.conversationId, first), 1);
  assert.equal(await countRowsWhere(database.run, messages.conversationId, second), 1);
});

test("a message's sequence is unique within its conversation and free in another", async () => {
  const userId = await database.createUser();
  const first = await insertTestConversation(userId);
  const second = await insertTestConversation(userId);
  await insertTestMessage(userId, first, { clientId: "ask-1", seq: 7 });

  await assertRefusedWithCode(
    insertTestMessage(userId, first, { clientId: "ask-2", seq: 7 }),
    POSTGRES_ERROR.UNIQUE_VIOLATION,
  );
  await insertTestMessage(userId, second, { clientId: "ask-2", seq: 7 });

  assert.equal(await countRowsWhere(database.run, messages.conversationId, first), 1);
  assert.equal(await countRowsWhere(database.run, messages.conversationId, second), 1);
});

test("a new conversation numbers its messages from one and stands undeleted", async () => {
  const userId = await database.createUser();
  const id = await insertTestConversation(userId);

  const [row] = await readConversationById(database.run, id);
  assert.ok(row);
  const decoded = Schema.decodeUnknownSync(
    Schema.Struct({
      nextMessageSeq: EpochMillisColumnSchema,
      deletedAt: Schema.Null,
      createdAt: InstantColumnSchema,
      lastActivityAt: InstantColumnSchema,
    }),
  )(row);
  assert.equal(decoded.nextMessageSeq, 1);
});

test("a turn keeps its response ids in order and its usage as the four counts", async () => {
  const userId = await database.createUser();
  const conversationId = await insertTestConversation(userId);
  const turnId = await insertTestTurn(userId, conversationId);

  const row = await readTurnById(database.run, turnId);
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
});
