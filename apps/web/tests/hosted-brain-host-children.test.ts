import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Effect, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { afterAll, test } from "vitest";
import {
  BRAIN_INPUT_MARKER,
  BRAIN_TURN_TRIGGER,
  CHILD_RUN_STATUS,
  CHILD_SPAWN_REFUSAL,
  type ChildRunRecord,
  childSessionKey,
  MESSAGE_AUTHOR,
  MESSAGE_ROLE,
  CONVERSATION_KIND as RECORD_CONVERSATION_KIND,
  sessionKey,
  TURN_ORIGIN,
  TURN_STATUS,
  UI_PART_TYPE,
  userMetadataOf,
} from "../server/core";
import { CONVERSATION_KIND } from "../server/db/storage-vocabulary";
import { BRAIN_HOST_TURN } from "../server/hosted/brain-host/bounds";
import { CHILD_OPEN_REFUSAL, type ChildTurn } from "../server/hosted/brain-host/child-opener";
import {
  HOSTED_CHILDREN,
  type HostedChildrenSeams,
  hostedChildAccess,
} from "../server/hosted/brain-host/children";
import {
  EVE_CALLER,
  EVE_CANCEL_OUTCOME,
  EVE_SEND_OUTCOME,
  type EveMessage,
  type EveSessions,
  type EveSessionsOptions,
} from "../server/hosted/brain-host/eve-sessions";
import { CATALOG_TOOL_SET } from "../server/hosted/brain-tool-set";
import { storeWriter } from "../server/hosted/store";
import { conversationDirectory } from "../server/hosted/store/standing-conversations";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import {
  insertConversation,
  insertMessage,
  insertTurn,
  instantColumn,
  readConversationById,
  readTurnById,
} from "./support/store-rows";

/**
 * The hosted children access over the real migrations on PGlite, against a
 * fake eve: what a spawn is refused for before the opener hears it, what
 * reaches the opener when it is not, and how the parent's children, the
 * account's conversations, and a child's lines read back. Synthetic fixtures
 * throughout: every task, label, and line is a fixture word, and every
 * account is one the test created.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const NOW = Date.parse("2026-09-15T10:00:00.000Z");
const ORIGIN = "https://luke.test";
const SECRET = "deployment-secret-fixture";
const SESSION_ID = "wrun_01M000000000000000000CHILD";
const EVE_TURN_ID = "turn_3";

const at = (offset: number) => new Date(NOW + offset);

const writer = await database.run(storeWriter({ tools: CATALOG_TOOL_SET }));

type Opened = Awaited<ReturnType<EveSessions<ChildTurn>["open"]>>;
type Cancelled = Awaited<ReturnType<EveSessions["cancel"]>>;

const ACCEPTING: Opened = { outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId: SESSION_ID };
const CANCEL_ACCEPTED: Cancelled = { outcome: EVE_CANCEL_OUTCOME.ACCEPTED };

/** A fake eve recording how it was composed and what it was handed; every open and cancel answers as the test says. */
function fakeEve(answers: { open?: Opened; cancel?: Cancelled } = {}) {
  const composed: EveSessionsOptions[] = [];
  const opened: EveMessage<ChildTurn>[] = [];
  const cancelled: { sessionId: string; eveTurnId: string }[] = [];
  const eve: HostedChildrenSeams["opener"]["eve"] = (options) => {
    composed.push(options);
    return {
      open(message) {
        opened.push(message);
        return Promise.resolve(answers.open ?? ACCEPTING);
      },
      send: () => {
        throw new Error("the children access sends nothing");
      },
      cancel(sessionId, eveTurnId) {
        cancelled.push({ sessionId, eveTurnId });
        return Promise.resolve(answers.cancel ?? CANCEL_ACCEPTED);
      },
    };
  };
  return { eve, composed, opened, cancelled };
}

interface Standing {
  readonly userId: string;
  /** The conversation the tools belong to, a main unless the test says otherwise. */
  readonly conversationId: string;
  /** A turn of that conversation with its journal row, the message a spawn hangs the child from. */
  readonly turnId: string;
  readonly journalMessageId: string;
}

