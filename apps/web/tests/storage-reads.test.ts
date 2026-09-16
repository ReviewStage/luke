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
import { turns } from "../server/db/storage-schema";
import { CONVERSATION_KIND } from "../server/db/storage-vocabulary";
import type { StoredMessageRecord } from "../server/hosted/store";
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
  instantColumn,
  type MessageRow as MessageInsertRow,
  POSTGRES_ERROR,
  readConversationById,
  readEventsByConversation,
  readMessagesByConversation,
  readStandingConversations,
  readTurnsByConversation,
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
 * The v2 reads and the Clear, against the real migrations: a device's cursor
 * reads answer the rows in sequence and skip a conversation the Clear
 * stamped from the very next call, the purge takes the stamped rows once the
 * window has passed and nothing sooner, a row naming a tool the catalog has
 * retired reads back without that part, and a row this build cannot read
 * back — parts that are not a message's — refuses the page rather than
 * riding out in it.
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

function readRecords(
  read: Effect.Success<ReturnType<typeof database.store.messages.list>>,
): readonly StoredMessageRecord[] {
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

test("messages read back in sequence after the cursor, typed by role, with the row's columns beside them", async () => {
  const userId = await database.createUser();
  const { main, turn, ids } = await populateMain(userId);
  await insertMessage(userId, main, 4, {
    role: MESSAGE_ROLE.SYSTEM,
    metadata: null,
    parts: [{ type: "text", text: "standing instructions" }],
    finishedAt: NOW,
  });

  const all = readRecords(await database.run(database.store.messages.list(userId, main, TOOLS)));
  assert.deepEqual(
    all.map((record) => record.seq),
    [1, 2, 3, 4],
  );
  assert.deepEqual(
    all.slice(0, 3).map((record) => record.id),
    ids,
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

  const afterTwo = readRecords(
    await database.run(database.store.messages.list(userId, main, TOOLS, { after: 2 })),
  );
  assert.deepEqual(
    afterTwo.map((record) => record.seq),
    [3, 4],
  );
  const page = readRecords(
    await database.run(database.store.messages.list(userId, main, TOOLS, { limit: 2 })),
  );
  assert.deepEqual(
    page.map((record) => record.seq),
    [1, 2],
  );
  const clamped = readRecords(
    await database.run(database.store.messages.list(userId, main, TOOLS, { limit: 0 })),
  );
  assert.deepEqual(
    clamped.map((record) => record.seq),
    [1],
  );
});

/**
 * The window a read may be cut to, asked without a revision cursor: the one
 * pairing of the message read's two optional halves the route reaches only on
 * an observed conversation's first page, and the one a page of its own covers
 * here so neither half stands untested beside the other.
 */
test("a messages read cut to a window answers the rows written at or after it, in sequence", async () => {
  const userId = await database.createUser();
  const main = await insertConversation(userId);
  const before = new Date("2026-09-01T00:00:00.000Z");
  const within = new Date("2026-09-20T00:00:00.000Z");
  await insertMessage(userId, main, 1, { createdAt: before });
  await insertMessage(userId, main, 2, { createdAt: within });
  await insertMessage(userId, main, 3, { createdAt: within });

  const windowed = readRecords(
    await database.run(database.store.messages.list(userId, main, TOOLS, { since: within })),
  );
  assert.deepEqual(
    windowed.map((record) => record.seq),
    [2, 3],
  );
});

test("events read back in sequence after the cursor, and turns in the order they last changed", async () => {
  const userId = await database.createUser();
  const { main, turn, ids } = await populateMain(userId);

  const all = await database.run(database.store.events.list(userId, main));
  assert.deepEqual(
    all.map((event) => [event.seq, event.messageId]),
    [
      [1, ids[0]],
      [2, ids[1]],
      [3, ids[2]],
    ],
  );
  assert.deepEqual(
    (await database.run(database.store.events.list(userId, main, { after: 1 }))).map(
      (event) => event.seq,
    ),
    [2, 3],
  );

  // A queued row is the opener's inbox and not the record, so the read's order is exercised over started rows.
  const laterTurn = await insertTurn(userId, main, {
    status: TURN_STATUS.RUNNING,
    queuedAt: new Date(NOW.getTime() + 1000),
    startedAt: new Date(NOW.getTime() + 1000),
  });
  const first = await database.run(database.store.turns.list(userId));
  assert.deepEqual(
    first.map((row) => row.id),
    [turn, laterTurn],
  );
  const [earlier, later] = first;
  assert.ok(earlier && later);
  assert.deepEqual(
    (await database.run(database.store.turns.list(userId, { after: earlier.cursor }))).map(
      (row) => row.id,
    ),
    [laterTurn],
  );

  const settledAt = new Date(NOW.getTime() + 5000);
  await database.run(
    Effect.asVoid(
      db.update(turns).set({ status: TURN_STATUS.SETTLED, settledAt }).where(eq(turns.id, turn)),
    ),
  );
  const changed = await database.run(database.store.turns.list(userId, { after: later.cursor }));
  assert.deepEqual(
    changed.map((row) => [row.id, row.status, row.settledAt]),
    [[turn, TURN_STATUS.SETTLED, settledAt]],
  );
  assert.equal(changed[0]?.cursor.id, turn);
  assert.notEqual(changed[0]?.cursor.changedAt, earlier.cursor.changedAt);
});

test("the turn cursor is exact to the microsecond: a stamp in the same millisecond is answered again, and a tie at a page's edge is answered on the next page", async () => {
  const userId = await database.createUser();
  const main = await insertConversation(userId);
  // A sub-millisecond instant, so the cursor's own precision (finer than a JS `Date`) is what the test compares.
  const [precise] = await database.run(insertPreciseTurn(userId, main));
  const preciseId = precise?.id;
  assert.ok(preciseId);
  const [answered] = await database.run(database.store.turns.list(userId));
  assert.equal(answered?.id, preciseId);
  assert.equal(answered?.cursor.changedAt, "2026-09-10 12:00:00.0005+00");
  assert.deepEqual(
    await database.run(database.store.turns.list(userId, { after: answered.cursor })),
    [],
  );

  await database.run(
    Effect.asVoid(
      db
        .update(turns)
        .set({ status: TURN_STATUS.SETTLED, settledAt: SETTLED_AT_MICROSECONDS })
        .where(eq(turns.id, preciseId)),
    ),
  );
  const started = await database.run(database.store.turns.list(userId, { after: answered.cursor }));
  assert.deepEqual(
    started.map((row) => [row.id, row.status]),
    [[preciseId, TURN_STATUS.SETTLED]],
  );

  const tied = new Date(NOW.getTime() + 60_000);
  const ids = await Promise.all([1, 2, 3].map(() => insertTurn(userId, main, { queuedAt: tied })));
  const pageOne = await database.run(
    database.store.turns.list(userId, { after: started[0]?.cursor, limit: 2 }),
  );
  const pageTwo = await database.run(
    database.store.turns.list(userId, {
      after: pageOne.at(-1)?.cursor,
      limit: 2,
    }),
  );
  assert.deepEqual(
    [...pageOne, ...pageTwo].map((row) => row.id),
    [...ids].sort(),
  );
});

test("one account's rows are never read under another's id", async () => {
  const userId = await database.createUser();
  const other = await database.createUser();
  const { main } = await populateMain(userId);
  await populateMain(other);

  assert.deepEqual(
    readRecords(await database.run(database.store.messages.list(other, main, TOOLS))),
    [],
  );
  assert.deepEqual(await database.run(database.store.events.list(other, main)), []);
  assert.equal((await database.run(database.store.turns.list(other))).length, 1);
});

test("a cleared conversation disappears from every read on the next call, and a new main stands in its place", async () => {
  const userId = await database.createUser();
  const { main, turn } = await populateMain(userId);
  const child = await insertConversation(userId, {
    kind: CONVERSATION_KIND.CHILD,
    parentConversationId: main,
  });
  const grandchild = await insertConversation(userId, {
    kind: CONVERSATION_KIND.CHILD,
    parentConversationId: child,
  });
  await insertMessage(userId, child, 1, { turnId: await insertTurn(userId, child) });
  const observed = await insertConversation(userId, {
    kind: CONVERSATION_KIND.OBSERVED,
    providerId: "conductor",
    providerSessionId: "6c1f2f14-9a0b-4c2d-8e3f-0a1b2c3d4e50",
  });
  await insertMessage(userId, observed, 1, { turnId: await insertTurn(userId, observed) });

  const outcome = await database.run(database.store.main.clear(userId, NOW));
  assert.deepEqual([...outcome.cleared].sort(), [main, child, grandchild].sort());
  assert.notEqual(outcome.opened, main);

  assert.deepEqual(
    readRecords(await database.run(database.store.messages.list(userId, main, TOOLS))),
    [],
  );
  assert.deepEqual(
    readRecords(await database.run(database.store.messages.list(userId, child, TOOLS))),
    [],
  );
  assert.deepEqual(await database.run(database.store.events.list(userId, main)), []);
  const remaining = await database.run(database.store.turns.list(userId));
  assert.equal(
    remaining.some((row) => row.id === turn),
    false,
  );
  assert.deepEqual(
    remaining.map((row) => row.conversationId),
    [observed],
  );
  assert.equal(
    (await database.run(database.store.messages.list(userId, observed, TOOLS))).ok,
    true,
  );

  const [opened] = await readConversationById(database.run, outcome.opened);
  assert.equal(opened?.kind, CONVERSATION_KIND.MAIN);
  assert.equal(opened?.deletedAt, null);
  assert.deepEqual(instantColumn(opened?.createdAt), NOW);
  const [stamped] = await readConversationById(database.run, main);
  assert.deepEqual(instantColumn(stamped?.deletedAt), NOW);
  assert.equal(await countConversations(main), 1);
  assert.equal((await readMessagesByConversation(database.run, main)).length, 3);
});

test("one main stands per account: two Clears leave exactly one, and a second standing main is refused", async () => {
  const userId = await database.createUser();
  await populateMain(userId);
  const first = await database.run(database.store.main.clear(userId, NOW));
  const second = await database.run(database.store.main.clear(userId, new Date(NOW.getTime() + 1)));
  assert.deepEqual(second.cleared, [first.opened]);
  const standing = await readStandingConversations(database.run, userId, CONVERSATION_KIND.MAIN);
  assert.deepEqual(
    standing.map((row) => row.id),
    [second.opened],
  );
  await assertRefusedWithCode(insertConversation(userId), POSTGRES_ERROR.UNIQUE_VIOLATION);
});

test("a Clear on an account with no main opens one and stamps nothing", async () => {
  const userId = await database.createUser();
  const outcome = await database.run(database.store.main.clear(userId, NOW));
  assert.deepEqual(outcome.cleared, []);
  assert.equal(await countConversations(outcome.opened), 1);
});

test("the purge takes a cleared conversation and everything under it once the window has passed, and nothing sooner", async () => {
  // The purge runs across every account, so this test's stamps stand in a year of their own, clear of the other tests' Clears.
  const base = new Date("2020-01-01T00:00:00.000Z");
  const userId = await database.createUser();
  const other = await database.createUser();
  const { main } = await populateMain(userId);
  const child = await insertConversation(userId, {
    kind: CONVERSATION_KIND.CHILD,
    parentConversationId: main,
  });
  const cleared = await database.run(database.store.main.clear(userId, base));
  const { main: recent } = await populateMain(other);
  const { opened: standing } = await database.run(
    database.store.main.clear(other, new Date(base.getTime() + DAY_MS)),
  );

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
  assert.equal(await countConversations(cleared.opened), 1);
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

test("deleting the account takes cleared and standing conversations alike", async () => {
  const userId = await database.createUser();
  const { main } = await populateMain(userId);
  const { opened } = await database.run(database.store.main.clear(userId, NOW));
  await deleteUser(database.run, userId);
  assert.equal(await countConversations(main), 0);
  assert.equal(await countConversations(opened), 0);
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
  await insertMessage(userId, main, 4, {
    role: MESSAGE_ROLE.ASSISTANT,
    metadata: { author: MESSAGE_AUTHOR.BRAIN },
    parts: [{ type: "step-start" }, retired, said],
  });
  await insertMessage(userId, main, 5);

  const records = readRecords(
    await database.run(database.store.messages.list(userId, main, TOOLS)),
  );
  assert.deepEqual(
    records.map((record) => record.seq),
    [1, 2, 3, 4, 5],
  );
  assert.deepEqual(records[3]?.message.parts, [{ type: "step-start" }, said]);
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
  const read = await database.run(database.store.messages.list(userId, main, TOOLS, { after: 3 }));
  assert.equal(read.ok, false);
  if (read.ok) return;
  assert.equal(read.refusal, SCHEMA_REFUSAL.MALFORMED);
  assert.equal(read.seq, 4);
  assert.deepEqual(read.path, []);
});

test("the turn cursor's instant reads as one string whatever time zone the database session keeps", async () => {
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
    const [answered] = await database.run(database.store.turns.list(userId));
    assert.equal(answered?.id, preciseId);
    assert.equal(answered?.cursor.changedAt, "2026-09-10 12:00:00.0005+00");
    assert.deepEqual(
      await database.run(database.store.turns.list(userId, { after: answered.cursor })),
      [],
    );
  } finally {
    await sessionZone("UTC");
  }
});
