import assert from "node:assert/strict";
import { Effect, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { afterAll, test } from "vitest";
import {
  BRAIN_INPUT_MARKER,
  CHILD_COMPLETION_STATUS,
  MESSAGE_AUTHOR,
  MESSAGE_ROLE,
  TURN_ORIGIN,
  TURN_STATUS,
  unparsedWire,
  type WireRecord,
  wireRecord,
} from "../server/core";
import { CONVERSATION_KIND } from "../server/db/storage-vocabulary";
import { BRAIN_HOST_TURN } from "../server/hosted/brain-host/bounds";
import {
  CHILD_COMPLETION_DELIVERY,
  type ChildCompletionSeams,
  type CompletionTurn,
  deliverChildCompletion,
  NOTHING_DELIVERED,
  sweepChildCompletions,
} from "../server/hosted/brain-host/child-completion";
import {
  EVE_CALLER,
  EVE_SEND_OUTCOME,
  type EveMessage,
  type EveSessions,
  type EveSessionsOptions,
} from "../server/hosted/brain-host/eve-sessions";
import { CATALOG_TOOL_SET } from "../server/hosted/brain-tool-set";
import type { ConversationTarget } from "../server/hosted/store";
import { InstantColumnSchema } from "../server/hosted/store/database";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import { insertConversation, insertMessage, insertTurn } from "./support/store-rows";

/**
 * The child completion over the real migrations on PGlite, against a fake
 * eve: the mark that precedes the send, what the parent is handed and as
 * whom, and what the sweep visits. Synthetic fixtures throughout — the
 * child's reply and its label are fixture words. Every account here is one
 * the test created, and the sweep is scoped to them, since the store suite
 * shares one database on CI.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const NOW = Date.parse("2026-09-15T10:00:00.000Z");
const ORIGIN = "https://luke.test";
const SECRET = "deployment-secret-fixture";
const PARENT_SESSION = "wrun_01M000000000000000000PARENT";
const OPENED_SESSION = "wrun_01M000000000000000000OPENED";

type Sent = Awaited<ReturnType<EveSessions<CompletionTurn>["send"]>>;
type Opened = Awaited<ReturnType<EveSessions<CompletionTurn>["open"]>>;

const SEND_ACCEPTED: Sent = {
  outcome: EVE_SEND_OUTCOME.ACCEPTED,
  sessionId: PARENT_SESSION,
  deliveryId: "delivery-1",
};
const OPEN_ACCEPTED: Opened = { outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId: OPENED_SESSION };

/** A fake eve recording how it was composed and what it was handed, answering as the test says. */
function fakeEve(answers: { send?: () => Sent; open?: () => Opened } = {}) {
  const composed: EveSessionsOptions[] = [];
  const sent: { sessionId: string; message: EveMessage<CompletionTurn> }[] = [];
  const opened: EveMessage<CompletionTurn>[] = [];
  const eve: ChildCompletionSeams["eve"] = (options) => {
    composed.push(options);
    return {
      send(sessionId, message) {
        sent.push({ sessionId, message });
        return Promise.resolve((answers.send ?? (() => SEND_ACCEPTED))());
      },
      open(message) {
        opened.push(message);
        return Promise.resolve((answers.open ?? (() => OPEN_ACCEPTED))());
      },
      cancel: () => {
        throw new Error("the completion cancels nothing");
      },
    };
  };
  return { eve, composed, sent, opened };
}

function seams(
  overrides: Partial<ChildCompletionSeams> = {},
): ChildCompletionSeams & { reports: string[] } {
  const reports: string[] = [];
  return {
    deploymentSecret: () => SECRET,
    eveOrigin: () => ORIGIN,
    eve: fakeEve().eve,
    tools: CATALOG_TOOL_SET,
    now: () => NOW,
    report: (message) => reports.push(message),
    ...overrides,
    reports,
  };
}

interface ChildFixture {
  /** How the child's latest turn stands; none for a child no turn has run yet. */
  readonly status?: (typeof TURN_STATUS)[keyof typeof TURN_STATUS] | null;
  readonly failure?: string;
  readonly label?: string;
  readonly expectsCompletion?: boolean;
  /** Whether the parent's row records a session; it does unless the test says otherwise. */
  readonly parentSession?: string | null;
  readonly reply?: string;
  readonly completionDeliveredAt?: Date;
  readonly userId?: string;
  readonly settledAt?: Date;
}

/**
 * An account with a parent and one child under it, the child's latest turn
 * as the fixture says and its journal holding the reply. The parent is an
 * observed conversation, since an account holds one standing main and a
 * test here opens several parents under one account.
 */
async function childOf(
  fixture: ChildFixture = {},
): Promise<{ child: ConversationTarget; parentId: string; turnId: string | undefined }> {
  const userId = fixture.userId ?? (await database.createUser());
  const parentId = await insertConversation(database.run, {
    userId,
    kind: CONVERSATION_KIND.OBSERVED,
    createdAt: new Date(NOW - 10_000),
    runtimeSessionId: fixture.parentSession === undefined ? PARENT_SESSION : fixture.parentSession,
  });
  const childId = await insertConversation(database.run, {
    userId,
    kind: CONVERSATION_KIND.CHILD,
    parentConversationId: parentId,
    createdAt: new Date(NOW - 5_000),
    ...(fixture.label !== undefined ? { label: fixture.label } : undefined),
    ...(fixture.expectsCompletion !== undefined
      ? { expectsCompletion: fixture.expectsCompletion }
      : undefined),
    ...(fixture.completionDeliveredAt !== undefined
      ? { completionDeliveredAt: fixture.completionDeliveredAt }
      : undefined),
  });
  const status = fixture.status === undefined ? TURN_STATUS.SETTLED : fixture.status;
  if (status === null)
    return { child: { userId, conversationId: childId }, parentId, turnId: undefined };
  const terminal = status !== TURN_STATUS.QUEUED && status !== TURN_STATUS.RUNNING;
  const turnId = await insertTurn(database.run, {
    userId,
    conversationId: childId,
    origin: TURN_ORIGIN.CHILD,
    status,
    queuedAt: new Date(NOW - 4_000),
    startedAt: status === TURN_STATUS.QUEUED ? null : new Date(NOW - 3_000),
    settledAt: terminal ? (fixture.settledAt ?? new Date(NOW - 1_000)) : null,
    ...(fixture.failure !== undefined ? { failure: fixture.failure } : undefined),
  });
  await insertMessage(database.run, {
    userId,
    conversationId: childId,
    seq: 1,
    turnId,
    clientId: turnId,
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [{ type: "text", text: fixture.reply ?? "The fixture task is done.", state: "done" }],
    metadata: { author: MESSAGE_AUTHOR.BRAIN },
    finishedAt: terminal ? new Date(NOW - 1_000) : null,
  });
  return { child: { userId, conversationId: childId }, parentId, turnId };
}

/** The stamp as either dialect hands the column back: a `Date` from Postgres, a string from PGlite. */
const StampRowSchema = Schema.Struct({
  completionDeliveredAt: Schema.NullOr(InstantColumnSchema),
}).pipe(Schema.encodeKeys({ completionDeliveredAt: "completion_delivered_at" }));

async function stampOf(child: ConversationTarget): Promise<number | null> {
  const rows = await database.run(
    Effect.flatMap(
      SqlClient.SqlClient,
      (sql) =>
        sql`select completion_delivered_at from conversations where id = ${child.conversationId}`,
    ),
  );
  const row = Schema.decodeUnknownSync(StampRowSchema)(rows[0]);
  return row.completionDeliveredAt === null ? null : row.completionDeliveredAt.getTime();
}

/** The completion item's body as data: the JSON behind its marker line. */
function bodyOf(message: EveMessage<CompletionTurn>): WireRecord {
  const [marker, ...rest] = message.message.split("\n");
  assert.equal(marker, `${BRAIN_INPUT_MARKER.CHILD_COMPLETION} ${new Date(NOW).toISOString()}`);
  const body = wireRecord(unparsedWire(JSON.parse(rest.join("\n"))));
  assert.ok(body);
  return body;
}

test("a settled child's completion is stamped, then sent once into the parent's recorded session as the deployment for the account; a second call finds the stamp and sends nothing", async () => {
  const { child, parentId } = await childOf({ label: "fixture label", reply: "Two tests fixed." });
  const eve = fakeEve();
  const s = seams({ eve: eve.eve });

  assert.equal(
    await database.run(deliverChildCompletion(s, child)),
    CHILD_COMPLETION_DELIVERY.DELIVERED,
  );
  assert.equal(await stampOf(child), NOW);
  assert.equal(eve.sent.length, 1);
  assert.equal(eve.opened.length, 0);
  const [handed] = eve.sent;
  assert.ok(handed);
  assert.equal(handed.sessionId, PARENT_SESSION);
  assert.equal(handed.message.conversationId, parentId);
  assert.equal(handed.message.turn, BRAIN_HOST_TURN.CHILD_COMPLETION);
  assert.deepEqual(bodyOf(handed.message), {
    child_id: child.conversationId,
    label: "fixture label",
    status: CHILD_COMPLETION_STATUS.COMPLETED,
    result: "Two tests fixed.",
    truncated: false,
  });
  assert.deepEqual(eve.composed, [
    {
      origin: ORIGIN,
      caller: { kind: EVE_CALLER.DEPLOYMENT, secret: SECRET, account: child.userId },
    },
  ]);
  assert.deepEqual(s.reports, []);

  // The relay's end re-emitted, or the sweep a minute later: the stamp stands and nothing is sent again.
  const again = seams({ eve: eve.eve, now: () => NOW + 60_000 });
  assert.equal(
    await database.run(deliverChildCompletion(again, child)),
    CHILD_COMPLETION_DELIVERY.NOTHING,
  );
  assert.equal(await stampOf(child), NOW);
  assert.equal(eve.sent.length, 1);
});

test("a parent with no recorded session, or one eve has retired, has a session opened for the completion", async () => {
  const unrecorded = await childOf({ parentSession: null });
  const eve = fakeEve();
  assert.equal(
    await database.run(deliverChildCompletion(seams({ eve: eve.eve }), unrecorded.child)),
    CHILD_COMPLETION_DELIVERY.DELIVERED,
  );
  assert.equal(eve.sent.length, 0);
  assert.equal(eve.opened.length, 1);
  assert.equal(eve.opened[0]?.conversationId, unrecorded.parentId);
  assert.equal(eve.opened[0]?.turn, BRAIN_HOST_TURN.CHILD_COMPLETION);

  const retired = await childOf();
  const retiring = fakeEve({ send: () => ({ outcome: EVE_SEND_OUTCOME.RETIRED }) });
  assert.equal(
    await database.run(deliverChildCompletion(seams({ eve: retiring.eve }), retired.child)),
    CHILD_COMPLETION_DELIVERY.DELIVERED,
  );
  assert.equal(retiring.sent.length, 1);
  assert.equal(retiring.opened.length, 1);
  assert.equal(retiring.opened[0]?.conversationId, retired.parentId);
});

test("a child still running, one no turn has run for, and one that is not a standing child of the account are left alone", async () => {
  const eve = fakeEve();
  const s = seams({ eve: eve.eve });
  for (const fixture of [
    { status: TURN_STATUS.RUNNING },
    { status: TURN_STATUS.QUEUED },
    { status: null },
  ] as const) {
    const { child } = await childOf(fixture);
    assert.equal(
      await database.run(deliverChildCompletion(s, child)),
      CHILD_COMPLETION_DELIVERY.NOTHING,
    );
    assert.equal(await stampOf(child), null);
  }
  const { child } = await childOf();
  const foreign = { userId: await database.createUser(), conversationId: child.conversationId };
  assert.equal(
    await database.run(deliverChildCompletion(s, foreign)),
    CHILD_COMPLETION_DELIVERY.NOTHING,
  );
  assert.equal(await stampOf(child), null);
  assert.equal(eve.sent.length + eve.opened.length, 0);
  assert.deepEqual(s.reports, []);
});

test("a child whose spawn expected no completion is stamped and nothing is sent", async () => {
  const { child } = await childOf({ expectsCompletion: false });
  const eve = fakeEve();
  assert.equal(
    await database.run(deliverChildCompletion(seams({ eve: eve.eve }), child)),
    CHILD_COMPLETION_DELIVERY.WITHHELD,
  );
  assert.equal(await stampOf(child), NOW);
  assert.equal(eve.sent.length + eve.opened.length, 0);
  assert.equal(
    await database.run(deliverChildCompletion(seams({ eve: eve.eve }), child)),
    CHILD_COMPLETION_DELIVERY.NOTHING,
  );
});

test("a failed run's completion says so with its failure; a send eve refuses after the mark is said, counted undelivered, and retried nowhere", async () => {
  const { child } = await childOf({
    status: TURN_STATUS.FAILED,
    failure: "model",
    reply: "Got as far as the second file.",
  });
  const eve = fakeEve({ send: () => ({ outcome: EVE_SEND_OUTCOME.FAILED, status: 503 }) });
  const s = seams({ eve: eve.eve });
  assert.equal(
    await database.run(deliverChildCompletion(s, child)),
    CHILD_COMPLETION_DELIVERY.UNDELIVERED,
  );
  assert.equal(await stampOf(child), NOW);
  assert.equal(eve.sent.length, 1);
  assert.equal(eve.opened.length, 0);
  const [handed] = eve.sent;
  assert.ok(handed);
  assert.deepEqual(bodyOf(handed.message), {
    child_id: child.conversationId,
    status: CHILD_COMPLETION_STATUS.FAILED,
    result: "Got as far as the second file.",
    truncated: false,
    failure: "model",
  });
  assert.equal(s.reports.length, 1);
  assert.match(s.reports[0] ?? "", /eve refused a child-completion turn/);

  assert.equal(
    await database.run(deliverChildCompletion(s, child)),
    CHILD_COMPLETION_DELIVERY.NOTHING,
  );
  assert.equal(eve.sent.length, 1);
});

test("a deployment holding no secret or no origin for eve claims nothing and sends nothing", async () => {
  const { child } = await childOf();
  const eve = fakeEve();
  for (const overrides of [
    { deploymentSecret: () => undefined },
    { eveOrigin: () => undefined },
  ] as const) {
    const s = seams({ eve: eve.eve, ...overrides });
    assert.equal(
      await database.run(deliverChildCompletion(s, child)),
      CHILD_COMPLETION_DELIVERY.NOTHING,
    );
    assert.equal(s.reports.length, 1);
    assert.deepEqual(await database.run(sweepChildCompletions(s, child.userId)), NOTHING_DELIVERED);
  }
  assert.equal(await stampOf(child), null);
  assert.equal(eve.sent.length + eve.opened.length, 0);
});

test("the sweep visits one account's ended, unstamped children oldest run first, counts each delivery, and leaves running, stamped, and other accounts' children alone", async () => {
  const userId = await database.createUser();
  const other = await database.createUser();
  const later = await childOf({ userId, settledAt: new Date(NOW - 500) });
  const earlier = await childOf({
    userId,
    status: TURN_STATUS.CANCELLED,
    settledAt: new Date(NOW - 2_000),
  });
  const running = await childOf({ userId, status: TURN_STATUS.RUNNING });
  const stamped = await childOf({ userId, completionDeliveredAt: new Date(NOW - 100) });
  const unexpected = await childOf({
    userId,
    expectsCompletion: false,
    settledAt: new Date(NOW - 1_500),
  });
  const elsewhere = await childOf({ userId: other, settledAt: new Date(NOW - 3_000) });
  const eve = fakeEve();
  const s = seams({ eve: eve.eve });

  assert.deepEqual(await database.run(sweepChildCompletions(s, userId)), {
    delivered: 2,
    undelivered: 0,
    withheld: 1,
  });
  assert.deepEqual(
    eve.sent.map((handed) => handed.message.conversationId),
    [earlier.parentId, later.parentId],
  );
  assert.equal(await stampOf(later.child), NOW);
  assert.equal(await stampOf(earlier.child), NOW);
  assert.equal(await stampOf(unexpected.child), NOW);
  assert.equal(await stampOf(running.child), null);
  assert.equal(await stampOf(stamped.child), NOW - 100);
  assert.equal(await stampOf(elsewhere.child), null);

  // The next tick finds every stamp standing and visits nothing.
  assert.deepEqual(await database.run(sweepChildCompletions(s, userId)), NOTHING_DELIVERED);
  assert.equal(eve.sent.length, 2);

  // The bound is honoured, oldest first, and a child past it is left standing for the next tick.
  const first = await childOf({ userId, settledAt: new Date(NOW - 3_000) });
  const second = await childOf({ userId, settledAt: new Date(NOW - 2_500) });
  assert.deepEqual(await database.run(sweepChildCompletions(s, userId, { limit: 1 })), {
    delivered: 1,
    undelivered: 0,
    withheld: 0,
  });
  assert.equal(await stampOf(first.child), NOW);
  assert.equal(await stampOf(second.child), null);
});

test("the mark precedes the send: a send that dies after the mark leaves the stamp standing and is retried nowhere, and two deliveries of one child racing send once", async () => {
  const dying = await childOf();
  const eve = fakeEve();
  let sends = 0;
  const unreachable: ChildCompletionSeams["eve"] = (options) => ({
    ...eve.eve(options),
    send: () => {
      sends += 1;
      return Promise.reject(new Error("eve unreachable"));
    },
  });
  const s = seams({ eve: unreachable });
  assert.equal(
    await database.run(deliverChildCompletion(s, dying.child)),
    CHILD_COMPLETION_DELIVERY.UNDELIVERED,
  );
  // The stamp landed although eve never answered: the mark is what committed first.
  assert.equal(await stampOf(dying.child), NOW);
  assert.equal(sends, 1);
  assert.equal(s.reports.length, 1);
  assert.match(s.reports[0] ?? "", /could not be handed over: .*eve unreachable/);
  assert.equal(
    await database.run(deliverChildCompletion(s, dying.child)),
    CHILD_COMPLETION_DELIVERY.NOTHING,
  );
  assert.equal(sends, 1);

  const racing = await childOf();
  const accepting = fakeEve();
  const raced = seams({ eve: accepting.eve });
  const deliveries = await database.run(
    Effect.all(
      [deliverChildCompletion(raced, racing.child), deliverChildCompletion(raced, racing.child)],
      {
        concurrency: "unbounded",
      },
    ),
  );
  assert.deepEqual([...deliveries].sort(), [
    CHILD_COMPLETION_DELIVERY.DELIVERED,
    CHILD_COMPLETION_DELIVERY.NOTHING,
  ]);
  assert.equal(accepting.sent.length, 1);
  assert.equal(await stampOf(racing.child), NOW);
});

test("two children of one parent with no recorded session end together: the first opens the parent's session and claims it under the parent's lock, the second sends into it", async () => {
  const userId = await database.createUser();
  const first = await childOf({ userId, parentSession: null, settledAt: new Date(NOW - 2_000) });
  const second = await childOf({
    userId,
    parentSession: null,
    settledAt: new Date(NOW - 1_000),
  });
  // One parent for both: the second child is moved under the first's parent.
  await database.run(
    Effect.flatMap(
      SqlClient.SqlClient,
      (sql) => sql`
        update conversations set parent_conversation_id = ${first.parentId}
        where id = ${second.child.conversationId}
      `,
    ),
  );
  const eve = fakeEve();
  const s = seams({ eve: eve.eve });

  // Delivered together, as the relay would deliver two ends landing in one instant. The test
  // database serialises transactions on its one connection, so what is exercised here is the
  // order the lock imposes on a Postgres with more than one: the second handover finds the
  // session the first claimed, whichever child's claim came first.
  const deliveries = await database.run(
    Effect.all([deliverChildCompletion(s, first.child), deliverChildCompletion(s, second.child)], {
      concurrency: "unbounded",
    }),
  );
  assert.deepEqual(deliveries, [
    CHILD_COMPLETION_DELIVERY.DELIVERED,
    CHILD_COMPLETION_DELIVERY.DELIVERED,
  ]);
  assert.equal(eve.opened.length, 1);
  assert.equal(eve.opened[0]?.conversationId, first.parentId);
  assert.equal(eve.sent.length, 1);
  assert.equal(eve.sent[0]?.sessionId, OPENED_SESSION);
  assert.equal(eve.sent[0]?.message.conversationId, first.parentId);
  const parentRow = await database.run(
    Effect.flatMap(
      SqlClient.SqlClient,
      (sql) => sql`select runtime_session_id from conversations where id = ${first.parentId}`,
    ),
  );
  assert.equal(parentRow[0]?.runtime_session_id, OPENED_SESSION);
});
