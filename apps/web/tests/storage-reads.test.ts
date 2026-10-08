import assert from "node:assert/strict";
import {
  CONVERSATION_EVENT_KIND,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  SCHEMA_REFUSAL,
  TURN_ORIGIN,
  TURN_STATUS,
} from "@sidecar/wire";
import { type ToolSet, tool } from "ai";
import { eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import { afterAll, test } from "vitest";
import { z } from "zod";
import { db } from "../server/db/query";
import { messages as messagesTable, turns } from "../server/db/storage-schema";
import { CONVERSATION_KIND } from "../server/db/storage-vocabulary";
import { listRecentMessages, type StoredMessageRecord } from "../server/hosted/store";
import type { MessageListRead } from "../server/hosted/store/message-reads";
import { CLEARED_CONVERSATION_RETENTION_MS } from "../server/hosted/store/soft-delete";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import {
  assertRefusedWithCode,
  type ConversationRow,
  deleteUser,
  insertConversation as insertConversationRow,
  insertEvent as insertEventRow,
  insertMessage as insertMessageRow,
  insertTurn as insertTurnRow,
  type MessageRow as MessageInsertRow,
  POSTGRES_ERROR,
  readConversationById,
  readEventsByConversation,
  readMessagesByConversation,
  readStandingConversations,
  readTurnsByConversation,
  setConversationDeletedAt,
  type TurnInsertRow,
} from "./support/store-rows";

/**
 * Instants a millisecond apart cannot tell, which a JS `Date` cannot carry
 * and so the builder has no value for: literals Postgres reads at the
 * column's own precision, bound inside one Drizzle-rendered statement. They
 * are what makes the read's order finer than a `Date` the thing the test
 * below compares.
 */
const EARLIER_MICROSECONDS = sql`'2026-09-10 12:00:00.000500+00'::timestamptz`;
const LATER_MICROSECONDS = sql`'2026-09-10 12:00:00.000700+00'::timestamptz`;
const SETTLED_MICROSECONDS = sql`'2026-09-10 12:00:00.000900+00'::timestamptz`;

/** A running turn started at a literal instant, answering the id it was minted under. */
const insertPreciseTurn = (
  userId: string,
  conversationId: string,
  at: typeof EARLIER_MICROSECONDS,
) =>
  db
    .insert(turns)
    .values({
      userId,
      conversationId,
      origin: TURN_ORIGIN.TYPED,
      status: TURN_STATUS.RUNNING,
      queuedAt: at,
      startedAt: at,
    })
    .returning({ id: turns.id });

/**
 * The conversation reads the brain and the voice make, against the real
 * migrations: each answers the rows it names typed by role and skips a
 * conversation stamped `deleted_at` from the very next call, the purge takes
 * the stamped rows once the window has passed and nothing sooner, a row
 * naming a tool the catalog has retired reads back without that part, and a
 * row this build cannot read back — parts that are not a message's —
 * refuses the page rather than riding out in it.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const NOW = new Date("2026-09-10T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

const TOOLS: ToolSet = {
  read_transcript: tool({
    description: "Reads the tail of an observed session's transcript.",
    inputSchema: z.object({ provider_id: z.string(), provider_session_id: z.string() }),
    outputSchema: z.object({ lines: z.array(z.string()) }),
  }),
};

const TYPED_ASK = { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.TYPED } as const;

interface ConversationOverrides {
  readonly kind?: NonNullable<ConversationRow["kind"]>;
  readonly providerId?: string | null;
  readonly providerSessionId?: string | null;
  readonly parentConversationId?: string | null;
}

async function insertConversation(
  userId: string,
  row: ConversationOverrides = {},
): Promise<string> {
  return insertConversationRow(database.run, { userId, ...row });
}

interface TurnOverrides {
  readonly status?: TurnInsertRow["status"];
  readonly queuedAt?: Date;
  readonly startedAt?: Date | null;
}

async function insertTurn(
  userId: string,
  conversationId: string,
  row: TurnOverrides = {},
): Promise<string> {
  return insertTurnRow(database.run, {
    userId,
    conversationId,
    origin: TURN_ORIGIN.TYPED,
    status: TURN_STATUS.SETTLED,
    queuedAt: NOW,
    ...row,
  });
}

async function insertMessage(
  userId: string,
  conversationId: string,
  seq: number,
  row: Partial<Omit<MessageInsertRow, "userId" | "conversationId" | "seq">> = {},
): Promise<string> {
  return insertMessageRow(database.run, {
    userId,
    conversationId,
    seq,
    clientId: `client-${seq}`,
    role: MESSAGE_ROLE.USER,
    parts: [{ type: "text", text: `ask ${seq}` }],
    metadata: TYPED_ASK,
    ...row,
  });
}

async function insertEvent(
  userId: string,
  conversationId: string,
  messageId: string,
  seq: number,
): Promise<string> {
  return insertEventRow(database.run, {
    userId,
    conversationId,
    messageId,
    seq,
    kind: CONVERSATION_EVENT_KIND.SPEECH_OFFERED,
  });
}

async function countConversations(id: string): Promise<number> {
  return (await readConversationById(database.run, id)).length;
}

function readRecords(read: MessageListRead): readonly StoredMessageRecord[] {
  assert.equal(read.ok, true);
  return read.ok ? read.value : [];
}

/** A main conversation with three messages, an event on each, and the turn that wrote them. */
async function populateMain(
  userId: string,
): Promise<{ main: string; turn: string; ids: string[] }> {
  const main = await insertConversation(userId);
  const turn = await insertTurn(userId, main);
  const ids: string[] = [];
  for (const seq of [1, 2, 3]) {
    const id = await insertMessage(userId, main, seq, { turnId: turn });
    await insertEvent(userId, main, id, seq);
    ids.push(id);
  }
  return { main, turn, ids };
}

/** Every read this module answers, of one account's rows in one conversation, each as the ids it answered. */
async function everyRead(userId: string, conversationId: string, rows: { readonly turn: string }) {
  const { messages, turns } = database.store;
  const recordIds = (read: MessageListRead) => readRecords(read).map((record) => record.id);
  return {
    byClientId: recordIds(
      await database.run(messages.byClientId(userId, conversationId, TOOLS, "client-1")),
    ),
    recent: recordIds(await database.run(listRecentMessages(userId, conversationId, TOOLS, 10))),
    turns: (await database.run(turns.named(userId, [rows.turn]))).map((turn) => turn.id),
  };
}

test("a message its client id names reads back typed by role, with the row's columns beside it, and a client id naming nothing answers an empty page", async () => {
  const userId = await database.createUser();
  const { main, turn, ids } = await populateMain(userId);
  const system = await insertMessage(userId, main, 4, {
    role: MESSAGE_ROLE.SYSTEM,
    metadata: null,
    parts: [{ type: "text", text: "standing instructions" }],
    finishedAt: NOW,
  });
  const byClientId = async (clientId: string) =>
    readRecords(
      await database.run(database.store.messages.byClientId(userId, main, TOOLS, clientId)),
    );

  const [ask] = await byClientId("client-2");
  assert.equal(ask?.id, ids[1]);
  assert.equal(ask?.seq, 2);
  assert.equal(ask?.turnId, turn);
  assert.equal(ask?.finishedAt, undefined);
  assert.equal(
    ask?.message.role === MESSAGE_ROLE.USER && ask.message.metadata.author,
    MESSAGE_AUTHOR.DEVELOPER,
  );
  const [instructions] = await byClientId("client-4");
  assert.equal(instructions?.id, system);
  assert.equal(instructions?.message.role, MESSAGE_ROLE.SYSTEM);
  assert.deepEqual(instructions?.finishedAt, NOW);
  assert.deepEqual(await byClientId("client-9"), []);
});

test("the recent read answers the newest finished messages of the two speaking roles, oldest first and bounded", async () => {
  const userId = await database.createUser();
  const main = await insertConversation(userId);
  const said = async (seq: number, role: MessageInsertRow["role"], finished: boolean) =>
    insertMessage(userId, main, seq, {
      role,
      metadata: role === MESSAGE_ROLE.ASSISTANT ? { author: MESSAGE_AUTHOR.BRAIN } : TYPED_ASK,
      finishedAt: finished ? NOW : null,
    });
  await said(1, MESSAGE_ROLE.USER, true);
  const second = await said(2, MESSAGE_ROLE.ASSISTANT, true);
  await insertMessage(userId, main, 3, {
    role: MESSAGE_ROLE.SYSTEM,
    metadata: null,
    finishedAt: NOW,
  });
  const fourth = await said(4, MESSAGE_ROLE.USER, true);
  await said(5, MESSAGE_ROLE.ASSISTANT, false);

  assert.deepEqual(
    readRecords(await database.run(listRecentMessages(userId, main, TOOLS, 2))).map(
      (record) => record.id,
    ),
    [second, fourth],
  );
});

test("turns the ids name read back in the order they last changed, and no turn left unnamed", async () => {
  const userId = await database.createUser();
  const { main, turn } = await populateMain(userId);

  // A queued row is the opener's inbox and not the record, so the read's order is exercised over started rows.
  const laterTurn = await insertTurn(userId, main, {
    status: TURN_STATUS.RUNNING,
    queuedAt: new Date(NOW.getTime() + 1000),
    startedAt: new Date(NOW.getTime() + 1000),
  });
  const unnamed = await insertTurn(userId, main);
  const named = () => database.run(database.store.turns.named(userId, [laterTurn, turn]));
  assert.deepEqual(
    (await named()).map((row) => row.id),
    [turn, laterTurn],
  );
  assert.deepEqual(await database.run(database.store.turns.named(userId, [])), []);

  const settledAt = new Date(NOW.getTime() + 5000);
  await database.run(
    Effect.asVoid(
      db.update(turns).set({ status: TURN_STATUS.SETTLED, settledAt }).where(eq(turns.id, turn)),
    ),
  );
  const changed = await named();
  assert.deepEqual(
    changed.map((row) => [row.id, row.status, row.settledAt]),
    [
      [laterTurn, TURN_STATUS.RUNNING, null],
      [turn, TURN_STATUS.SETTLED, settledAt],
    ],
  );
  assert.equal(
    changed.some((row) => row.id === unnamed),
    false,
  );
});

test("turns that changed within one millisecond read back in the order they changed, to the microsecond", async () => {
  const userId = await database.createUser();
  const main = await insertConversation(userId);
  const [earlier] = await database.run(insertPreciseTurn(userId, main, EARLIER_MICROSECONDS));
  const [later] = await database.run(insertPreciseTurn(userId, main, LATER_MICROSECONDS));
  assert.ok(earlier && later);
  const named = async () =>
    (await database.run(database.store.turns.named(userId, [later.id, earlier.id]))).map(
      (row) => row.id,
    );
  assert.deepEqual(await named(), [earlier.id, later.id]);

  // Settled two tenths of a millisecond after the other started, the earlier turn now changed last.
  await database.run(
    Effect.asVoid(
      db
        .update(turns)
        .set({ status: TURN_STATUS.SETTLED, settledAt: SETTLED_MICROSECONDS })
        .where(eq(turns.id, earlier.id)),
    ),
  );
  assert.deepEqual(await named(), [later.id, earlier.id]);
});

test("one account's rows are never read under another's id", async () => {
  const userId = await database.createUser();
  const other = await database.createUser();
  const rows = await populateMain(userId);
  await populateMain(other);

  assert.deepEqual(await everyRead(other, rows.main, rows), {
    byClientId: [],
    recent: [],
    turns: [],
  });
});

test("a conversation stamped deleted disappears from every read on the next call, and another standing beside it does not", async () => {
  const userId = await database.createUser();
  const rows = await populateMain(userId);
  await database.run(
    Effect.asVoid(
      db
        .update(messagesTable)
        .set({ finishedAt: NOW })
        .where(eq(messagesTable.conversationId, rows.main)),
    ),
  );
  const observed = await insertConversation(userId, {
    kind: CONVERSATION_KIND.OBSERVED,
    providerId: "conductor",
    providerSessionId: "6c1f2f14-9a0b-4c2d-8e3f-0a1b2c3d4e50",
  });
  const observedTurn = await insertTurn(userId, observed);
  const observedRow = await insertMessage(userId, observed, 1, {
    turnId: observedTurn,
    finishedAt: NOW,
  });

  assert.deepEqual(await everyRead(userId, rows.main, rows), {
    byClientId: [rows.ids[0]],
    recent: rows.ids,
    turns: [rows.turn],
  });

  await setConversationDeletedAt(database.run, rows.main, NOW);
  assert.deepEqual(await everyRead(userId, rows.main, rows), {
    byClientId: [],
    recent: [],
    turns: [],
  });
  assert.deepEqual(await everyRead(userId, observed, { turn: observedTurn }), {
    byClientId: [observedRow],
    recent: [observedRow],
    turns: [observedTurn],
  });

  // The stamp hides the rows and erases none of them.
  assert.equal(await countConversations(rows.main), 1);
  assert.equal((await readMessagesByConversation(database.run, rows.main)).length, 3);
});

test("one main stands per account: a second standing main is refused, and a stamped one leaves room for another", async () => {
  const userId = await database.createUser();
  const { main } = await populateMain(userId);
  await assertRefusedWithCode(insertConversation(userId), POSTGRES_ERROR.UNIQUE_VIOLATION);
  await setConversationDeletedAt(database.run, main, NOW);
  const next = await insertConversation(userId);
  const standing = await readStandingConversations(database.run, userId, CONVERSATION_KIND.MAIN);
  assert.deepEqual(
    standing.map((row) => row.id),
    [next],
  );
});

test("the purge takes a stamped conversation and everything under it once the window has passed, and nothing sooner", async () => {
  // The purge runs across every account, so this test's stamps stand in a year of their own, clear of the other tests' stamps.
  const base = new Date("2020-01-01T00:00:00.000Z");
  const userId = await database.createUser();
  const other = await database.createUser();
  const { main } = await populateMain(userId);
  const child = await insertConversation(userId, {
    kind: CONVERSATION_KIND.CHILD,
    parentConversationId: main,
  });
  await setConversationDeletedAt(database.run, main, base);
  await setConversationDeletedAt(database.run, child, base);
  const kept = await insertConversation(userId, { kind: CONVERSATION_KIND.OBSERVED });
  const { main: recent } = await populateMain(other);
  await setConversationDeletedAt(database.run, recent, new Date(base.getTime() + DAY_MS));
  const standing = await insertConversation(other, { kind: CONVERSATION_KIND.OBSERVED });

  const beforeWindow = new Date(base.getTime() + CLEARED_CONVERSATION_RETENTION_MS - 1);
  assert.equal(await database.run(database.store.retention.purgeCleared(beforeWindow)), 0);
  assert.equal(await countConversations(main), 1);

  const atWindow = new Date(base.getTime() + CLEARED_CONVERSATION_RETENTION_MS);
  assert.equal(await database.run(database.store.retention.purgeCleared(atWindow)), 2);
  assert.equal(await countConversations(main), 0);
  assert.equal(await countConversations(child), 0);
  assert.equal((await readMessagesByConversation(database.run, main)).length, 0);
  assert.equal((await readTurnsByConversation(database.run, main)).length, 0);
  assert.equal((await readEventsByConversation(database.run, main)).length, 0);
  assert.equal(await countConversations(kept), 1);
  assert.equal(await countConversations(recent), 1);
  assert.equal(await countConversations(standing), 1);

  assert.equal(
    await database.run(
      database.store.retention.purgeCleared(new Date(atWindow.getTime() + DAY_MS)),
    ),
    1,
  );
  assert.equal(await countConversations(recent), 0);
  assert.equal(await countConversations(standing), 1);
});

test("deleting the account takes stamped and standing conversations alike", async () => {
  const userId = await database.createUser();
  const { main } = await populateMain(userId);
  await setConversationDeletedAt(database.run, main, NOW);
  const standing = await insertConversation(userId);
  await deleteUser(database.run, userId);
  assert.equal(await countConversations(main), 0);
  assert.equal(await countConversations(standing), 0);
});

test("a row naming a tool the catalog has retired reads back without that part, and the page goes on past it", async () => {
  const userId = await database.createUser();
  const { main } = await populateMain(userId);
  const retired = {
    type: "tool-nobody_registered",
    toolCallId: "call_4a0000000000000001",
    state: "output-available",
    input: {},
    output: {},
  };
  const said = { type: "text", text: "It is done.", state: "done" };
  const answer = await insertMessage(userId, main, 4, {
    role: MESSAGE_ROLE.ASSISTANT,
    metadata: { author: MESSAGE_AUTHOR.BRAIN },
    parts: [{ type: "step-start" }, retired, said],
    finishedAt: NOW,
  });
  const after = await insertMessage(userId, main, 5, { finishedAt: NOW });

  // The recent read takes the finished rows alone, which here are the answer and the ask after it.
  const records = readRecords(await database.run(listRecentMessages(userId, main, TOOLS, 10)));
  assert.deepEqual(
    records.map((record) => record.id),
    [answer, after],
  );
  assert.deepEqual(records[0]?.message.parts, [{ type: "step-start" }, said]);
});

test("a row whose parts are not a message's refuses the page as malformed", async () => {
  const userId = await database.createUser();
  const { main } = await populateMain(userId);
  await insertMessageRow(database.run, {
    userId,
    conversationId: main,
    seq: 4,
    clientId: "client-4",
    role: MESSAGE_ROLE.USER,
    // The row a corrupt write would leave: a part with no other field a message's part carries.
    parts: [{ type: "text" }],
    metadata: TYPED_ASK,
  });
  const read = await database.run(
    database.store.messages.byClientId(userId, main, TOOLS, "client-4"),
  );
  assert.equal(read.ok, false);
  if (read.ok) return;
  assert.equal(read.refusal, SCHEMA_REFUSAL.MALFORMED);
  assert.equal(read.seq, 4);
  assert.deepEqual(read.path, []);
});
