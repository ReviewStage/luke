import assert from "node:assert/strict";
import {
  CONVERSATION_EVENT_KIND,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  TURN_ORIGIN,
  TURN_STATUS,
} from "@sidecar/wire";
import { Effect, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { afterAll, test } from "vitest";
import { MIGRATIONS_TABLE } from "../server/db/effect-migrator";
import { CONVERSATION_KIND } from "../server/db/storage-vocabulary";
import { EpochMillisColumnSchema, InstantColumnSchema } from "../server/hosted/store/database";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import {
  assertRefusedWithCode,
  countRowsWhere,
  deleteUser,
  insertConversation,
  insertEvent,
  insertMessage,
  insertProviderCursor,
  insertTurn,
  instantColumn,
  POSTGRES_ERROR,
  readConversationById,
  readEventsByMessage,
  readProviderCursorsByUser,
  readTurnById,
  upsertProviderCursor,
} from "./support/store-rows";

/**
 * What these tests hold to is the shape the migrations built: every row
 * cascades with its account, a child goes with its parent, the idempotency
 * key and the observed-session key refuse the duplicate and admit the
 * neighbour, a fresh conversation numbers its messages and events from one,
 * one claim stands per briefing, a tool set is one row however often it is
 * written, an observed session keeps one cursor per account, and
 * the v1 conversation tables and the briefing table are gone, the
 * per-conversation latest-turn laterals and the completion sweep have the
 * indexes they read through, and a child says whether it expects a
 * completion. The migration
 * runner's own bookkeeping table is not one of them: it records which of these
 * tables a database has, and is declared by no schema file.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

/** Every table the migrations declare, by its Postgres name, better-auth's own alongside Luke's. */
const DECLARED_TABLES = [
  "account",
  "account_preference",
  "account_workspace_preference",
  "admin_favorite",
  "asks",
  "conversations",
  "devices",
  "events",
  "hosted_usage",
  "introduction_usage",
  "jwks",
  "messages",
  "oauth_access_token",
  "oauth_client",
  "oauth_consent",
  "oauth_refresh_token",
  "observation_pass",
  "provider_cursors",
  "provider_key",
  "roster_consumed",
  "roster_diff",
  "roster_snapshot",
  "session",
  "transcript_mark",
  "turns",
  "user",
  "verification",
  "voice_session_usage",
  "voice_sessions",
  "voice_transcript_segments",
  "workspace_embedding",
  "workspace_file",
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

test("the migrations end at the declared schema: every declared table stands, and nothing undeclared, the v1 conversation tables and the briefing table included, remains", async () => {
  assert.deepEqual(await publicTableNames(), DECLARED_TABLES);
});

/** The indexes the children, agents, completion-sweep, and abandoned-turn reads run through, as Postgres reads them back. */
const READ_INDEXES = [
  {
    name: "conversations_undelivered_children",
    definition:
      "CREATE INDEX conversations_undelivered_children ON public.conversations USING btree (user_id) " +
      "WHERE ((kind = 'child'::text) AND (completion_delivered_at IS NULL) AND (deleted_at IS NULL))",
  },
  {
    name: "conversations_user_kind",
    definition:
      "CREATE INDEX conversations_user_kind ON public.conversations USING btree (user_id, kind)",
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

test("the latest-turn laterals, the completion sweep, and the abandoned-turn sweep have their indexes, on the columns and in the order they read", async () => {
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

test("a child says whether it expects a completion: the column refuses null", async () => {
  const userId = await database.createUser();
  const main = await insertTestConversation(userId);

  await assertRefusedWithCode(
    database.run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`
          insert into conversations (user_id, kind, parent_conversation_id, expects_completion)
          values (${userId}, ${CONVERSATION_KIND.CHILD}, ${main}, null)
        `;
      }),
    ),
    POSTGRES_ERROR.NOT_NULL_VIOLATION,
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

async function insertTestEvent(
  userId: string,
  conversationId: string,
  messageId: string,
  row: Partial<Parameters<typeof insertEvent>[1]> = {},
): Promise<string> {
  return insertEvent(database.run, {
    userId,
    conversationId,
    messageId,
    seq: 1,
    kind: CONVERSATION_EVENT_KIND.SPEECH_OFFERED,
    ...row,
  });
}

/** One account's full set of rows: a main conversation with a turn and a message, a child of it, and a provider cursor. */
async function populateAccount(userId: string): Promise<{ main: string; child: string }> {
  const main = await insertTestConversation(userId);
  const turnId = await insertTestTurn(userId, main);
  const spawnedBy = await insertTestMessage(userId, main, { turnId });
  const child = await insertTestConversation(userId, {
    kind: CONVERSATION_KIND.CHILD,
    parentConversationId: main,
    spawnedByMessageId: spawnedBy,
    forkOfSeq: 1,
  });
  await insertTestTurn(userId, child);
  await insertTestMessage(userId, child, { role: MESSAGE_ROLE.ASSISTANT, metadata: undefined });
  await insertTestEvent(userId, main, spawnedBy);
  await insertProviderCursor(database.run, {
    userId,
    providerId: "conductor",
    providerSessionId: "session-1",
    cursor: "after-1",
  });
  return { main, child };
}

test("every conversation row cascades with its account and no other account's", async () => {
  const userId = await database.createUser();
  const other = await database.createUser();
  await populateAccount(userId);
  await populateAccount(other);

  await deleteUser(database.run, userId);

  for (const table of ["conversations", "messages", "turns", "events", "provider_cursors"]) {
    assert.equal(
      await countRowsWhere(database.run, table, "user_id", userId),
      0,
      `${table} still holds rows for the deleted user`,
    );
    assert.ok(
      (await countRowsWhere(database.run, table, "user_id", other)) > 0,
      `${table} lost the other user's rows`,
    );
  }
});

test("deleting a parent conversation takes its descendants, their turns, and their messages", async () => {
  const userId = await database.createUser();
  const { main, child } = await populateAccount(userId);
  const grandchild = await insertTestConversation(userId, {
    kind: CONVERSATION_KIND.CHILD,
    parentConversationId: child,
  });
  const bystander = await insertTestConversation(userId, { kind: CONVERSATION_KIND.THREAD });
  await insertTestMessage(userId, bystander, { turnId: await insertTestTurn(userId, bystander) });

  await database.run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`delete from conversations where id = ${main}`;
    }),
  );

  for (const gone of [main, child, grandchild]) {
    assert.equal(await countRowsWhere(database.run, "conversations", "id", gone), 0);
    assert.equal(await countRowsWhere(database.run, "messages", "conversation_id", gone), 0);
    assert.equal(await countRowsWhere(database.run, "turns", "conversation_id", gone), 0);
    assert.equal(await countRowsWhere(database.run, "events", "conversation_id", gone), 0);
  }
  assert.equal(await countRowsWhere(database.run, "conversations", "id", bystander), 1);
  assert.equal(await countRowsWhere(database.run, "messages", "conversation_id", bystander), 1);
  assert.equal(await countRowsWhere(database.run, "turns", "conversation_id", bystander), 1);
});

test("a message's client id is unique within its conversation and free in another", async () => {
  const userId = await database.createUser();
  const first = await insertTestConversation(userId);
  const second = await insertTestConversation(userId, { kind: CONVERSATION_KIND.THREAD });
  await insertTestMessage(userId, first, { clientId: "ask-1" });

  await assertRefusedWithCode(
    insertTestMessage(userId, first, { clientId: "ask-1", seq: 2 }),
    POSTGRES_ERROR.UNIQUE_VIOLATION,
  );
  await insertTestMessage(userId, second, { clientId: "ask-1" });

  assert.equal(await countRowsWhere(database.run, "messages", "conversation_id", first), 1);
  assert.equal(await countRowsWhere(database.run, "messages", "conversation_id", second), 1);
});

test("a message's sequence is unique within its conversation and free in another", async () => {
  const userId = await database.createUser();
  const first = await insertTestConversation(userId);
  const second = await insertTestConversation(userId, { kind: CONVERSATION_KIND.THREAD });
  await insertTestMessage(userId, first, { clientId: "ask-1", seq: 7 });

  await assertRefusedWithCode(
    insertTestMessage(userId, first, { clientId: "ask-2", seq: 7 }),
    POSTGRES_ERROR.UNIQUE_VIOLATION,
  );
  await insertTestMessage(userId, second, { clientId: "ask-2", seq: 7 });

  assert.equal(await countRowsWhere(database.run, "messages", "conversation_id", first), 1);
  assert.equal(await countRowsWhere(database.run, "messages", "conversation_id", second), 1);
});

test("an observed session has one conversation per account, and unobserved kinds never collide", async () => {
  const userId = await database.createUser();
  const other = await database.createUser();
  const observed = {
    kind: CONVERSATION_KIND.OBSERVED,
    providerId: "conductor",
    providerSessionId: "session-1",
  } as const;
  await insertTestConversation(userId, observed);

  await assertRefusedWithCode(
    insertTestConversation(userId, observed),
    POSTGRES_ERROR.UNIQUE_VIOLATION,
  );
  await insertTestConversation(other, observed);
  await insertTestConversation(userId, { ...observed, providerSessionId: "session-2" });
  await insertTestConversation(userId, { kind: CONVERSATION_KIND.THREAD });
  await insertTestConversation(userId, { kind: CONVERSATION_KIND.THREAD });

  assert.equal(await countRowsWhere(database.run, "conversations", "user_id", userId), 4);
  assert.equal(await countRowsWhere(database.run, "conversations", "user_id", other), 1);
});

test("a new conversation numbers its messages and events from one and stands undeleted", async () => {
  const userId = await database.createUser();
  const id = await insertTestConversation(userId);

  const [row] = await readConversationById(database.run, id);
  assert.ok(row);
  const decoded = Schema.decodeUnknownSync(
    Schema.Struct({
      next_message_seq: EpochMillisColumnSchema,
      next_event_seq: EpochMillisColumnSchema,
      deleted_at: Schema.Null,
      parent_conversation_id: Schema.Null,
      spawned_by_message_id: Schema.Null,
      created_at: InstantColumnSchema,
      last_activity_at: InstantColumnSchema,
    }),
  )(row);
  assert.equal(decoded.next_message_seq, 1);
  assert.equal(decoded.next_event_seq, 1);
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
  assert.equal(row.cancelRequestedAt, null);
});

test("a message takes one speech.claimed event, and the claim refuses every second claimant", async () => {
  const userId = await database.createUser();
  const conversationId = await insertTestConversation(userId);
  const briefing = await insertTestMessage(userId, conversationId, {
    role: MESSAGE_ROLE.ASSISTANT,
  });
  await insertTestEvent(userId, conversationId, briefing, {
    seq: 1,
    kind: CONVERSATION_EVENT_KIND.SPEECH_OFFERED,
  });
  await insertTestEvent(userId, conversationId, briefing, {
    seq: 2,
    kind: CONVERSATION_EVENT_KIND.SPEECH_CLAIMED,
    deviceId: "mac-1",
  });

  await assertRefusedWithCode(
    insertTestEvent(userId, conversationId, briefing, {
      seq: 3,
      kind: CONVERSATION_EVENT_KIND.SPEECH_CLAIMED,
      deviceId: "phone-1",
    }),
    POSTGRES_ERROR.UNIQUE_VIOLATION,
  );

  const events = await readEventsByMessage(database.run, briefing);
  const claims = events
    .filter((event) => event.kind === CONVERSATION_EVENT_KIND.SPEECH_CLAIMED)
    .map((event) => ({ deviceId: event.device_id }));
  assert.deepEqual(claims, [{ deviceId: "mac-1" }]);
});

test("the claim binds one message alone: other kinds on it and claims on other messages are admitted", async () => {
  const userId = await database.createUser();
  const conversationId = await insertTestConversation(userId);
  const first = await insertTestMessage(userId, conversationId, {
    clientId: "briefing-1",
    seq: 1,
    role: MESSAGE_ROLE.ASSISTANT,
  });
  const second = await insertTestMessage(userId, conversationId, {
    clientId: "briefing-2",
    seq: 2,
    role: MESSAGE_ROLE.ASSISTANT,
  });
  await insertTestEvent(userId, conversationId, first, {
    seq: 1,
    kind: CONVERSATION_EVENT_KIND.SPEECH_CLAIMED,
  });

  await insertTestEvent(userId, conversationId, first, {
    seq: 2,
    kind: CONVERSATION_EVENT_KIND.SPEECH_SPOKEN,
  });
  await insertTestEvent(userId, conversationId, first, {
    seq: 3,
    kind: CONVERSATION_EVENT_KIND.RATING,
    payload: { rating: "up" },
  });
  await insertTestEvent(userId, conversationId, second, {
    seq: 4,
    kind: CONVERSATION_EVENT_KIND.SPEECH_CLAIMED,
  });

  assert.equal(await countRowsWhere(database.run, "events", "message_id", first), 3);
  assert.equal(await countRowsWhere(database.run, "events", "message_id", second), 1);
});

test("an event's sequence is unique within its conversation and free in another", async () => {
  const userId = await database.createUser();
  const first = await insertTestConversation(userId);
  const second = await insertTestConversation(userId, { kind: CONVERSATION_KIND.THREAD });
  const firstMessage = await insertTestMessage(userId, first);
  const secondMessage = await insertTestMessage(userId, second);
  await insertTestEvent(userId, first, firstMessage, { seq: 7 });

  await assertRefusedWithCode(
    insertTestEvent(userId, first, firstMessage, { seq: 7 }),
    POSTGRES_ERROR.UNIQUE_VIOLATION,
  );
  await insertTestEvent(userId, second, secondMessage, { seq: 7 });

  assert.equal(await countRowsWhere(database.run, "events", "conversation_id", first), 1);
  assert.equal(await countRowsWhere(database.run, "events", "conversation_id", second), 1);
});

test("deleting a message takes its events and leaves its neighbour's", async () => {
  const userId = await database.createUser();
  const conversationId = await insertTestConversation(userId);
  const gone = await insertTestMessage(userId, conversationId, { clientId: "m-1", seq: 1 });
  const kept = await insertTestMessage(userId, conversationId, { clientId: "m-2", seq: 2 });
  await insertTestEvent(userId, conversationId, gone, { seq: 1 });
  await insertTestEvent(userId, conversationId, gone, {
    seq: 2,
    kind: CONVERSATION_EVENT_KIND.SPEECH_CLAIMED,
  });
  await insertTestEvent(userId, conversationId, kept, { seq: 3 });

  await database.run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`delete from messages where id = ${gone}`;
    }),
  );

  assert.equal(await countRowsWhere(database.run, "events", "message_id", gone), 0);
  assert.equal(await countRowsWhere(database.run, "events", "message_id", kept), 1);
});

