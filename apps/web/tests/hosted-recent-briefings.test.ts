import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, test } from "vitest";
import {
  BRAIN_TOOL,
  CONVERSATION_EVENT_KIND,
  DAY_MS,
  MESSAGE_AUTHOR,
  MESSAGE_ROLE,
  type StoredUIMessage,
  TURN_ORIGIN,
  TURN_STATUS,
  type WireRecord,
} from "../server/core";
import { CONVERSATION_KIND } from "../server/db/storage-vocabulary";
import { BRAIN_HOST } from "../server/hosted/brain-host/bounds";
import { readRecentBriefings } from "../server/hosted/brain-host/briefings";
import { CATALOG_TOOL_SET } from "../server/hosted/brain-tool-set";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import {
  insertConversation,
  insertEvent,
  insertMessage,
  insertTurn,
  setConversationDeletedAt,
} from "./support/store-rows";

/**
 * What main's standing context recalls of the briefings observed
 * conversations gave, over the real migrations on PGlite: the offers since
 * the window and since the standing main opened, newest first and bounded,
 * their words read back from the announcing rows in one page; and what is
 * left out — a briefing main itself gave, one from before the main opened,
 * one older than the window, one in a stamped conversation, another
 * account's, and a row with no settled announce on it. Synthetic sessions
 * throughout.
 */

const NOW = 1_800_000_000_000;
const MINUTE_MS = 60_000;

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const run = database.run;

type MessageParts = StoredUIMessage["parts"];

function announcePart(input: WireRecord, state = "output-available"): MessageParts[number] {
  // SAFETY: a stored tool part in the SDK's own shape; the read under the catalog registry is the validation.
  return {
    type: `tool-${BRAIN_TOOL.ANNOUNCE}`,
    toolCallId: `call_${randomUUID()}`,
    state,
    input,
    ...(state === "output-available" ? { output: { status: "accepted" } } : undefined),
  } as unknown as MessageParts[number];
}

interface Observed {
  readonly conversationId: string;
  readonly providerSessionId: string;
}

let sessions = 0;

/** Each conversation numbers its own rows and its own events; the test hands out the next of each itself, as the writer would. */
const nextSeq = new Map<string, number>();

function seqOf(conversationId: string): number {
  const seq = nextSeq.get(conversationId) ?? 1;
  nextSeq.set(conversationId, seq + 1);
  return seq;
}

/** An observed conversation for a session of its own, as the opener names it. */
async function observed(
  userId: string,
  title?: string,
  createdAt = new Date(NOW),
): Promise<Observed> {
  sessions += 1;
  const providerSessionId = `fixture-session-${sessions}`;
  const conversationId = await insertConversation(run, {
    userId,
    kind: CONVERSATION_KIND.OBSERVED,
    providerId: "conductor",
    providerSessionId,
    createdAt,
    ...(title !== undefined ? { title } : undefined),
  });
  return { conversationId, providerSessionId };
}

/** One settled turn of a conversation whose assistant row carries the parts given, as the relay leaves them; answers the row's id. */
async function announced(
  userId: string,
  conversationId: string,
  parts: MessageParts,
  at: number,
): Promise<string> {
  const turnId = await insertTurn(run, {
    userId,
    conversationId,
    origin: TURN_ORIGIN.TRANSCRIPT_CHANGE,
    status: TURN_STATUS.SETTLED,
    queuedAt: new Date(at),
    settledAt: new Date(at),
  });
  return insertMessage(run, {
    userId,
    conversationId,
    seq: seqOf(conversationId),
    turnId,
    clientId: turnId,
    role: MESSAGE_ROLE.ASSISTANT,
    parts,
    metadata: { author: MESSAGE_AUTHOR.BRAIN },
    createdAt: new Date(at),
    finishedAt: new Date(at),
  });
}

/**
 * A briefing announced and offered at the instant given, from the
 * conversation given: the offered event written as the announce's settlement
 * writes it, stamped with that instant rather than the writer's clock, which
 * one test database pins to one instant for every write.
 */
async function briefed(
  userId: string,
  conversationId: string,
  briefing: string,
  at: number,
  parts: MessageParts = [announcePart({ briefing })],
): Promise<string> {
  const messageId = await announced(userId, conversationId, parts, at);
  await insertEvent(run, {
    userId,
    conversationId,
    seq: seqOf(`events:${conversationId}`),
    messageId,
    kind: CONVERSATION_EVENT_KIND.SPEECH_OFFERED,
    payload: { expiresAt: at + 15 * MINUTE_MS },
    createdAt: new Date(at),
  });
  return messageId;
}

