import assert from "node:assert/strict";
import { afterAll, test } from "vitest";
import {
  BRAIN_REQUEST_FAILURE,
  MESSAGE_AUTHOR,
  MESSAGE_ROLE,
  TOOL_PART_STATE,
  TURN_ORIGIN,
  TURN_STATUS,
} from "../server/core";
import { CONVERSATION_KIND } from "../server/db/storage-vocabulary";
import { CATALOG_TOOL_SET } from "../server/hosted/brain-tool-set";
import { storeWriter } from "../server/hosted/store";
import { sweepAbandonedTurns, TURN_ABANDON } from "../server/hosted/store/abandoned-turns";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import {
  insertConversation,
  insertMessage,
  insertTurn,
  readMessagesByConversationTyped,
  readTurnById,
  setConversationDeletedAt,
} from "./support/store-rows";

/**
 * The abandoned-turn sweep over the real migrations on PGlite. Synthetic
 * fixtures throughout: the journal's one part is a fixture tool call. What
 * is held to is which rows the sweep settles — only a running turn started
 * past the bound, of a conversation still standing — and that it settles
 * them as the relay's own end would.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const NOW = Date.parse("2026-09-16T12:00:00.000Z");
const writer = await database.run(
  storeWriter({ tools: CATALOG_TOOL_SET, now: () => new Date(NOW) }),
);

interface TurnFixture {
  readonly status?: string;
  readonly startedAgoMs: number;
  readonly userId?: string;
}

/** One conversation holding one turn started as the fixture says, its journal open on an unanswered call. */
async function turnOf(fixture: TurnFixture) {
  const userId = fixture.userId ?? (await database.createUser());
  const conversationId = await insertConversation(database.run, {
    userId,
    kind: CONVERSATION_KIND.OBSERVED,
  });
  const startedAt = new Date(NOW - fixture.startedAgoMs);
  const status = fixture.status ?? TURN_STATUS.RUNNING;
  const turnId = await insertTurn(database.run, {
    userId,
    conversationId,
    origin: TURN_ORIGIN.ROSTER_DIFF,
    status,
    queuedAt: startedAt,
    startedAt: status === TURN_STATUS.QUEUED ? null : startedAt,
    settledAt: status === TURN_STATUS.SETTLED ? startedAt : null,
  });
  await insertMessage(database.run, {
    userId,
    conversationId,
    seq: 1,
    turnId,
    clientId: turnId,
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [
      {
        type: "tool-read_transcript",
        toolCallId: "call-1",
        state: TOOL_PART_STATE.INPUT_AVAILABLE,
        input: { providerId: "fixture", providerSessionId: "s-1" },
      },
    ],
    metadata: { author: MESSAGE_AUTHOR.BRAIN },
    finishedAt: null,
  });
  return { userId, conversationId, turnId };
}

test("the sweep settles only a running turn started past the bound, as failed for abandonment with its journal finished, and a second sweep finds nothing", async () => {
  const abandoned = await turnOf({ startedAgoMs: TURN_ABANDON.AFTER_MS + 60_000 });
  const running = await turnOf({ startedAgoMs: TURN_ABANDON.AFTER_MS - 60_000 });
  const queued = await turnOf({
    status: TURN_STATUS.QUEUED,
    startedAgoMs: TURN_ABANDON.AFTER_MS + 60_000,
  });
  const settled = await turnOf({
    status: TURN_STATUS.SETTLED,
    startedAgoMs: TURN_ABANDON.AFTER_MS + 60_000,
  });
  const cleared = await turnOf({ startedAgoMs: TURN_ABANDON.AFTER_MS + 60_000 });
  await setConversationDeletedAt(database.run, cleared.conversationId, new Date(NOW - 1_000));

  assert.equal(await database.run(sweepAbandonedTurns({ writer }, { now: NOW })), 1);

  const row = await readTurnById(database.run, abandoned.turnId);
  assert.equal(row?.status, TURN_STATUS.FAILED);
  assert.equal(row?.failure, BRAIN_REQUEST_FAILURE.ABANDONED);
  assert.equal(row?.failureDetail, null);
  assert.equal(row?.settledAt?.getTime(), NOW);
  const [journal] = await readMessagesByConversationTyped(database.run, abandoned.conversationId);
  assert.ok(journal);
  assert.equal(journal.finishedAt?.getTime(), NOW);
  const [part] = journal.parts;
  assert.ok(part && "state" in part);
  assert.notEqual(part.state, TOOL_PART_STATE.INPUT_AVAILABLE);

  for (const untouched of [running, queued, cleared]) {
    const standing = await readTurnById(database.run, untouched.turnId);
    assert.equal(standing?.settledAt, null);
    assert.equal(standing?.failure, null);
  }
  const alreadySettled = await readTurnById(database.run, settled.turnId);
  assert.equal(alreadySettled?.status, TURN_STATUS.SETTLED);

  assert.equal(await database.run(sweepAbandonedTurns({ writer }, { now: NOW })), 0);
});

test("the sweep settles the longest running first and no more than its limit in one pass", async () => {
  const userId = await database.createUser();
  const older = await turnOf({ userId, startedAgoMs: TURN_ABANDON.AFTER_MS + 120_000 });
  const newer = await turnOf({ userId, startedAgoMs: TURN_ABANDON.AFTER_MS + 60_000 });

  assert.equal(await database.run(sweepAbandonedTurns({ writer }, { now: NOW, limit: 1 })), 1);

  assert.equal((await readTurnById(database.run, older.turnId))?.status, TURN_STATUS.FAILED);
  assert.equal((await readTurnById(database.run, newer.turnId))?.status, TURN_STATUS.RUNNING);
});
