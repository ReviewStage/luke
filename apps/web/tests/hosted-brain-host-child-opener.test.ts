import assert from "node:assert/strict";
import { Effect, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import type { SessionAuthContext } from "eve/context";
import { afterAll, test } from "vitest";
import { MESSAGE_ROLE } from "../server/core";
import { CONVERSATION_KIND } from "../server/db/storage-vocabulary";
import { BRAIN_HOST_ATTRIBUTE, BRAIN_HOST_TURN } from "../server/hosted/brain-host/bounds";
import {
  CHILD_OPEN_REFUSAL,
  type ChildOpenerSeams,
  type ChildSpawn,
  type ChildTurn,
  openChild,
} from "../server/hosted/brain-host/child-opener";
import { admitConversation, SESSION_STANDING } from "../server/hosted/brain-host/conversation";
import {
  EVE_CALLER,
  EVE_SEND_OUTCOME,
  type EveMessage,
  type EveSessions,
  type EveSessionsOptions,
} from "../server/hosted/brain-host/eve-sessions";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import { insertConversation, insertMessage } from "./support/store-rows";

/**
 * The child opener over the real migrations on PGlite, against a fake eve:
 * what a delegation writes down, what it hands eve and as whom, and what a
 * refusal leaves behind. Synthetic fixtures throughout — the task and the
 * label are fixture words. Every account here is one the test created,
 * since the store suite shares one database on CI.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const NOW = Date.parse("2026-09-15T09:00:00.000Z");
const ORIGIN = "https://luke.test";
const SECRET = "deployment-secret-fixture";
const SESSION_ID = "wrun_01M000000000000000000CHILD";

const ChildRowSchema = Schema.Struct({
  kind: Schema.String,
  userId: Schema.String,
  parentConversationId: Schema.NullOr(Schema.String),
  spawnedByMessageId: Schema.NullOr(Schema.String),
  label: Schema.NullOr(Schema.String),
  expectsCompletion: Schema.NullOr(Schema.Boolean),
  runtimeSessionId: Schema.NullOr(Schema.String),
}).pipe(
  Schema.encodeKeys({
    userId: "user_id",
    parentConversationId: "parent_conversation_id",
    spawnedByMessageId: "spawned_by_message_id",
    expectsCompletion: "expects_completion",
    runtimeSessionId: "runtime_session_id",
  }),
);

async function childRow(childId: string) {
  const rows = await database.run(
    Effect.flatMap(
      SqlClient.SqlClient,
      (sql) => sql`
        select kind, user_id, parent_conversation_id, spawned_by_message_id, label,
               expects_completion, runtime_session_id
        from conversations where id = ${childId}
      `,
    ),
  );
  return rows[0] === undefined ? undefined : Schema.decodeUnknownSync(ChildRowSchema)(rows[0]);
}

async function childrenOf(parentId: string): Promise<number> {
  const rows = await database.run(
    Effect.flatMap(
      SqlClient.SqlClient,
      (sql) => sql`select id from conversations where parent_conversation_id = ${parentId}`,
    ),
  );
  return rows.length;
}

/** An account with a standing main and one user message in it, the message a delegation would spawn from. */
async function delegating(): Promise<{ userId: string; parentId: string; messageId: string }> {
  const userId = await database.createUser();
  const parentId = await insertConversation(database.run, { userId, createdAt: new Date(NOW) });
  const messageId = await insertMessage(database.run, {
    userId,
    conversationId: parentId,
    seq: 1,
    clientId: `ask-${parentId}`,
    role: MESSAGE_ROLE.USER,
    parts: [],
  });
  return { userId, parentId, messageId };
}

type Opened = Awaited<ReturnType<EveSessions<ChildTurn>["open"]>>;

const ACCEPTING: Opened = { outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId: SESSION_ID };

/** A fake eve recording how it was composed and what it was handed, answering every open as the test says. */
function fakeEve(answer: () => Promise<Opened> = () => Promise.resolve(ACCEPTING)) {
  const composed: EveSessionsOptions[] = [];
  const opened: EveMessage<ChildTurn>[] = [];
  const eve: ChildOpenerSeams["eve"] = (options) => {
    composed.push(options);
    return {
      open(message) {
        opened.push(message);
        return answer();
      },
      send: () => {
        throw new Error("the child opener sends nothing");
      },
      cancel: () => {
        throw new Error("the child opener cancels nothing");
      },
    };
  };
  return { eve, composed, opened };
}

function seams(
  overrides: Partial<ChildOpenerSeams> = {},
): ChildOpenerSeams & { reports: string[] } {
  const reports: string[] = [];
  return {
    deploymentSecret: () => SECRET,
    eveOrigin: () => ORIGIN,
    eve: fakeEve().eve,
    now: () => NOW,
    report: (message) => reports.push(message),
    ...overrides,
    reports,
  };
}

function spawn(
  fixture: { userId: string; parentId: string; messageId: string },
  overrides: Partial<ChildSpawn> = {},
): ChildSpawn {
  return {
    parent: { userId: fixture.userId, conversationId: fixture.parentId },
    spawnedByMessageId: fixture.messageId,
    task: "fixture task",
    label: "fixture label",
    expectsCompletion: true,
    ...overrides,
  };
}

function principal(id: string, conversationId: string): SessionAuthContext {
  return {
    principalId: id,
    principalType: "user",
    authenticator: "test",
    attributes: { [BRAIN_HOST_ATTRIBUTE.CONVERSATION]: conversationId },
  };
}

test("a delegation inserts the child under its parent and hands eve the task as the deployment", async () => {
  const fixture = await delegating();
  const eve = fakeEve();
  const opener = seams({ eve: eve.eve });

  const answer = await database.run(openChild(opener, spawn(fixture)));
  assert.equal(answer.ok, true);
  if (!answer.ok) return;
  assert.equal(answer.sessionId, SESSION_ID);

  assert.deepEqual(await childRow(answer.childId), {
    kind: CONVERSATION_KIND.CHILD,
    userId: fixture.userId,
    parentConversationId: fixture.parentId,
    spawnedByMessageId: fixture.messageId,
    label: "fixture label",
    expectsCompletion: true,
    runtimeSessionId: SESSION_ID,
  });
  assert.deepEqual(eve.composed, [
    {
      origin: ORIGIN,
      caller: { kind: EVE_CALLER.DEPLOYMENT, secret: SECRET, account: fixture.userId },
    },
  ]);
  assert.deepEqual(eve.opened, [
    { conversationId: answer.childId, turn: BRAIN_HOST_TURN.CHILD_TASK, message: "fixture task" },
  ]);
  assert.deepEqual(opener.reports, []);

  // The session eve opened is admitted against the child's row as any recorded session is, the row
  // naming its kind, and a session that is not the recorded one is refused.
  const auth = principal(fixture.userId, answer.childId);
  const admitted = await database.run(
    admitConversation(
      { current: auth, initiator: auth },
      { id: SESSION_ID, standing: SESSION_STANDING.CURRENT },
    ),
  );
  assert.equal(admitted.ok, true);
  if (!admitted.ok) return;
  assert.equal(admitted.kind, CONVERSATION_KIND.CHILD);
  assert.deepEqual(admitted.target, { userId: fixture.userId, conversationId: answer.childId });
  assert.equal(admitted.runtimeSessionId, SESSION_ID);
  const other = await database.run(
    admitConversation(
      { current: auth, initiator: auth },
      { id: "wrun_01M000000000000000000OTHER", standing: SESSION_STANDING.CURRENT },
    ),
  );
  assert.equal(other.ok, false);
});

test("a child without a label or an awaited completion records neither", async () => {
  const fixture = await delegating();
  const { label, ...unlabeled } = spawn(fixture, { expectsCompletion: false });
  assert.equal(label, "fixture label");
  const answer = await database.run(openChild(seams(), unlabeled));
  assert.equal(answer.ok, true);
  if (!answer.ok) return;
  const row = await childRow(answer.childId);
  assert.equal(row?.label, null);
  assert.equal(row?.expectsCompletion, false);
});

test("a deployment with no secret or no origin opens nothing and inserts nothing", async () => {
  const fixture = await delegating();
  const eve = fakeEve();
  for (const missing of [
    { deploymentSecret: () => undefined },
    { eveOrigin: () => undefined },
  ] satisfies Partial<ChildOpenerSeams>[]) {
    const opener = seams({ eve: eve.eve, ...missing });
    assert.deepEqual(await database.run(openChild(opener, spawn(fixture))), {
      ok: false,
      refusal: CHILD_OPEN_REFUSAL.UNCONFIGURED,
    });
    assert.equal(opener.reports.length, 1);
  }
  assert.equal(await childrenOf(fixture.parentId), 0);
  assert.deepEqual(eve.composed, []);
});

test("a refused open and an open that never answered each leave no child behind", async () => {
  const fixture = await delegating();
  const refusing = fakeEve(() =>
    Promise.resolve({ outcome: EVE_SEND_OUTCOME.FAILED, status: 503 }),
  );
  const refused = seams({ eve: refusing.eve });
  assert.deepEqual(await database.run(openChild(refused, spawn(fixture))), {
    ok: false,
    refusal: CHILD_OPEN_REFUSAL.EVE_REFUSED,
  });
  assert.equal(refusing.opened.length, 1);
  assert.match(refused.reports[0] ?? "", /status 503/);

  const throwing = fakeEve(() => Promise.reject(new Error("fixture: eve unreachable")));
  const unreachable = seams({ eve: throwing.eve });
  assert.deepEqual(await database.run(openChild(unreachable, spawn(fixture))), {
    ok: false,
    refusal: CHILD_OPEN_REFUSAL.EVE_REFUSED,
  });
  assert.match(unreachable.reports[0] ?? "", /eve unreachable/);

  assert.equal(await childrenOf(fixture.parentId), 0);
});

test("a parent that does not stand for the account inserts no child and asks eve nothing", async () => {
  const fixture = await delegating();
  const other = await database.createUser();
  const cleared = await insertConversation(database.run, {
    userId: fixture.userId,
    deletedAt: new Date(NOW),
  });
  const eve = fakeEve();
  const opener = seams({ eve: eve.eve });

  const foreign = await database.run(
    openChild(
      opener,
      spawn(fixture, { parent: { userId: other, conversationId: fixture.parentId } }),
    ),
  );
  assert.deepEqual(foreign, { ok: false, refusal: CHILD_OPEN_REFUSAL.NO_PARENT });
  const stamped = await database.run(
    openChild(
      opener,
      spawn(fixture, { parent: { userId: fixture.userId, conversationId: cleared } }),
    ),
  );
  assert.deepEqual(stamped, { ok: false, refusal: CHILD_OPEN_REFUSAL.NO_PARENT });

  assert.equal(await childrenOf(fixture.parentId), 0);
  assert.equal(await childrenOf(cleared), 0);
  assert.deepEqual(eve.composed, []);
  assert.equal(opener.reports.length, 2);
});