async function mainOpened(userId: string, at: number): Promise<string> {
  return insertConversation(run, { userId, kind: CONVERSATION_KIND.MAIN, createdAt: new Date(at) });
}

test("the briefings observed conversations gave since the main opened and within the window are recalled newest first with their words, titles, and sessions; the rest are left out", async () => {
  const userId = await database.createUser();
  const other = await database.createUser();
  const main = await mainOpened(userId, NOW - 12 * 60 * MINUTE_MS);

  const checkout = await observed(userId, "Fix the checkout tests");
  const untitled = await observed(userId);
  const stamped = await observed(userId, "Cleared");
  const theirs = await observed(other, "Theirs");

  // Recalled: two from checkout, one from the untitled session.
  await briefed(
    userId,
    checkout.conversationId,
    "Checkout is stuck on a failing test.",
    NOW - 60 * MINUTE_MS,
  );
  await briefed(
    userId,
    untitled.conversationId,
    "The untitled chat finished.",
    NOW - 30 * MINUTE_MS,
  );
  await briefed(
    userId,
    checkout.conversationId,
    "Checkout opened a pull request.",
    NOW - 5 * MINUTE_MS,
  );

  // Left out: before the main opened, older than the window, main's own,
  // another account's, a stamped conversation's, and an unsettled announce.
  await briefed(
    userId,
    checkout.conversationId,
    "Before the main opened.",
    NOW - 13 * 60 * MINUTE_MS,
  );
  await briefed(
    userId,
    checkout.conversationId,
    "Older than the window.",
    NOW - DAY_MS - MINUTE_MS,
  );
  await briefed(userId, main, "Main's own briefing.", NOW - 4 * MINUTE_MS);
  await briefed(other, theirs.conversationId, "Another account's.", NOW - 3 * MINUTE_MS);
  await briefed(userId, stamped.conversationId, "In a stamped conversation.", NOW - 2 * MINUTE_MS);
  await setConversationDeletedAt(run, stamped.conversationId, new Date(NOW - MINUTE_MS));
  await briefed(userId, checkout.conversationId, "Never settled.", NOW - MINUTE_MS, [
    announcePart({ briefing: "Never settled." }, "input-available"),
  ]);

  const recalled = await run(
    readRecentBriefings(database.store, CATALOG_TOOL_SET, { userId, conversationId: main }, NOW),
  );
  assert.deepEqual(recalled, [
    {
      announcedAt: NOW - 5 * MINUTE_MS,
      session: { providerId: "conductor", providerSessionId: checkout.providerSessionId },
      title: "Fix the checkout tests",
      words: "Checkout opened a pull request.",
    },
    {
      announcedAt: NOW - 30 * MINUTE_MS,
      session: { providerId: "conductor", providerSessionId: untitled.providerSessionId },
      title: undefined,
      words: "The untitled chat finished.",
    },
    {
      announcedAt: NOW - 60 * MINUTE_MS,
      session: { providerId: "conductor", providerSessionId: checkout.providerSessionId },
      title: "Fix the checkout tests",
      words: "Checkout is stuck on a failing test.",
    },
  ]);
});

test("the recall is bounded to the newest briefings, a main with none recalls nothing, and a Clear's new main starts the recall over", async () => {
  const userId = await database.createUser();
  const main = await mainOpened(userId, NOW - 60 * MINUTE_MS);
  const chat = await observed(userId, "Busy chat");

  for (let index = 0; index < BRAIN_HOST.RECENT_BRIEFINGS + 3; index += 1) {
    await briefed(userId, chat.conversationId, `Briefing ${index}`, NOW - (30 - index) * MINUTE_MS);
  }
  const recalled = await run(
    readRecentBriefings(database.store, CATALOG_TOOL_SET, { userId, conversationId: main }, NOW),
  );
  assert.equal(recalled.length, BRAIN_HOST.RECENT_BRIEFINGS);
  assert.equal(recalled[0]?.words, `Briefing ${BRAIN_HOST.RECENT_BRIEFINGS + 2}`);
  assert.equal(recalled.at(-1)?.words, "Briefing 3");

  // The same observed rows stand after a Clear, but the new main opened after every one of them.
  await setConversationDeletedAt(run, main, new Date(NOW + MINUTE_MS));
  const cleared = await mainOpened(userId, NOW + MINUTE_MS);
  assert.deepEqual(
    await run(
      readRecentBriefings(
        database.store,
        CATALOG_TOOL_SET,
        { userId, conversationId: cleared },
        NOW + 2 * MINUTE_MS,
      ),
    ),
    [],
  );
});