/** An account with one standing conversation, one turn of it, and that turn's journal row. */
async function standing(
  kind: HostedChildrenSeams["kind"] = CONVERSATION_KIND.MAIN,
): Promise<Standing> {
  const userId = await database.createUser();
  const conversationId = await insertConversation(database.run, {
    userId,
    kind,
    createdAt: at(0),
    ...(kind === CONVERSATION_KIND.CHILD
      ? { parentConversationId: await insertConversation(database.run, { userId }) }
      : undefined),
  });
  const turnId = await insertTurn(database.run, {
    userId,
    conversationId,
    origin: TURN_ORIGIN.SPOKEN,
    status: TURN_STATUS.RUNNING,
    queuedAt: at(1),
    startedAt: at(1),
  });
  const journalMessageId = await insertMessage(database.run, {
    userId,
    conversationId,
    seq: 2,
    turnId,
    clientId: turnId,
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [],
    metadata: { author: MESSAGE_AUTHOR.BRAIN },
    createdAt: at(2),
  });
  return { userId, conversationId, turnId, journalMessageId };
}

function seamsOf(
  fixture: Standing,
  eve: ReturnType<typeof fakeEve>,
  overrides: Partial<HostedChildrenSeams["opener"]> = {},
  kind: HostedChildrenSeams["kind"] = CONVERSATION_KIND.MAIN,
): HostedChildrenSeams & { reports: string[] } {
  const reports: string[] = [];
  return {
    conversation: { userId: fixture.userId, conversationId: fixture.conversationId },
    kind,
    turnId: fixture.turnId,
    opener: {
      deploymentSecret: () => SECRET,
      eveOrigin: () => ORIGIN,
      eve: eve.eve,
      now: () => NOW,
      report: (message) => reports.push(message),
      ...overrides,
    },
    writer,
    now: () => NOW,
    reports,
  };
}

/** One use of the access, built over the test database's own client the way the host builds it over the request's. */
function withAccess<A>(
  seams: HostedChildrenSeams,
  use: (access: ReturnType<typeof hostedChildAccess>) => Effect.Effect<A>,
): Promise<A> {
  return database.run(
    Effect.flatMap(SqlClient.SqlClient, (client) => use(hostedChildAccess(client, seams))),
  );
}

const SPAWN = { task: "fixture task" };

/** Another standing conversation of the account, observed since an account has one main. */
function elsewhereIn(userId: string): Promise<string> {
  return insertConversation(database.run, {
    userId,
    kind: CONVERSATION_KIND.OBSERVED,
    providerId: "conductor",
    providerSessionId: randomUUID(),
    createdAt: at(5),
  });
}

/** A child under the parent, with the turn the test says stands for it, or none. */
async function childOf(
  fixture: Standing,
  row: {
    readonly parentConversationId?: string;
    readonly label?: string;
    readonly createdAt?: Date;
    readonly runtimeSessionId?: string;
    readonly turn?: {
      readonly status: string;
      readonly eveTurnId?: string;
      readonly startedAt?: Date;
      readonly settledAt?: Date;
      readonly failure?: string;
    };
    readonly task?: string;
  } = {},
): Promise<{ childId: string; turnId: string | undefined }> {
  const childId = await insertConversation(database.run, {
    userId: fixture.userId,
    kind: CONVERSATION_KIND.CHILD,
    parentConversationId: row.parentConversationId ?? fixture.conversationId,
    label: row.label ?? null,
    createdAt: row.createdAt ?? at(10),
    runtimeSessionId: row.runtimeSessionId ?? null,
  });
  if (row.task !== undefined) {
    await insertMessage(database.run, {
      userId: fixture.userId,
      conversationId: childId,
      seq: 1,
      clientId: randomUUID(),
      role: MESSAGE_ROLE.USER,
      parts: [{ type: UI_PART_TYPE.TEXT, text: row.task }],
      metadata: userMetadataOf(BRAIN_TURN_TRIGGER.CHILD_TASK, undefined),
      createdAt: at(10),
      finishedAt: at(10),
    });
  }
  const turnId =
    row.turn === undefined
      ? undefined
      : await insertTurn(database.run, {
          userId: fixture.userId,
          conversationId: childId,
          origin: TURN_ORIGIN.CHILD,
          status: row.turn.status,
          eveTurnId: row.turn.eveTurnId ?? null,
          queuedAt: at(11),
          startedAt: row.turn.startedAt ?? null,
          settledAt: row.turn.settledAt ?? null,
          failure: row.turn.failure ?? null,
        });
  return { childId, turnId };
}

