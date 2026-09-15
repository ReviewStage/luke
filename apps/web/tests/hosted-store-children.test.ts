import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, test } from "vitest";
import { TURN_ORIGIN, TURN_STATUS } from "../server/core";
import { CONVERSATION_KIND } from "../server/db/storage-vocabulary";
import { CHILD_STATUS, type ChildRecord } from "../server/hosted/store";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import { insertConversation, insertTurn, setConversationDeletedAt } from "./support/store-rows";

/**
 * The children directory over the real migrations on PGlite. Synthetic
 * fixtures throughout: a child's label is a fixture word, and no message is
 * written, since the read carries none.
 */

const NOW = 1_800_000_000_000;

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const at = (offset: number) => new Date(NOW + offset);

async function parentOf(
  userId: string,
  kind: (typeof CONVERSATION_KIND)[keyof typeof CONVERSATION_KIND] = CONVERSATION_KIND.MAIN,
): Promise<string> {
  return insertConversation(database.run, { userId, kind, createdAt: at(0) });
}

async function childOf(
  userId: string,
  parentConversationId: string,
  row: { createdAt: Date; label?: string; completionDeliveredAt?: Date },
): Promise<string> {
  return insertConversation(database.run, {
    userId,
    kind: CONVERSATION_KIND.CHILD,
    parentConversationId,
    ...row,
  });
}

const ids = (children: readonly ChildRecord[]) => children.map((child) => child.id);

test("children are listed newest first, bounded by the limit, and read one by id", async () => {
  const userId = await database.createUser();
  const parent = await parentOf(userId);
  const oldest = await childOf(userId, parent, { createdAt: at(1), label: "fixture one" });
  const middle = await childOf(userId, parent, { createdAt: at(2) });
  const newest = await childOf(userId, parent, {
    createdAt: at(3),
    label: "fixture three",
    completionDeliveredAt: at(4),
  });

  const listed = await database.run(database.store.directory.children(userId, 10));
  assert.deepEqual(ids(listed), [newest, middle, oldest]);
  assert.deepEqual(ids(await database.run(database.store.directory.children(userId, 2))), [
    newest,
    middle,
  ]);

  const [first] = listed;
  assert.deepEqual(first, {
    id: newest,
    parentConversationId: parent,
    parentKind: CONVERSATION_KIND.MAIN,
    label: "fixture three",
    createdAt: at(3),
    completionDeliveredAt: at(4),
    status: CHILD_STATUS.ACCEPTED,
    startedAt: null,
    settledAt: null,
    failure: null,
  });
  assert.equal(listed[2]?.label, "fixture one");
  assert.equal(listed[1]?.label, null);
  assert.equal(listed[1]?.completionDeliveredAt, null);

  assert.deepEqual(await database.run(database.store.directory.child(userId, middle)), listed[1]);
  assert.equal(await database.run(database.store.directory.child(userId, randomUUID())), undefined);
});

test("a child's status is its latest turn's: accepted before one runs, then running, settled, failed, or cancelled", async () => {
  const userId = await database.createUser();
  const parent = await parentOf(userId, CONVERSATION_KIND.OBSERVED);
  const child = await childOf(userId, parent, { createdAt: at(1) });
  const turn = (row: {
    status: string;
    queuedAt: Date;
    startedAt?: Date;
    settledAt?: Date;
    failure?: string;
  }) =>
    insertTurn(database.run, {
      userId,
      conversationId: child,
      origin: TURN_ORIGIN.CHILD,
      ...row,
    });
  const read = async () => {
    const found = await database.run(database.store.directory.child(userId, child));
    assert.ok(found);
    assert.equal(found.parentKind, CONVERSATION_KIND.OBSERVED);
    return found;
  };

  assert.equal((await read()).status, CHILD_STATUS.ACCEPTED);

  await turn({ status: TURN_STATUS.QUEUED, queuedAt: at(10) });
  assert.equal((await read()).status, CHILD_STATUS.ACCEPTED);

  await turn({ status: TURN_STATUS.RUNNING, queuedAt: at(20), startedAt: at(21) });
  const running = await read();
  assert.equal(running.status, CHILD_STATUS.RUNNING);
  assert.deepEqual(running.startedAt, at(21));
  assert.equal(running.settledAt, null);

  await turn({
    status: TURN_STATUS.SETTLED,
    queuedAt: at(30),
    startedAt: at(31),
    settledAt: at(32),
  });
  const settled = await read();
  assert.equal(settled.status, CHILD_STATUS.SETTLED);
  assert.deepEqual(settled.settledAt, at(32));
  assert.equal(settled.failure, null);

  await turn({
    status: TURN_STATUS.FAILED,
    queuedAt: at(40),
    startedAt: at(41),
    settledAt: at(42),
    failure: "model",
  });
  const failed = await read();
  assert.equal(failed.status, CHILD_STATUS.FAILED);
  assert.equal(failed.failure, "model");

  await turn({ status: TURN_STATUS.CANCELLED, queuedAt: at(50), settledAt: at(51) });
  assert.equal((await read()).status, CHILD_STATUS.CANCELLED);

  // The latest turn is the one queued last, not the one written last.
  await turn({ status: TURN_STATUS.SETTLED, queuedAt: at(5), settledAt: at(6) });
  assert.equal((await read()).status, CHILD_STATUS.CANCELLED);
});

test("a stamped child, another account's child, and a row of another kind are listed by nothing", async () => {
  const userId = await database.createUser();
  const other = await database.createUser();
  const parent = await parentOf(userId);
  const standing = await childOf(userId, parent, { createdAt: at(1) });
  const stamped = await childOf(userId, parent, { createdAt: at(2) });
  await setConversationDeletedAt(database.run, stamped, at(3));
  const elsewhere = await childOf(other, await parentOf(other), { createdAt: at(4) });
  await insertConversation(database.run, {
    userId,
    kind: CONVERSATION_KIND.THREAD,
    parentConversationId: parent,
    createdAt: at(5),
  });

  assert.deepEqual(ids(await database.run(database.store.directory.children(userId, 10))), [
    standing,
  ]);
  assert.deepEqual(ids(await database.run(database.store.directory.children(other, 10))), [
    elsewhere,
  ]);
  assert.equal(await database.run(database.store.directory.child(userId, stamped)), undefined);
  assert.equal(await database.run(database.store.directory.child(userId, elsewhere)), undefined);
  assert.equal(await database.run(database.store.directory.child(other, standing)), undefined);
});
