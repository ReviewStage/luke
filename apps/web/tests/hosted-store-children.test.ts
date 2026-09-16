import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Effect, Option } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { afterAll, test } from "vitest";
import {
  CHILD_STATUS,
  CHILDREN_READ_BOUNDS,
  MESSAGE_ROLE,
  TURN_ORIGIN,
  TURN_STATUS,
} from "../server/core";
import { CONVERSATION_KIND } from "../server/db/storage-vocabulary";
import type { ChildRecord } from "../server/hosted/store";
import { openChildConversation, readChild } from "../server/hosted/store/children";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import {
  insertConversation,
  insertMessage,
  insertTurn,
  setConversationDeletedAt,
} from "./support/store-rows";

/**
 * The children directory over the real migrations on PGlite. Synthetic
 * fixtures throughout: a child's label is a fixture word, and the one
 * message written is a fixture task, since the read carries an excerpt of it.
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
  row: { createdAt: Date; label?: string },
): Promise<string> {
  return insertConversation(database.run, {
    userId,
    kind: CONVERSATION_KIND.CHILD,
    parentConversationId,
    ...row,
  });
}

/** One child by id as the brain host reads it, or nothing. */
const child = (userId: string, childId: string) =>
  database.run(Effect.map(readChild(userId, childId), Option.getOrUndefined));

const ids = (children: readonly ChildRecord[]) => children.map((child) => child.id);

test("children are listed newest first, bounded by the limit, and read one by id", async () => {
  const userId = await database.createUser();
  const parent = await parentOf(userId);
  const oldest = await childOf(userId, parent, { createdAt: at(1), label: "fixture one" });
  const middle = await childOf(userId, parent, { createdAt: at(2) });
  const newest = await childOf(userId, parent, { createdAt: at(3), label: "fixture three" });

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
    task: null,
    expectsCompletion: true,
    createdAt: at(3),
    runtimeSessionId: null,
    status: CHILD_STATUS.ACCEPTED,
    turnId: null,
    eveTurnId: null,
    startedAt: null,
    settledAt: null,
    failure: null,
  });
  assert.equal(listed[2]?.label, "fixture one");
  assert.equal(listed[1]?.label, null);

  assert.deepEqual(await child(userId, middle), listed[1]);
  assert.equal(await child(userId, randomUUID()), undefined);
});

test("a child's status is its latest turn's: accepted before one runs, then running, settled, failed, or cancelled", async () => {
  const userId = await database.createUser();
  const parent = await parentOf(userId, CONVERSATION_KIND.OBSERVED);
  const tracked = await childOf(userId, parent, { createdAt: at(1) });
  const turn = (row: {
    status: string;
    queuedAt: Date;
    startedAt?: Date;
    settledAt?: Date;
    failure?: string;
  }) =>
    insertTurn(database.run, {
      userId,
      conversationId: tracked,
      origin: TURN_ORIGIN.CHILD,
      ...row,
    });
  const read = async () => {
    const found = await child(userId, tracked);
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

  // A turn on the child's row but under another account lends it nothing, however late it was queued.
  await insertTurn(database.run, {
    userId: await database.createUser(),
    conversationId: tracked,
    origin: TURN_ORIGIN.CHILD,
    status: TURN_STATUS.RUNNING,
    queuedAt: at(60),
    startedAt: at(61),
  });
  assert.equal((await read()).status, CHILD_STATUS.CANCELLED);
});

test("a stamped child, another account's child, a row of another kind, and a child under a child are listed by nothing", async () => {
  const userId = await database.createUser();
  const other = await database.createUser();
  const parent = await parentOf(userId);
  const standing = await childOf(userId, parent, { createdAt: at(1) });
  const stamped = await childOf(userId, parent, { createdAt: at(2) });
  await setConversationDeletedAt(database.run, stamped, at(3));
  const elsewhere = await childOf(other, await parentOf(other), { createdAt: at(4) });
  await insertConversation(database.run, {
    userId,
    kind: CONVERSATION_KIND.OBSERVED,
    parentConversationId: parent,
    createdAt: at(5),
  });
  // A child cannot open a child of its own, so a row under one is no delegation's.
  const nested = await childOf(userId, standing, { createdAt: at(6) });

  assert.deepEqual(ids(await database.run(database.store.directory.children(userId, 10))), [
    standing,
  ]);
  assert.equal(await child(userId, nested), undefined);
  assert.equal((await database.run(database.store.directory.childrenHead(userId)))?.id, stamped);
  assert.deepEqual(ids(await database.run(database.store.directory.children(other, 10))), [
    elsewhere,
  ]);
  assert.equal(await child(userId, stamped), undefined);
  assert.equal(await child(userId, elsewhere), undefined);
  assert.equal(await child(other, standing), undefined);
});

test("a child opens under a main or an observed parent, and under no child, however the parent stands", async () => {
  const userId = await database.createUser();
  const opened = async (parentConversationId: string, now: Date) => {
    const spawnedByMessageId = await insertMessage(database.run, {
      userId,
      conversationId: parentConversationId,
      seq: 1,
      clientId: "client-1",
      role: MESSAGE_ROLE.USER,
      parts: [{ type: "text", text: "fixture ask" }],
    });
    return database.run(
      openChildConversation({
        userId,
        parentConversationId,
        spawnedByMessageId,
        label: null,
        expectsCompletion: true,
        now,
      }),
    );
  };

  const main = await parentOf(userId);
  const observed = await parentOf(userId, CONVERSATION_KIND.OBSERVED);
  const underMain = await opened(main, at(1));
  const underObserved = await opened(observed, at(2));
  assert.ok(underMain && underObserved);
  assert.equal((await child(userId, underMain))?.parentKind, CONVERSATION_KIND.MAIN);
  assert.equal((await child(userId, underObserved))?.parentKind, CONVERSATION_KIND.OBSERVED);

  // A child cannot open a child of its own, and a child is the only kind no parent list holds: the insert refuses it.
  assert.equal(await opened(underMain, at(4)), undefined);
  assert.deepEqual(ids(await database.run(database.store.directory.children(userId, 10))), [
    underObserved,
    underMain,
  ]);
});

/** The store's rendering of an instant for a head: the UTC wall clock to the millisecond the test set, and the zone spelled. */
function instantText(date: Date): string {
  return `${date
    .toISOString()
    .replace("T", " ")
    .replace(/\.?0*Z$/u, "")}+00`;
}

test("a child's task is the text of its first user line, cut to the wire's bound, and no other line's", async () => {
  const userId = await database.createUser();
  const parent = await parentOf(userId);
  const tasked = await childOf(userId, parent, { createdAt: at(1) });
  const line = (seq: number, role: string, parts: readonly unknown[]) =>
    insertMessage(database.run, {
      userId,
      conversationId: tasked,
      seq,
      clientId: `client-${seq}`,
      role,
      parts,
    });
  const task = async () => (await child(userId, tasked))?.task;

  assert.equal(await task(), null);

  // A line of another role ahead of the task, and one holding no text, are not the task.
  await line(1, MESSAGE_ROLE.ASSISTANT, [{ type: "text", text: "fixture reply" }]);
  await line(2, MESSAGE_ROLE.USER, [{ type: "reasoning", text: "fixture thought" }]);
  assert.equal(await task(), null);

  await database.run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`delete from messages where conversation_id = ${tasked} and seq = 2`;
    }),
  );
  await line(2, MESSAGE_ROLE.USER, [
    { type: "text", text: "Draft the notes." },
    { type: "step-start" },
    { type: "text", text: "Keep them short." },
  ]);
  await line(3, MESSAGE_ROLE.USER, [{ type: "text", text: "fixture follow-up" }]);
  assert.equal(await task(), "Draft the notes. Keep them short.");

  // Leading whitespace of any kind JavaScript's trim drops spends none of the bound; the cut falls on the words.
  const long = await childOf(userId, parent, { createdAt: at(2) });
  await insertMessage(database.run, {
    userId,
    conversationId: long,
    seq: 1,
    clientId: "client-1",
    role: MESSAGE_ROLE.USER,
    parts: [
      { type: "text", text: `${"\u00a0".repeat(150)}${" \t\n".repeat(50)}${"\u3000".repeat(20)}` },
      { type: "text", text: "word ".repeat(100) },
    ],
  });
  assert.equal(
    (await child(userId, long))?.task,
    "word ".repeat(100).slice(0, CHILDREN_READ_BOUNDS.TASK_EXCERPT_CHARS),
  );
});

