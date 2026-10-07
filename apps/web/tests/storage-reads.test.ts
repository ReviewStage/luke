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
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { afterAll, test } from "vitest";
import { z } from "zod";
import { db } from "../server/db/query";
import { messages as messagesTable, turns } from "../server/db/storage-schema";
import { CONVERSATION_KIND } from "../server/db/storage-vocabulary";
import {
  findMessageByClientId,
  listRecentMessages,
  readMessageById,
  type StoredMessageRecord,
} from "../server/hosted/store";
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
 * A turn's instants to the microsecond, which a JS `Date` cannot carry and
 * so the builder has no value for: a literal Postgres reads at the column's
 * own precision, named here and bound inside one Drizzle-rendered statement.
 * It is what makes the cursor's own precision, finer than a `Date`, the thing
 * the tests below compare.
 */
const QUEUED_AT_MICROSECONDS = sql`'2026-09-10 12:00:00.000500+00'::timestamptz`;
const SETTLED_AT_MICROSECONDS = sql`'2026-09-10 12:00:00.000900+00'::timestamptz`;

/** A running turn standing at that instant, answering the id it was minted under. */
const insertPreciseTurn = (userId: string, conversationId: string) =>
  db
    .insert(turns)
    .values({
      userId,
      conversationId,
      origin: TURN_ORIGIN.TRANSCRIPT_CHANGE,
      status: TURN_STATUS.RUNNING,
      queuedAt: QUEUED_AT_MICROSECONDS,
      startedAt: QUEUED_AT_MICROSECONDS,
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
async function everyRead(
  userId: string,
  conversationId: string,
  rows: { readonly ids: readonly string[]; readonly turn: string },
) {
  const { messages, turns } = database.store;
  const recordIds = (read: MessageListRead) => readRecords(read).map((record) => record.id);
  return {
    byClientId: recordIds(
      await database.run(messages.byClientId(userId, conversationId, TOOLS, "client-1")),
    ),
    byIds: recordIds(await database.run(messages.byIds(userId, TOOLS, rows.ids))),
    recent: recordIds(await database.run(listRecentMessages(userId, conversationId, TOOLS, 10))),
    byId: recordIds(
      await database.run(readMessageById(userId, conversationId, TOOLS, rows.ids[0] ?? "")),
    ),
    found: (await database.run(findMessageByClientId(userId, conversationId, "client-1")))?.id,
    turns: (await database.run(turns.named(userId, [rows.turn]))).map((turn) => turn.id),
  };
}

test("messages the ids name read back in sequence, typed by role, with the row's columns beside them", async () => {
  const userId = await database.createUser();
  const { main, turn, ids } = await populateMain(userId);
  const system = await insertMessage(userId, main, 4, {
    role: MESSAGE_ROLE.SYSTEM,
    metadata: null,
    parts: [{ type: "text", text: "standing instructions" }],
    finishedAt: NOW,
  });

  const all = readRecords(
    await database.run(database.store.messages.byIds(userId, TOOLS, [system, ...ids])),
  );
  assert.deepEqual(
    all.map((record) => record.seq),
    [1, 2, 3, 4],
  );
  assert.deepEqual(
    all.map((record) => record.id),
    [...ids, system],
  );
  assert.deepEqual(
    all.map((record) => record.message.role),
    [MESSAGE_ROLE.USER, MESSAGE_ROLE.USER, MESSAGE_ROLE.USER, MESSAGE_ROLE.SYSTEM],
  );
  assert.equal(all[0]?.turnId, turn);
  assert.equal(all[0]?.finishedAt, undefined);
  assert.deepEqual(all[3]?.finishedAt, NOW);
  assert.equal(
    all[0]?.message.role === MESSAGE_ROLE.USER && all[0].message.metadata.author,
    MESSAGE_AUTHOR.DEVELOPER,
  );
  assert.deepEqual(await database.run(database.store.messages.byIds(userId, TOOLS, [])), {
    ok: true,
    value: [],
  });

  const [journal] = readRecords(
    await database.run(database.store.messages.byClientId(userId, main, TOOLS, "client-2")),
  );
  assert.deepEqual(journal?.id, ids[1]);
  assert.deepEqual(
    readRecords(
      await database.run(database.store.messages.byClientId(userId, main, TOOLS, "client-9")),
    ),
    [],
  );
  assert.deepEqual(await database.run(findMessageByClientId(userId, main, "client-3")), {
    id: ids[2],
  });
  assert.equal(await database.run(findMessageByClientId(userId, main, "client-9")), undefined);
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

test("a turn's place in the order of change is exact to the microsecond", async () => {
  const userId = await database.createUser();
  const main = await insertConversation(userId);
  // A sub-millisecond instant, so the cursor's own precision (finer than a JS `Date`) is what the test compares.
  const [precise] = await database.run(insertPreciseTurn(userId, main));
  const preciseId = precise?.id;
  assert.ok(preciseId);
  const [answered] = await database.run(database.store.turns.named(userId, [preciseId]));
  assert.equal(answered?.id, preciseId);
  assert.equal(answered?.cursor.changedAt, "2026-09-10 12:00:00.0005+00");

  await database.run(
    Effect.asVoid(
      db
        .update(turns)
        .set({ status: TURN_STATUS.SETTLED, settledAt: SETTLED_AT_MICROSECONDS })
        .where(eq(turns.id, preciseId)),
    ),
  );
  const [settled] = await database.run(database.store.turns.named(userId, [preciseId]));
  assert.deepEqual(
    [settled?.status, settled?.cursor.changedAt],
    [TURN_STATUS.SETTLED, "2026-09-10 12:00:00.0009+00"],
  );
});

test("one account's rows are never read under another's id", async () => {
  const userId = await database.createUser();
  const other = await database.createUser();
  const rows = await populateMain(userId);
  await populateMain(other);

  assert.deepEqual(await everyRead(other, rows.main, rows), {
    byClientId: [],
    byIds: [],
    recent: [],
    byId: [],
    found: undefined,
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
    byIds: rows.ids,
    recent: rows.ids,
    byId: [rows.ids[0]],
    found: rows.ids[0],
    turns: [rows.turn],
  });

  await setConversationDeletedAt(database.run, rows.main, NOW);
  assert.deepEqual(await everyRead(userId, rows.main, rows), {
    byClientId: [],
    byIds: [],
    recent: [],
    byId: [],
    found: undefined,
    turns: [],
  });
  assert.deepEqual(await everyRead(userId, observed, { ids: [observedRow], turn: observedTurn }), {
    byClientId: [observedRow],
    byIds: [observedRow],
    recent: [observedRow],
    byId: [observedRow],
    found: observedRow,
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

test("the purge takes a retired observed conversation on the same terms as any stamped one", async () => {
  // In a year of its own, as the purge above, a few months further on, clear of the other tests' stamps.
  const base = new Date("2020-06-01T00:00:00.000Z");
  const userId = await database.createUser();
  const session = { providerId: "conductor", providerSessionId: "s-purge-retired" };
  const observed = await database.run(
    database.store.directory.observed(userId, session, base.getTime()),
  );
  assert.ok(observed);
  const retired = await database.run(
    database.store.roster.retireDeparted(
      userId,
      [{ providerId: "conductor", sessionIds: [] }],
      base.getTime(),
    ),
  );
  assert.deepEqual(retired, [observed]);

  const beforeWindow = new Date(base.getTime() + CLEARED_CONVERSATION_RETENTION_MS - 1);
  assert.equal(await database.run(database.store.retention.purgeCleared(beforeWindow)), 0);
  assert.equal(await countConversations(observed), 1);
  const atWindow = new Date(base.getTime() + CLEARED_CONVERSATION_RETENTION_MS);
  assert.equal(await database.run(database.store.retention.purgeCleared(atWindow)), 1);
  assert.equal(await countConversations(observed), 0);
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
  const { main, ids } = await populateMain(userId);
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
  });
  const after = await insertMessage(userId, main, 5);

  const records = readRecords(
    await database.run(database.store.messages.byIds(userId, TOOLS, [...ids, answer, after])),
  );
  assert.deepEqual(
    records.map((record) => record.seq),
    [1, 2, 3, 4, 5],
  );
  assert.deepEqual(records[3]?.message.parts, [{ type: "step-start" }, said]);
});

test("a row whose parts are not a message's refuses the page as malformed", async () => {
  const userId = await database.createUser();
  const { main, ids } = await populateMain(userId);
  const corrupt = await insertMessageRow(database.run, {
    userId,
    conversationId: main,
    seq: 4,
    clientId: "client-4",
    role: MESSAGE_ROLE.USER,
    // The row a corrupt write would leave: a part with no other field a message's part carries.
    parts: [{ type: "text" }],
    metadata: TYPED_ASK,
  });
  const read = await database.run(database.store.messages.byIds(userId, TOOLS, [...ids, corrupt]));
  assert.equal(read.ok, false);
  if (read.ok) return;
  assert.equal(read.refusal, SCHEMA_REFUSAL.MALFORMED);
  assert.equal(read.seq, 4);
  assert.deepEqual(read.path, []);
});

test("a turn's place in the order of change reads as one string whatever time zone the database session keeps", async () => {
  const userId = await database.createUser();
  const main = await insertConversation(userId);
  const [precise] = await database.run(insertPreciseTurn(userId, main));
  const preciseId = precise?.id;
  assert.ok(preciseId);
  const sessionZone = (zone: string) =>
    database.run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql.unsafe(`set time zone '${zone}'`);
      }),
    );
  // A zone west of UTC, so a render in the session's zone would move both the
  // wall clock and the offset; the test harness holds one connection, so the
  // setting stands for every read below until it is reset.
  await sessionZone("America/Anchorage");
  try {
    const [answered] = await database.run(database.store.turns.named(userId, [preciseId]));
    assert.equal(answered?.id, preciseId);
    assert.equal(answered?.cursor.changedAt, "2026-09-10 12:00:00.0005+00");
  } finally {
    await sessionZone("UTC");
  }
});
