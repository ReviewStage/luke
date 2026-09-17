import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Effect, Fiber, Result, Schema } from "effect";
import type { SessionAuthContext } from "eve/context";
import { afterAll, test } from "vitest";
import { MESSAGE_ROLE } from "../server/core";
import { db } from "../server/db/query";
import { conversations } from "../server/db/storage-schema";
import { CONVERSATION_KIND } from "../server/db/storage-vocabulary";
import { BRAIN_HOST_ATTRIBUTE, BRAIN_HOST_TURN } from "../server/hosted/brain-host/bounds";
import {
  CHILD_OPEN_REFUSAL,
  type ChildOpenerSeams,
  type ChildSpawn,
  type ChildTurn,
  openChild,
} from "../server/hosted/brain-host/child-opener";
import {
  admitConversation,
  claimRuntimeSession,
  SESSION_STANDING,
} from "../server/hosted/brain-host/conversation";
import {
  EVE_CALLER,
  EVE_SEND_OUTCOME,
  type EveMessage,
  type EveSessions,
  type EveSessionsOptions,
  type EveUnreachable,
} from "../server/hosted/brain-host/eve-sessions";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import { eveUnreachable } from "./support/no-network";
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
});

async function childRow(childId: string) {
  const rows = await database.run(
    db
      .select({
        kind: conversations.kind,
        userId: conversations.userId,
        parentConversationId: conversations.parentConversationId,
        spawnedByMessageId: conversations.spawnedByMessageId,
        label: conversations.label,
        expectsCompletion: conversations.expectsCompletion,
        runtimeSessionId: conversations.runtimeSessionId,
      })
      .from(conversations)
      .where(eq(conversations.id, childId)),
  );
  return rows[0] === undefined ? undefined : Schema.decodeUnknownSync(ChildRowSchema)(rows[0]);
}

/** How the parent's children stand: the rows nothing stamped, and the rows a refusal stamped. */
async function childrenOf(parentId: string): Promise<{ standing: number; stamped: number }> {
  const rows = await database.run(
    db
      .select({ deletedAt: conversations.deletedAt })
      .from(conversations)
      .where(eq(conversations.parentConversationId, parentId)),
  );
  const stamped = rows.filter((row) => row.deletedAt !== null).length;
  return { standing: rows.length - stamped, stamped };
}

/** An account with a standing main and one user message in it, the message a delegation would spawn from. */
async function delegating(): Promise<{ userId: string; parentId: string; messageId: string }> {
  const userId = await database.createUser();
  const parentId = await insertConversation(database.run, { userId, createdAt: new Date(NOW) });
  const messageId = await insertMessage(database.run, {
    userId,
    conversationId: parentId,
    seq: 1,
    clientId: randomUUID(),
    role: MESSAGE_ROLE.USER,
    parts: [],
  });
  return { userId, parentId, messageId };
}

type Opened = Effect.Success<ReturnType<EveSessions<ChildTurn>["open"]>>;
type Answer = () => Effect.Effect<Opened, EveUnreachable>;

const ACCEPTING: Opened = { outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId: SESSION_ID };

/** A fake eve recording how it was composed and what it was handed, answering every open as the test says. */
function fakeEve(answer: Answer = () => Effect.succeed(ACCEPTING)) {
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
  assert.ok(Result.isSuccess(answer));
  if (!Result.isSuccess(answer)) return;
  assert.equal(answer.success.sessionId, SESSION_ID);

  assert.deepEqual(await childRow(answer.success.childId), {
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
    {
      conversationId: answer.success.childId,
      turn: BRAIN_HOST_TURN.CHILD_TASK,
      message: "fixture task",
    },
  ]);
  assert.deepEqual(opener.reports, []);

  // The session eve opened is admitted against the child's row as any recorded session is, the row
  // naming its kind, and a session that is not the recorded one is refused.
  const auth = principal(fixture.userId, answer.success.childId);
  const admitted = await database.run(
    admitConversation(
      { current: auth, initiator: auth },
      { id: SESSION_ID, standing: SESSION_STANDING.CURRENT },
    ),
  );
  assert.ok(Result.isSuccess(admitted));
  if (!Result.isSuccess(admitted)) return;
  assert.equal(admitted.success.kind, CONVERSATION_KIND.CHILD);
  assert.deepEqual(admitted.success.target, {
    userId: fixture.userId,
    conversationId: answer.success.childId,
  });
  assert.equal(admitted.success.runtimeSessionId, SESSION_ID);
  const other = await database.run(
    admitConversation(
      { current: auth, initiator: auth },
      { id: "wrun_01M000000000000000000OTHER", standing: SESSION_STANDING.CURRENT },
    ),
  );
  assert.ok(Result.isFailure(other));
});