test("the children head is the latest stamp any child reached, a Clear's stamp included, with that child's id, and nothing while none was opened", async () => {
  const userId = await database.createUser();
  const head = () => database.run(database.store.directory.childrenHead(userId));
  assert.equal(await head(), undefined);

  const parent = await parentOf(userId);
  const first = await childOf(userId, parent, { createdAt: at(1) });
  assert.deepEqual(await head(), { id: first, changedAt: instantText(at(1)) });

  // A turn queued moves the head as its status would move the list; each later stamp moves it again.
  const turn = await insertTurn(database.run, {
    userId,
    conversationId: first,
    origin: TURN_ORIGIN.CHILD,
    status: TURN_STATUS.QUEUED,
    queuedAt: at(10),
  });
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

  const second = await childOf(userId, parent, { createdAt: at(30) });
  assert.deepEqual(await head(), { id: second, changedAt: instantText(at(30)) });

  // The task's line moves the head, since the list answers its excerpt; a later line of the child's own does not.
  await insertMessage(database.run, {
    userId,
    conversationId: second,
    seq: 1,
    clientId: "client-1",
    role: MESSAGE_ROLE.USER,
    parts: [{ type: "text", text: "fixture task" }],
    createdAt: at(35),
  });
  assert.deepEqual(await head(), { id: second, changedAt: instantText(at(35)) });
  await insertMessage(database.run, {
    userId,
    conversationId: second,
    seq: 2,
    clientId: "client-2",
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [{ type: "text", text: "fixture reply" }],
    createdAt: at(36),
  });
  assert.deepEqual(await head(), { id: second, changedAt: instantText(at(35)) });

  await database.run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`update conversations set completion_delivered_at = ${at(40)} where id = ${first}`;
    }),
  );
  assert.deepEqual(await head(), { id: first, changedAt: instantText(at(40)) });

  // A stamped child leaves the list, so its stamping moves the head; another account's child never reaches it.
  await setConversationDeletedAt(database.run, first, at(50));
  assert.deepEqual(await head(), { id: first, changedAt: instantText(at(50)) });
  assert.deepEqual(ids(await database.run(database.store.directory.children(userId, 10))), [
    second,
  ]);
  const other = await database.createUser();
  await childOf(other, await parentOf(other), { createdAt: at(60) });
  assert.deepEqual(await head(), { id: first, changedAt: instantText(at(50)) });
});