const ChildRowSchema = Schema.Struct({
  parentConversationId: Schema.String,
  spawnedByMessageId: Schema.String,
  label: Schema.NullOr(Schema.String),
  expectsCompletion: Schema.Boolean,
}).pipe(
  Schema.encodeKeys({
    parentConversationId: "parent_conversation_id",
    spawnedByMessageId: "spawned_by_message_id",
    expectsCompletion: "expects_completion",
  }),
);

async function childRow(childId: string) {
  const rows = await database.run(
    Effect.flatMap(
      SqlClient.SqlClient,
      (sql) => sql`
        select parent_conversation_id, spawned_by_message_id, label, expects_completion
        from conversations where id = ${childId} and deleted_at is null
      `,
    ),
  );
  return rows[0] === undefined ? undefined : Schema.decodeUnknownSync(ChildRowSchema)(rows[0]);
}

test("a spawn reaches the opener with the parent, the turn's journal, the task, the label, and the expectation, and answers the receipt", async () => {
  const fixture = await standing();
  const eve = fakeEve();
  const seams = seamsOf(fixture, eve);

  const outcome = await withAccess(seams, (access) =>
    access.spawn({ ...SPAWN, label: "fixture label", expectsCompletion: false }),
  );
  assert.equal(outcome.accepted, true);
  if (!outcome.accepted) return;
  assert.equal(outcome.receipt.childSessionKey, childSessionKey(outcome.receipt.childId));
  assert.deepEqual(await childRow(outcome.receipt.childId), {
    parentConversationId: fixture.conversationId,
    spawnedByMessageId: fixture.journalMessageId,
    label: "fixture label",
    expectsCompletion: false,
  });
  assert.deepEqual(eve.composed, [
    {
      origin: ORIGIN,
      caller: { kind: EVE_CALLER.DEPLOYMENT, secret: SECRET, account: fixture.userId },
    },
  ]);
  assert.deepEqual(eve.opened, [
    {
      conversationId: outcome.receipt.childId,
      turn: BRAIN_HOST_TURN.CHILD_TASK,
      message: `${BRAIN_INPUT_MARKER.SUBAGENT_TASK} fixture task`,
    },
  ]);
  assert.deepEqual(seams.reports, []);

  // Without a label the child is unnamed, and the completion is expected unless the ask says otherwise.
  const plain = await withAccess(seams, (access) => access.spawn(SPAWN));
  assert.equal(plain.accepted, true);
  if (!plain.accepted) return;
  assert.deepEqual(await childRow(plain.receipt.childId), {
    parentConversationId: fixture.conversationId,
    spawnedByMessageId: fixture.journalMessageId,
    label: null,
    expectsCompletion: true,
  });
});

test("a spawn hangs from the turn's received line while the journal is not yet written, and from nothing is refused", async () => {
  const fixture = await standing();
  const bare = await insertTurn(database.run, {
    userId: fixture.userId,
    conversationId: fixture.conversationId,
    origin: TURN_ORIGIN.SPOKEN,
    status: TURN_STATUS.RUNNING,
    queuedAt: at(3),
    startedAt: at(3),
  });
  const eve = fakeEve();
  const unjournaled = await withAccess({ ...seamsOf(fixture, eve), turnId: bare }, (access) =>
    access.spawn(SPAWN),
  );
  assert.deepEqual(unjournaled, {
    accepted: false,
    reason: CHILD_SPAWN_REFUSAL.PERSISTENCE,
    detail: "no message of this turn stands to spawn the child from",
  });
  assert.deepEqual(eve.opened, []);

  const received = await insertMessage(database.run, {
    userId: fixture.userId,
    conversationId: fixture.conversationId,
    seq: 3,
    turnId: bare,
    clientId: randomUUID(),
    role: MESSAGE_ROLE.USER,
    parts: [{ type: UI_PART_TYPE.TEXT, text: "fixture ask" }],
    metadata: userMetadataOf(BRAIN_TURN_TRIGGER.ASK, undefined),
    createdAt: at(3),
    finishedAt: at(3),
  });
  const outcome = await withAccess({ ...seamsOf(fixture, eve), turnId: bare }, (access) =>
    access.spawn(SPAWN),
  );
  assert.equal(outcome.accepted, true);
  if (!outcome.accepted) return;
  assert.equal((await childRow(outcome.receipt.childId))?.spawnedByMessageId, received);
});

