import assert from "node:assert/strict";
import type { MessageListRead } from "@luke/database/models/message-reads";
import { listRecentMessages, type StoredMessageRecord } from "@luke/database/models/message-reads";
import { CLEARED_CONVERSATION_RETENTION_MS } from "@luke/database/models/soft-delete";
import { CONVERSATION_KIND } from "@luke/database/storage-vocabulary";
import {
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  TURN_ORIGIN,
  TURN_STATUS,
} from "@luke/wire";
import { type ToolSet, tool } from "ai";
import { afterAll, test } from "vitest";
import { z } from "zod";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import {
  type ConversationRow,
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

async function countConversations(id: string): Promise<number> {
  return (await readConversationById(database.run, id)).length;
}

function readRecords(read: MessageListRead): readonly StoredMessageRecord[] {
  assert.equal(read.ok, true);
  return read.ok ? read.value : [];
}

/** A main conversation with three messages and the turn that wrote them. */
async function populateMain(
  userId: string,
): Promise<{ main: string; turn: string; ids: string[] }> {
  const main = await insertConversation(userId);
  const turn = await insertTurn(userId, main);
  const ids: string[] = [];
  for (const seq of [1, 2, 3]) {
    ids.push(await insertMessage(userId, main, seq, { turnId: turn }));
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