test("a child without a label or an awaited completion records neither", async () => {
  const fixture = await delegating();
  const { label, ...unlabeled } = spawn(fixture, { expectsCompletion: false });
  assert.equal(label, "fixture label");
  const answer = await database.run(openChild(seams(), unlabeled));
  assert.ok(Result.isSuccess(answer));
  if (!Result.isSuccess(answer)) return;
  const row = await childRow(answer.success.childId);
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
    assert.deepEqual(
      await database.run(openChild(opener, spawn(fixture))),
      Result.fail(CHILD_OPEN_REFUSAL.UNCONFIGURED),
    );
    assert.equal(opener.reports.length, 1);
  }
  assert.deepEqual(await childrenOf(fixture.parentId), { standing: 0, stamped: 0 });
  assert.deepEqual(eve.composed, []);
});

test("a refused open and an open that never answered each stamp the child they opened", async () => {
  const fixture = await delegating();
  const refusing = fakeEve(() => Effect.succeed({ outcome: EVE_SEND_OUTCOME.FAILED, status: 503 }));
  const refused = seams({ eve: refusing.eve });
  assert.deepEqual(
    await database.run(openChild(refused, spawn(fixture))),
    Result.fail(CHILD_OPEN_REFUSAL.EVE_REFUSED),
  );
  assert.equal(refusing.opened.length, 1);
  assert.match(refused.reports[0] ?? "", /status 503/);

  const throwing = fakeEve(() => eveUnreachable(ORIGIN));
  const unreachable = seams({ eve: throwing.eve });
  assert.deepEqual(
    await database.run(openChild(unreachable, spawn(fixture))),
    Result.fail(CHILD_OPEN_REFUSAL.EVE_REFUSED),
  );
  assert.match(unreachable.reports[0] ?? "", /eve unreachable/);

  // Each stamped row is a cleared conversation: listed by nothing, and admitting no session.
  assert.deepEqual(await childrenOf(fixture.parentId), { standing: 0, stamped: 2 });
  assert.deepEqual(await database.run(database.store.directory.children(fixture.userId, 10)), []);
  const [refusedChild] = refusing.opened;
  assert.ok(refusedChild);
  const auth = principal(fixture.userId, refusedChild.conversationId);
  const admitted = await database.run(
    admitConversation(
      { current: auth, initiator: auth },
      { id: SESSION_ID, standing: SESSION_STANDING.CLAIMING },
    ),
  );
  assert.ok(Result.isFailure(admitted));
});

test("a session that claimed the child before eve's answer was read is the child's, whatever eve answered", async () => {
  const fixture = await delegating();
  const CLAIMED = "wrun_01M0000000000000000CLAIMED";
  const claiming = fakeEve(() =>
    Effect.gen(function* () {
      // eve started the session and its start claimed the row, and then the answer was lost.
      const [message] = claiming.opened;
      assert.ok(message);
      yield* Effect.promise(() =>
        database.run(
          claimRuntimeSession(
            { userId: fixture.userId, conversationId: message.conversationId },
            CLAIMED,
            new Date(NOW),
          ),
        ),
      );
      return yield* eveUnreachable(ORIGIN);
    }),
  );
  const opener = seams({ eve: claiming.eve });
  const answer = await database.run(openChild(opener, spawn(fixture)));
  assert.ok(Result.isSuccess(answer));
  if (!Result.isSuccess(answer)) return;
  assert.equal(answer.success.sessionId, CLAIMED);
  assert.deepEqual(await childrenOf(fixture.parentId), { standing: 1, stamped: 0 });
  assert.equal((await childRow(answer.success.childId))?.runtimeSessionId, CLAIMED);
  assert.equal(opener.reports.length, 2);
});

test("an open interrupted before eve answered stamps the child on its way out", async () => {
  const fixture = await delegating();
  const hanging = fakeEve(() => Effect.never);
  const opener = seams({ eve: hanging.eve });
  await database.run(
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(openChild(opener, spawn(fixture)));
      // The fork reaches eve before it is interrupted.
      yield* Effect.sleep("20 millis");
      assert.equal(hanging.opened.length, 1);
      yield* Fiber.interrupt(fiber);
    }),
  );
  assert.deepEqual(await childrenOf(fixture.parentId), { standing: 0, stamped: 1 });
});

test("a parent or a message that does not stand for the account inserts no child and asks eve nothing", async () => {
  const fixture = await delegating();
  const other = await database.createUser();
  const elsewhere = await delegating();
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
  assert.deepEqual(foreign, Result.fail(CHILD_OPEN_REFUSAL.NO_PARENT));
  const stamped = await database.run(
    openChild(
      opener,
      spawn(fixture, { parent: { userId: fixture.userId, conversationId: cleared } }),
    ),
  );
  assert.deepEqual(stamped, Result.fail(CHILD_OPEN_REFUSAL.NO_PARENT));
  // A message of another conversation, even one of the account's own parent, spawns nothing here.
  const otherMessage = await database.run(
    openChild(opener, spawn(fixture, { spawnedByMessageId: elsewhere.messageId })),
  );
  assert.deepEqual(otherMessage, Result.fail(CHILD_OPEN_REFUSAL.NO_PARENT));

  assert.deepEqual(await childrenOf(fixture.parentId), { standing: 0, stamped: 0 });
  assert.deepEqual(await childrenOf(cleared), { standing: 0, stamped: 0 });
  assert.deepEqual(eve.composed, []);
  assert.equal(opener.reports.length, 3);
});