test("a child conversation is refused at the depth cap before the opener hears of it", async () => {
  const fixture = await standing(CONVERSATION_KIND.CHILD);
  const eve = fakeEve();
  const outcome = await withAccess(seamsOf(fixture, eve, {}, CONVERSATION_KIND.CHILD), (access) =>
    access.spawn(SPAWN),
  );
  assert.deepEqual(outcome, { accepted: false, reason: CHILD_SPAWN_REFUSAL.DEPTH_CAP });
  assert.deepEqual(eve.opened, []);
});

test("a spawn is refused once the conversation, then the account, has its share of children under way; ended children do not count", async () => {
  const fixture = await standing();
  const eve = fakeEve();
  const seams = seamsOf(fixture, eve);
  for (let index = 1; index < HOSTED_CHILDREN.MAXIMUM_ACTIVE_PER_REQUESTER; index += 1) {
    await childOf(fixture, { createdAt: at(index) });
  }
  await childOf(fixture, {
    turn: { status: TURN_STATUS.SETTLED, startedAt: at(20), settledAt: at(21) },
  });
  await childOf(fixture, { turn: { status: TURN_STATUS.FAILED, settledAt: at(21) } });

  // Four under way and two ended: one more is allowed, and it is the fifth under way.
  const fifth = await withAccess(seams, (access) => access.spawn(SPAWN));
  assert.equal(fifth.accepted, true);
  const sixth = await withAccess(seams, (access) => access.spawn(SPAWN));
  assert.deepEqual(sixth, { accepted: false, reason: CHILD_SPAWN_REFUSAL.REQUESTER_LIMIT });

  // Another conversation of the account is under its own limit, but the account is at its.
  const otherConversation = await elsewhereIn(fixture.userId);
  const otherStanding: Standing = { ...fixture, conversationId: otherConversation };
  const perRequester = HOSTED_CHILDREN.MAXIMUM_ACTIVE_PER_REQUESTER;
  for (let index = 0; index < HOSTED_CHILDREN.MAXIMUM_ACTIVE_GLOBAL - perRequester; index += 1) {
    await childOf(otherStanding, {
      parentConversationId: otherConversation,
      createdAt: at(30 + index),
    });
  }
  const ninth = await withAccess(seamsOf(otherStanding, eve), (access) => access.spawn(SPAWN));
  assert.deepEqual(ninth, { accepted: false, reason: CHILD_SPAWN_REFUSAL.GLOBAL_LIMIT });
  assert.equal(eve.opened.length, 1);
});

test("the opener's refusal is answered as the nearest spawn refusal, with the opener's words as its detail", async () => {
  const fixture = await standing();
  const eve = fakeEve();
  const unconfigured = await withAccess(
    seamsOf(fixture, eve, { deploymentSecret: () => undefined }),
    (access) => access.spawn(SPAWN),
  );
  assert.deepEqual(unconfigured, {
    accepted: false,
    reason: CHILD_SPAWN_REFUSAL.STOPPED,
    detail: CHILD_OPEN_REFUSAL.UNCONFIGURED,
  });

  const refusing = fakeEve({ open: { outcome: EVE_SEND_OUTCOME.FAILED, status: 503 } });
  const refused = await withAccess(seamsOf(fixture, refusing), (access) => access.spawn(SPAWN));
  assert.deepEqual(refused, {
    accepted: false,
    reason: CHILD_SPAWN_REFUSAL.PERSISTENCE,
    detail: CHILD_OPEN_REFUSAL.EVE_REFUSED,
  });
  assert.deepEqual(eve.opened, []);
});

test("the list answers this conversation's children as run records, newest first, and none of another's", async () => {
  const fixture = await standing();
  const running = await childOf(fixture, {
    label: "fixture running",
    createdAt: at(10),
    task: "fixture running task",
    turn: { status: TURN_STATUS.RUNNING, eveTurnId: EVE_TURN_ID, startedAt: at(12) },
  });
  const settled = await childOf(fixture, {
    createdAt: at(20),
    turn: { status: TURN_STATUS.SETTLED, startedAt: at(21), settledAt: at(22) },
  });
  const failed = await childOf(fixture, {
    createdAt: at(30),
    turn: { status: TURN_STATUS.FAILED, settledAt: at(31), failure: "fixture failure" },
  });
  const elsewhere = await elsewhereIn(fixture.userId);
  await childOf(fixture, { parentConversationId: elsewhere, createdAt: at(40) });

  const listed = await withAccess(seamsOf(fixture, fakeEve()), (access) => access.list());
  const expected: ChildRunRecord[] = [
    {
      childId: failed.childId,
      status: CHILD_RUN_STATUS.FAILED,
      acceptedAt: NOW + 30,
      settledAt: NOW + 31,
      failureDetail: "fixture failure",
    },
    {
      childId: settled.childId,
      status: CHILD_RUN_STATUS.SETTLED,
      acceptedAt: NOW + 20,
      settledAt: NOW + 22,
    },
    {
      childId: running.childId,
      label: "fixture running",
      status: CHILD_RUN_STATUS.RUNNING,
      acceptedAt: NOW + 10,
    },
  ];
  assert.deepEqual(listed, expected);
});

