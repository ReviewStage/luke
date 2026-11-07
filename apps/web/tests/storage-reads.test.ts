import assert from "node:assert/strict";
import type { MessageListRead } from "@repo/database/models/message-reads";
import { listRecentMessages, type StoredMessageRecord } from "@repo/database/models/message-reads";
import {
  type ConversationRow,
  insertConversation as insertConversationRow,
  insertMessage as insertMessageRow,
  insertTurn as insertTurnRow,
  type MessageRow as MessageInsertRow,
  openHostedStoreTestDatabase,
  type TurnInsertRow,
} from "@repo/database/testing";
import { MESSAGE_CHANNEL, MESSAGE_ROLE, TURN_ORIGIN, TURN_STATUS } from "@repo/wire";
import { type ToolSet, tool } from "ai";
import { afterAll, test } from "vitest";
import { z } from "zod";

/**
 * The conversation reads the brain and the voice make, against the real
 * migrations: each answers the rows it names typed by role, a row
 * naming a tool the catalog has retired reads back without that part, and a
 * row this build cannot read back — parts that are not a message's —
 * refuses the page rather than riding out in it.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const NOW = new Date("2026-09-10T12:00:00.000Z");

const TOOLS: ToolSet = {
  read_transcript: tool({
    description: "Reads the tail of an observed session's transcript.",
    inputSchema: z.object({ provider_id: z.string(), provider_session_id: z.string() }),
    outputSchema: z.object({ lines: z.array(z.string()) }),
  }),
};

const TYPED_ASK = { channel: MESSAGE_CHANNEL.TYPED } as const;

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