test("an event keeps its kind, device, and payload as written", async () => {
  const userId = await database.createUser();
  const conversationId = await insertTestConversation(userId);
  const messageId = await insertTestMessage(userId, conversationId);
  const id = await insertTestEvent(userId, conversationId, messageId, {
    kind: CONVERSATION_EVENT_KIND.SPEECH_EXPIRED,
    deviceId: "mac-1",
    payload: { reason: "due" },
  });

  const events = await readEventsByMessage(database.run, messageId);
  const row = events.find((event) => event.id === id);
  assert.ok(row);
  assert.equal(row.kind, CONVERSATION_EVENT_KIND.SPEECH_EXPIRED);
  assert.equal(row.device_id, "mac-1");
  assert.deepEqual(row.payload, { reason: "due" });
  assert.equal(Number(row.seq), 1);
  assert.ok(instantColumn(row.created_at) instanceof Date);
});

test("an observed session keeps one cursor per account, advanced in place", async () => {
  const userId = await database.createUser();
  const other = await database.createUser();
  const session = { providerId: "conductor", providerSessionId: "session-1" } as const;
  await insertProviderCursor(database.run, { userId, ...session, cursor: "after-1" });

  await assertRefusedWithCode(
    insertProviderCursor(database.run, { userId, ...session, cursor: "after-2" }),
    POSTGRES_ERROR.UNIQUE_VIOLATION,
  );
  await upsertProviderCursor(database.run, { userId, ...session, cursor: "after-2" });
  await insertProviderCursor(database.run, { userId: other, ...session, cursor: "after-9" });
  await insertProviderCursor(database.run, {
    userId,
    ...session,
    providerSessionId: "session-2",
    cursor: "after-3",
  });

  const rows = await readProviderCursorsByUser(database.run, userId);
  assert.deepEqual(
    rows.map((row) => ({ providerSessionId: row.provider_session_id, cursor: row.cursor })),
    [
      { providerSessionId: "session-1", cursor: "after-2" },
      { providerSessionId: "session-2", cursor: "after-3" },
    ],
  );
});