test("a cancel reaches eve for the child's turn under way and stamps its row; a child not this conversation's is nothing", async () => {
  const fixture = await standing();
  const eve = fakeEve();
  const seams = seamsOf(fixture, eve);
  const running = await childOf(fixture, {
    runtimeSessionId: SESSION_ID,
    turn: { status: TURN_STATUS.RUNNING, eveTurnId: EVE_TURN_ID, startedAt: at(12) },
  });

  const cancelled = await withAccess(seams, (access) => access.cancel(running.childId));
  assert.deepEqual(cancelled, { ok: true, remaining: [] });
  assert.deepEqual(eve.cancelled, [{ sessionId: SESSION_ID, eveTurnId: EVE_TURN_ID }]);
  assert.ok(running.turnId);
  assert.deepEqual((await readTurnById(database.run, running.turnId))?.cancelRequestedAt, at(0));

  // Another conversation's child, of this account or another, is no child of this one.
  const elsewhere = await elsewhereIn(fixture.userId);
  const foreign = await childOf(fixture, {
    parentConversationId: elsewhere,
    runtimeSessionId: SESSION_ID,
    turn: { status: TURN_STATUS.RUNNING, eveTurnId: "turn_9", startedAt: at(12) },
  });
  assert.equal(await withAccess(seams, (access) => access.cancel(foreign.childId)), undefined);
  const another = await standing();
  const anothers = await childOf(another, {
    runtimeSessionId: SESSION_ID,
    turn: { status: TURN_STATUS.RUNNING, eveTurnId: "turn_9", startedAt: at(12) },
  });
  assert.equal(await withAccess(seams, (access) => access.cancel(anothers.childId)), undefined);
  assert.equal(await withAccess(seams, (access) => access.cancel(randomUUID())), undefined);
  assert.equal(eve.cancelled.length, 1);
});

test("a cancel eve refuses is answered as remaining; an ended child as done; a child with no turn to name is dropped, so it is listed by nothing and counts against no bound", async () => {
  const fixture = await standing();
  const refusing = fakeEve({ cancel: { outcome: EVE_CANCEL_OUTCOME.FAILED, status: 502 } });
  const seams = seamsOf(fixture, refusing);
  const running = await childOf(fixture, {
    runtimeSessionId: SESSION_ID,
    turn: { status: TURN_STATUS.RUNNING, eveTurnId: EVE_TURN_ID, startedAt: at(12) },
  });
  assert.deepEqual(await withAccess(seams, (access) => access.cancel(running.childId)), {
    ok: false,
    remaining: [running.childId],
  });
  assert.ok(running.turnId);
  assert.equal((await readTurnById(database.run, running.turnId))?.cancelRequestedAt, null);
  assert.equal(seams.reports.length, 1);

  // Accepted and never started, with and without the session eve's start claimed for it: no turn
  // names anything eve can cancel, so the row is stamped as Clear stamps one and the cancel is done.
  const accepted = await childOf(fixture, { createdAt: at(20) });
  const claimed = await childOf(fixture, { createdAt: at(21), runtimeSessionId: SESSION_ID });
  for (const child of [accepted, claimed]) {
    assert.deepEqual(await withAccess(seams, (access) => access.cancel(child.childId)), {
      ok: true,
      remaining: [],
    });
    const rows = await readConversationById(database.run, child.childId);
    assert.deepEqual(instantColumn(rows[0]?.deleted_at), at(0));
    assert.equal(await withAccess(seams, (access) => access.cancel(child.childId)), undefined);
  }
  assert.deepEqual(
    (await withAccess(seams, (access) => access.list())).map((child) => child.childId),
    [running.childId],
  );

  const ended = await childOf(fixture, {
    createdAt: at(30),
    runtimeSessionId: SESSION_ID,
    turn: { status: TURN_STATUS.SETTLED, eveTurnId: EVE_TURN_ID, settledAt: at(31) },
  });
  assert.deepEqual(await withAccess(seams, (access) => access.cancel(ended.childId)), {
    ok: true,
    remaining: [],
  });
  assert.equal(refusing.cancelled.length, 1);
});

