import assert from "node:assert/strict";
import {
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
import { listRecentMessages, type StoredMessageRecord } from "../server/hosted/store";
import type { MessageListRead } from "../server/hosted/store/message-reads";
import { CLEARED_CONVERSATION_RETENTION_MS } from "../server/hosted/store/soft-delete";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import {
  deleteUser,
  insertConversation as insertConversationRow,
  insertMessage as insertMessageRow,
  insertTurn as insertTurnRow,
  type MessageRow as MessageInsertRow,
  readConversationById,
  readMessagesByConversation,
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

async function insertConversation(userId: string): Promise<string> {
  return insertConversationRow(database.run, { userId });
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

async function countConversations(id: string): Promise<number> {
  return (await readConversationById(database.run, id)).length;
}

function readRecords(read: MessageListRead): readonly StoredMessageRecord[] {
  assert.equal(read.ok, true);
  return read.ok ? read.value : [];
}

/** A plan's conversation with three messages and the turn that wrote them. */
async function populatePlan(
  userId: string,
): Promise<{ plan: string; turn: string; ids: string[] }> {
  const plan = await insertConversation(userId);
  const turn = await insertTurn(userId, plan);
  const ids: string[] = [];
  for (const seq of [1, 2, 3]) {
    ids.push(await insertMessage(userId, plan, seq, { turnId: turn }));
  }
  return { plan, turn, ids };
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
  const { plan, turn, ids } = await populatePlan(userId);
  const system = await insertMessage(userId, plan, 4, {
    role: MESSAGE_ROLE.SYSTEM,
    metadata: null,
    parts: [{ type: "text", text: "standing instructions" }],
    finishedAt: NOW,
  });
  const byClientId = async (clientId: string) =>
    readRecords(
      await database.run(database.store.messages.byClientId(userId, plan, TOOLS, clientId)),
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
  const plan = await insertConversation(userId);
  const said = async (seq: number, role: MessageInsertRow["role"], finished: boolean) =>
    insertMessage(userId, plan, seq, {
      role,
      metadata: role === MESSAGE_ROLE.ASSISTANT ? { author: MESSAGE_AUTHOR.BRAIN } : TYPED_ASK,
      finishedAt: finished ? NOW : null,
    });
  await said(1, MESSAGE_ROLE.USER, true);
  const second = await said(2, MESSAGE_ROLE.ASSISTANT, true);
  await insertMessage(userId, plan, 3, {
    role: MESSAGE_ROLE.SYSTEM,
    metadata: null,
    finishedAt: NOW,
  });
  const fourth = await said(4, MESSAGE_ROLE.USER, true);
  await said(5, MESSAGE_ROLE.ASSISTANT, false);

  assert.deepEqual(
    readRecords(await database.run(listRecentMessages(userId, plan, TOOLS, 2))).map(
      (record) => record.id,
    ),
    [second, fourth],
  );
});

test("turns the ids name read back in the order they last changed, and no turn left unnamed", async () => {
  const userId = await database.createUser();
  const { plan, turn } = await populatePlan(userId);

  // A queued row is the opener's inbox and not the record, so the read's order is exercised over started rows.
  const laterTurn = await insertTurn(userId, plan, {
    status: TURN_STATUS.RUNNING,
    queuedAt: new Date(NOW.getTime() + 1000),
    startedAt: new Date(NOW.getTime() + 1000),
  });
  const unnamed = await insertTurn(userId, plan);
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
  const plan = await insertConversation(userId);
  const [earlier] = await database.run(insertPreciseTurn(userId, plan, EARLIER_MICROSECONDS));
  const [later] = await database.run(insertPreciseTurn(userId, plan, LATER_MICROSECONDS));
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
  const rows = await populatePlan(userId);
  await populatePlan(other);

  assert.deepEqual(await everyRead(other, rows.plan, rows), {
    byClientId: [],
    recent: [],
    turns: [],
  });
});

test("a conversation stamped deleted disappears from every read on the next call, and another standing beside it does not", async () => {
  const userId = await database.createUser();
  const rows = await populatePlan(userId);
  await database.run(
    Effect.asVoid(
      db
        .update(messagesTable)
        .set({ finishedAt: NOW })
        .where(eq(messagesTable.conversationId, rows.plan)),
    ),
  );
  const neighbour = await insertConversation(userId);
  const neighbourTurn = await insertTurn(userId, neighbour);
  const neighbourRow = await insertMessage(userId, neighbour, 1, {
    turnId: neighbourTurn,
    finishedAt: NOW,
  });

  assert.deepEqual(await everyRead(userId, rows.plan, rows), {
    byClientId: [rows.ids[0]],
    recent: rows.ids,
    turns: [rows.turn],
  });

  await setConversationDeletedAt(database.run, rows.plan, NOW);
  assert.deepEqual(await everyRead(userId, rows.plan, rows), {
    byClientId: [],
    recent: [],
    turns: [],
  });
  assert.deepEqual(await everyRead(userId, neighbour, { turn: neighbourTurn }), {
    byClientId: [neighbourRow],
    recent: [neighbourRow],
    turns: [neighbourTurn],
  });

  // The stamp hides the rows and erases none of them.
  assert.equal(await countConversations(rows.plan), 1);
  assert.equal((await readMessagesByConversation(database.run, rows.plan)).length, 3);
});

test("the purge takes a stamped conversation and everything under it once the window has passed, and nothing sooner", async () => {
  // The purge runs across every account, so this test's stamps stand in a year of their own, clear of the other tests' stamps.
  const base = new Date("2020-01-01T00:00:00.000Z");
  const userId = await database.createUser();
  const other = await database.createUser();
  const { plan } = await populatePlan(userId);
  const alongside = await insertConversation(userId);
  await setConversationDeletedAt(database.run, plan, base);
  await setConversationDeletedAt(database.run, alongside, base);
  const kept = await insertConversation(userId);
  const { plan: recent } = await populatePlan(other);
  await setConversationDeletedAt(database.run, recent, new Date(base.getTime() + DAY_MS));
  const standing = await insertConversation(other);

  const beforeWindow = new Date(base.getTime() + CLEARED_CONVERSATION_RETENTION_MS - 1);
  assert.equal(await database.run(database.store.retention.purgeCleared(beforeWindow)), 0);
  assert.equal(await countConversations(plan), 1);

  const atWindow = new Date(base.getTime() + CLEARED_CONVERSATION_RETENTION_MS);
  assert.equal(await database.run(database.store.retention.purgeCleared(atWindow)), 2);
  assert.equal(await countConversations(plan), 0);
  assert.equal(await countConversations(alongside), 0);
  assert.equal((await readMessagesByConversation(database.run, plan)).length, 0);
  assert.equal((await readTurnsByConversation(database.run, plan)).length, 0);
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
  const { plan } = await populatePlan(userId);
  await setConversationDeletedAt(database.run, plan, NOW);
  const standing = await insertConversation(userId);
  await deleteUser(database.run, userId);
  assert.equal(await countConversations(plan), 0);
  assert.equal(await countConversations(standing), 0);
});

test("a row naming a tool the catalog has retired reads back without that part, and the page goes on past it", async () => {
  const userId = await database.createUser();
  const { plan } = await populatePlan(userId);
  const retired = {
    type: "tool-nobody_registered",
    toolCallId: "call_4a0000000000000001",
    state: "output-available",
    input: {},
    output: {},
  };
  const said = { type: "text", text: "It is done.", state: "done" };
  const answer = await insertMessage(userId, plan, 4, {
    role: MESSAGE_ROLE.ASSISTANT,
    metadata: { author: MESSAGE_AUTHOR.BRAIN },
    parts: [{ type: "step-start" }, retired, said],
    finishedAt: NOW,
  });
  const after = await insertMessage(userId, plan, 5, { finishedAt: NOW });

  // The recent read takes the finished rows alone, which here are the answer and the ask after it.
  const records = readRecords(await database.run(listRecentMessages(userId, plan, TOOLS, 10)));
  assert.deepEqual(
    records.map((record) => record.id),
    [answer, after],
  );
  assert.deepEqual(records[0]?.message.parts, [{ type: "step-start" }, said]);
});

test("a row whose parts are not a message's refuses the page as malformed", async () => {
  const userId = await database.createUser();
  const { plan } = await populatePlan(userId);
  await insertMessageRow(database.run, {
    userId,
    conversationId: plan,
    seq: 4,
    clientId: "client-4",
    role: MESSAGE_ROLE.USER,
    // The row a corrupt write would leave: a part with no other field a message's part carries.
    parts: [{ type: "text" }],
    metadata: TYPED_ASK,
  });
  const read = await database.run(
    database.store.messages.byClientId(userId, plan, TOOLS, "client-4"),
  );
  assert.equal(read.ok, false);
  if (read.ok) return;
  assert.equal(read.refusal, SCHEMA_REFUSAL.MALFORMED);
  assert.equal(read.seq, 4);
  assert.deepEqual(read.path, []);
});
