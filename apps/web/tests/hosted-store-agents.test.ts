import assert from "node:assert/strict";
import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { afterAll, test } from "vitest";
import { CHILD_STATUS, TURN_ORIGIN, TURN_STATUS } from "../server/core";
import { CONVERSATION_KIND } from "../server/db/storage-vocabulary";
import type { AgentRecord } from "../server/hosted/store";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import { insertConversation, insertTurn, setConversationDeletedAt } from "./support/store-rows";

/**
 * The agents directory over the real migrations on PGlite: the account's
 * observed conversations holding a turn, the one that changed last first on
 * the head's own terms, each where its latest turn leaves it; and the head
 * that moves exactly when the list would read differently. Synthetic session
 * identities throughout.
 */

const NOW = 1_800_000_000_000;

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const at = (offset: number) => new Date(NOW + offset);

let sessions = 0;

/** An observed conversation for a session of its own, under a fixture identity, named as the opener would name it where a naming is given. */
async function agentOf(
  userId: string,
  createdAt: Date,
  naming: { title?: string; workspace?: string } = {},
): Promise<string> {
  sessions += 1;
  return insertConversation(database.run, {
    userId,
    kind: CONVERSATION_KIND.OBSERVED,
    providerId: "conductor",
    providerSessionId: `fixture-session-${sessions}`,
    createdAt,
    ...naming,
  });
}

function turnOf(
  userId: string,
  conversationId: string,
  row: { status: string; queuedAt: Date; startedAt?: Date; settledAt?: Date; failure?: string },
): Promise<string> {
  return insertTurn(database.run, {
    userId,
    conversationId,
    origin: TURN_ORIGIN.TRANSCRIPT_CHANGE,
    ...row,
  });
}

const ids = (agents: readonly AgentRecord[]) => agents.map((agent) => agent.id);

/** The store's rendering of an instant for a head: the UTC wall clock to the millisecond the test set, and the zone spelled. */
function instantText(date: Date): string {
  return `${date
    .toISOString()
    .replace("T", " ")
    .replace(/\.?0*Z$/u, "")}+00`;
}

test("agents are listed by the instant they last changed, latest first, bounded by the limit, each where its latest turn leaves it", async () => {
  const userId = await database.createUser();
  const early = await agentOf(userId, at(1));
  const late = await agentOf(userId, at(2), {
    title: "Fix the checkout tests",
    workspace: "power-vacation",
  });
  const middle = await agentOf(userId, at(3));

  const earlyTurn = await turnOf(userId, early, {
    status: TURN_STATUS.SETTLED,
    queuedAt: at(10),
    startedAt: at(11),
    settledAt: at(12),
  });
  await turnOf(userId, middle, { status: TURN_STATUS.QUEUED, queuedAt: at(20) });
  await turnOf(userId, late, {
    status: TURN_STATUS.FAILED,
    queuedAt: at(30),
    startedAt: at(31),
    settledAt: at(32),
    failure: "model",
  });
  // The latest turn is the one queued last, not the one written last; an earlier turn moves nothing.
  await turnOf(userId, early, { status: TURN_STATUS.CANCELLED, queuedAt: at(5), settledAt: at(6) });

  const listed = await database.run(database.store.directory.agents(userId, 10));
  assert.deepEqual(ids(listed), [late, middle, early]);
  assert.deepEqual(ids(await database.run(database.store.directory.agents(userId, 2))), [
    late,
    middle,
  ]);

  assert.deepEqual(listed[0], {
    id: late,
    providerId: "conductor",
    providerSessionId: `fixture-session-${sessions - 1}`,
    createdAt: at(2),
    title: "Fix the checkout tests",
    workspace: "power-vacation",
    status: CHILD_STATUS.FAILED,
    queuedAt: at(30),
    startedAt: at(31),
    settledAt: at(32),
    failure: "model",
  });
  assert.equal(listed[1]?.status, CHILD_STATUS.ACCEPTED);
  // A row the opener never named carries no naming.
  assert.deepEqual([listed[1]?.title, listed[1]?.workspace], [null, null]);
  assert.deepEqual(listed[1]?.queuedAt, at(20));
  assert.equal(listed[1]?.startedAt, null);
  assert.equal(listed[2]?.status, CHILD_STATUS.SETTLED);
  assert.deepEqual(listed[2]?.settledAt, at(12));

  await turnOf(userId, middle, {
    status: TURN_STATUS.RUNNING,
    queuedAt: at(40),
    startedAt: at(41),
  });
  const running = await database.run(database.store.directory.agents(userId, 10));
  assert.deepEqual(ids(running), [middle, late, early]);
  assert.equal(running[0]?.status, CHILD_STATUS.RUNNING);
  assert.deepEqual(running[0]?.startedAt, at(41));

  // The order is the head's: a turn queued first but settled last moves its agent to the front.
  await database.run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`update turns set settled_at = ${at(50)} where id = ${earlyTurn}`;
    }),
  );
  assert.deepEqual(ids(await database.run(database.store.directory.agents(userId, 10))), [
    early,
    middle,
    late,
  ]);
});