test("the conversations are the account's main, observed, and child conversations, keyed and named", async () => {
  const fixture = await standing();
  const observedSession = randomUUID();
  const observed = await insertConversation(database.run, {
    userId: fixture.userId,
    kind: CONVERSATION_KIND.OBSERVED,
    providerId: "conductor",
    providerSessionId: observedSession,
    createdAt: at(5),
  });
  const labelled = await childOf(fixture, { label: "fixture label", createdAt: at(10) });
  const unlabelled = await childOf(fixture, { createdAt: at(20) });
  await database.createUser().then((other) => insertConversation(database.run, { userId: other }));

  const listed = await withAccess(seamsOf(fixture, fakeEve()), (access) => access.conversations());
  const byKey = new Map(listed.map((record) => [record.sessionKey, record]));
  assert.equal(listed.length, 4);
  assert.deepEqual(byKey.get(sessionKey(fixture.conversationId)), {
    sessionKey: sessionKey(fixture.conversationId),
    kind: RECORD_CONVERSATION_KIND.MAIN,
    name: "main",
    createdAt: NOW,
    lastActivityAt: byKey.get(sessionKey(fixture.conversationId))?.lastActivityAt,
  });
  assert.equal(byKey.get(sessionKey(observed))?.kind, RECORD_CONVERSATION_KIND.OBSERVED);
  assert.equal(byKey.get(sessionKey(observed))?.name, observedSession);
  assert.equal(byKey.get(childSessionKey(labelled.childId))?.kind, RECORD_CONVERSATION_KIND.CHILD);
  assert.equal(byKey.get(childSessionKey(labelled.childId))?.name, "fixture label");
  assert.equal(byKey.get(childSessionKey(unlabelled.childId))?.name, `Child ${unlabelled.childId}`);
  // The directory read stops at its limit, newest activity first, the same order the access lists.
  const whole = await database.run(
    conversationDirectory(fixture.userId, HOSTED_CHILDREN.DIRECTORY_LIMIT),
  );
  const bounded = await database.run(conversationDirectory(fixture.userId, 2));
  assert.equal(whole.length, 4);
  assert.deepEqual(bounded, whole.slice(0, 2));
  // The access names its own conversation by the same key the listing does.
  assert.equal(
    await withAccess(seamsOf(fixture, fakeEve()), (access) => Effect.succeed(access.sessionKey)),
    sessionKey(fixture.conversationId),
  );
});

test("the lines are a child's own recent words, oldest first and bounded, and nothing for a child not this conversation's", async () => {
  const fixture = await standing();
  const child = await childOf(fixture, { task: "fixture one" });
  const line = (seq: number, role: string, text: string | undefined, author: string) =>
    insertMessage(database.run, {
      userId: fixture.userId,
      conversationId: child.childId,
      seq,
      clientId: randomUUID(),
      role,
      parts: text === undefined ? [] : [{ type: UI_PART_TYPE.TEXT, text }],
      metadata: { author },
      createdAt: at(seq),
      finishedAt: at(seq),
    });
  await line(2, MESSAGE_ROLE.ASSISTANT, "fixture two", MESSAGE_AUTHOR.BRAIN);
  // A message with no words of its own, a step of tool calls alone, is no line and spends none of the bound.
  await line(3, MESSAGE_ROLE.ASSISTANT, undefined, MESSAGE_AUTHOR.BRAIN);
  await line(4, MESSAGE_ROLE.ASSISTANT, "fixture three", MESSAGE_AUTHOR.BRAIN);
  const seams = seamsOf(fixture, fakeEve());

  assert.deepEqual(await withAccess(seams, (access) => access.lines(child.childId, 2)), [
    "fixture two",
    "fixture three",
  ]);
  assert.deepEqual(await withAccess(seams, (access) => access.lines(child.childId, 10)), [
    "fixture one",
    "fixture two",
    "fixture three",
  ]);

  const elsewhere = await elsewhereIn(fixture.userId);
  const foreign = await childOf(fixture, {
    parentConversationId: elsewhere,
    task: "fixture other",
  });
  assert.equal(await withAccess(seams, (access) => access.lines(foreign.childId, 10)), undefined);
});