test("an observed conversation without a turn, a stamped one, a row of another kind, and another account's are listed by nothing", async () => {
  const userId = await database.createUser();
  const other = await database.createUser();
  const standing = await agentOf(userId, at(1));
  await turnOf(userId, standing, { status: TURN_STATUS.QUEUED, queuedAt: at(10) });
  await agentOf(userId, at(2));
  const stamped = await agentOf(userId, at(3));
  await turnOf(userId, stamped, { status: TURN_STATUS.QUEUED, queuedAt: at(20) });
  await setConversationDeletedAt(database.run, stamped, at(21));
  const main = await insertConversation(database.run, { userId, createdAt: at(4) });
  await insertTurn(database.run, {
    userId,
    conversationId: main,
    origin: TURN_ORIGIN.TYPED,
    status: TURN_STATUS.SETTLED,
    queuedAt: at(30),
    settledAt: at(31),
  });
  const elsewhere = await agentOf(other, at(5));
  await turnOf(other, elsewhere, { status: TURN_STATUS.QUEUED, queuedAt: at(40) });
  // A turn on the agent's row but under another account lends it nothing, however late it was queued.
  await turnOf(other, standing, {
    status: TURN_STATUS.RUNNING,
    queuedAt: at(50),
    startedAt: at(51),
  });

  const listed = await database.run(database.store.directory.agents(userId, 10));
  assert.deepEqual(ids(listed), [standing]);
  assert.equal(listed[0]?.status, CHILD_STATUS.ACCEPTED);
  assert.deepEqual(ids(await database.run(database.store.directory.agents(other, 10))), [
    elsewhere,
  ]);
});

test("an observed row missing its provider or its session is no agent: listed by nothing and moving the head nowhere, whatever turn it holds", async () => {
  const userId = await database.createUser();
  const whole = await agentOf(userId, at(1));
  await turnOf(userId, whole, { status: TURN_STATUS.QUEUED, queuedAt: at(10) });
  for (const identity of [
    { providerId: null, providerSessionId: "fixture-session-unnamed" },
    { providerId: "conductor", providerSessionId: null },
  ]) {
    const unnamed = await insertConversation(database.run, {
      userId,
      kind: CONVERSATION_KIND.OBSERVED,
      ...identity,
      createdAt: at(2),
    });
    await turnOf(userId, unnamed, {
      status: TURN_STATUS.RUNNING,
      queuedAt: at(20),
      startedAt: at(21),
    });
  }

  // The whole row is still answered rather than the page refused over a row the schema cannot decode.
  assert.deepEqual(ids(await database.run(database.store.directory.agents(userId, 10))), [whole]);
  assert.deepEqual(await database.run(database.store.directory.agentsHead(userId)), {
    id: whole,
    changedAt: instantText(at(10)),
  });
});

test("the agents head is the latest stamp any agent's latest turn reached, a stamp on the row included, and nothing while no agent has a turn", async () => {
  const userId = await database.createUser();
  const head = () => database.run(database.store.directory.agentsHead(userId));
  assert.equal(await head(), undefined);

  // An observed conversation without a turn is no agent yet, and moves nothing.
  const first = await agentOf(userId, at(1));
  assert.equal(await head(), undefined);

  const turn = await turnOf(userId, first, { status: TURN_STATUS.QUEUED, queuedAt: at(10) });
  assert.deepEqual(await head(), { id: first, changedAt: instantText(at(10)) });
  await database.run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        update turns set status = ${TURN_STATUS.RUNNING}, started_at = ${at(20)} where id = ${turn}
      `;
    }),
  );
  assert.deepEqual(await head(), { id: first, changedAt: instantText(at(20)) });
  await database.run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        update turns set status = ${TURN_STATUS.SETTLED}, settled_at = ${at(30)} where id = ${turn}
      `;
    }),
  );
  assert.deepEqual(await head(), { id: first, changedAt: instantText(at(30)) });

  const second = await agentOf(userId, at(2));
  await turnOf(userId, second, { status: TURN_STATUS.QUEUED, queuedAt: at(40) });
  assert.deepEqual(await head(), { id: second, changedAt: instantText(at(40)) });

  // A stamped agent leaves the list, so its stamping moves the head; another account's agent never reaches it.
  await setConversationDeletedAt(database.run, first, at(50));
  assert.deepEqual(await head(), { id: first, changedAt: instantText(at(50)) });
  assert.deepEqual(ids(await database.run(database.store.directory.agents(userId, 10))), [second]);
  const other = await database.createUser();
  await turnOf(other, await agentOf(other, at(3)), {
    status: TURN_STATUS.QUEUED,
    queuedAt: at(60),
  });
  assert.deepEqual(await head(), { id: first, changedAt: instantText(at(50)) });
});
