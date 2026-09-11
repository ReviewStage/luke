import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ASK_ORIGIN } from "@sidecar/hosted";
import { TURN_STATUS } from "@sidecar/wire";
import { eq } from "drizzle-orm";
import type { MessageStreamEvent } from "eve/client";
import { afterAll, test } from "vitest";
import { CONVERSATION_KIND, conversations } from "../server/db/storage-schema";
import { ASK_REFUSAL, acceptAsk, askStanding } from "../server/hosted/brain-ask";
import { BRAIN_HOST_TURN } from "../server/hosted/brain-host/bounds";
import {
  EVE_CANCEL_OUTCOME,
  EVE_SEND_OUTCOME,
  type EveSessions,
} from "../server/hosted/brain-host/eve-sessions";
import { hostTurnId } from "../server/hosted/brain-host/ids";
import {
  memoryRelayState,
  type RelayStanding,
  StreamRelay,
} from "../server/hosted/brain-host/relay";
import { CATALOG_TOOL_SET } from "../server/hosted/brain-tool-set";
import { storeWriter } from "../server/hosted/store";
import { askRecord } from "../server/hosted/store/asks";
import { stampedEveEvent } from "./support/eve-events";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";

/**
 * The ask record over the real migrations, and the two compositions that
 * stand on it: the ask accepted over the real record rather than a memory
 * one, and the relay binding eve's deliveries to the turn that ran them.
 * Every row here belongs to an account the test created, because on CI this
 * file shares one database with every other store file.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const NOW = 1_800_000_000_000;
const asks = askRecord(database.run);

async function conversation(userId: string): Promise<string> {
  const [row] = await database.db
    .insert(conversations)
    .values({ userId, kind: CONVERSATION_KIND.MAIN })
    .returning({ id: conversations.id });
  assert.ok(row);
  return row.id;
}

function write(userId: string, conversationId: string, clientId = randomUUID()) {
  return {
    userId,
    conversationId,
    clientId,
    origin: ASK_ORIGIN.TYPED,
    question: "what changed?",
    createdAt: new Date(NOW),
  };
}

test("an ask is recorded once per conversation and client id, by the index: two arrivals at once leave one row and both read it, and the same client id in another conversation is another ask", async () => {
  const userId = await database.createUser();
  const conversationId = await conversation(userId);
  const clientId = randomUUID();
  const [first, second] = await Promise.all([
    asks.record(write(userId, conversationId, clientId)),
    asks.record(write(userId, conversationId, clientId)),
  ]);
  assert.deepEqual(first, second);
  assert.equal(first.clientId, clientId);
  assert.equal(first.createdAt.getTime(), NOW);
  assert.equal(first.sessionId, undefined);
  const neighbour = await database.createUser();
  const elsewhere = await asks.record(write(neighbour, await conversation(neighbour), clientId));
  assert.notEqual(elsewhere.id, first.id);
});

test("a read is the account's own: an ask is named for its account and for nobody else, and the latest session is the newest by eve's sortable ids whichever ask holds it", async () => {
  const owner = await database.createUser();
  const other = await database.createUser();
  const conversationId = await conversation(owner);
  const earlier = await asks.record(write(owner, conversationId));
  const later = await asks.record({
    ...write(owner, conversationId),
    createdAt: new Date(NOW + 1),
  });
  assert.deepEqual(await asks.named(owner, earlier.id), earlier);
  assert.equal(await asks.named(other, earlier.id), undefined);
  assert.equal(await asks.latestSession(owner, conversationId), undefined);

  await asks.dispatchOnce({ userId: owner, conversationId }, earlier.id, async () => ({
    sessionId: "wrun_02_newer",
  }));
  await asks.dispatchOnce({ userId: owner, conversationId }, later.id, async () => ({
    sessionId: "wrun_01_older",
    deliveryId: "delivery-2",
  }));
  assert.equal(await asks.latestSession(owner, conversationId), "wrun_02_newer");
  assert.equal(await asks.latestSession(other, conversationId), undefined);
});

test("a second dispatch on an ask already handed to eve runs nothing and changes nothing; the first Stop stands", async () => {
  const userId = await database.createUser();
  const conversationId = await conversation(userId);
  const ask = await asks.record(write(userId, conversationId));
  const turnId = randomUUID();
  await asks.dispatchOnce({ userId, conversationId }, ask.id, async () => ({
    sessionId: "wrun_1",
    turnId,
  }));
  let ran = 0;
  const after = await asks.dispatchOnce({ userId, conversationId }, ask.id, async () => {
    ran += 1;
    return { sessionId: "wrun_2", deliveryId: "delivery-1" };
  });
  assert.equal(ran, 0);
  assert.equal(after.sessionId, "wrun_1");
  assert.equal(after.turnId, turnId);
  assert.equal(after.deliveryId, undefined);
  const undispatched = await asks.record(write(userId, conversationId));
  assert.equal(
    (await asks.dispatchOnce({ userId, conversationId }, undispatched.id, async () => undefined))
      .sessionId,
    undefined,
  );

  await asks.cancelRequested(ask.id, new Date(NOW + 5));
  await asks.cancelRequested(ask.id, new Date(NOW + 9));
  assert.equal((await asks.named(userId, ask.id))?.cancelRequestedAt?.getTime(), NOW + 5);
});

test("binding a turn's deliveries names the turn on each delivered ask not yet bound, answers those asks, and binds nothing when the start is emitted again", async () => {
  const userId = await database.createUser();
  const conversationId = await conversation(userId);
  const target = { userId, conversationId };
  const waiting = await asks.record(write(userId, conversationId));
  const alsoWaiting = await asks.record(write(userId, conversationId));
  const unrelated = await asks.record(write(userId, conversationId));
  await asks.dispatchOnce(target, waiting.id, async () => ({
    sessionId: "wrun_1",
    deliveryId: "delivery-a",
  }));
  await asks.dispatchOnce(target, alsoWaiting.id, async () => ({
    sessionId: "wrun_1",
    deliveryId: "delivery-b",
  }));
  await asks.dispatchOnce(target, unrelated.id, async () => ({
    sessionId: "wrun_1",
    deliveryId: "delivery-c",
  }));
  const turnId = randomUUID();

  const bound = await asks.bindDeliveries(target, ["delivery-a", "delivery-b"], turnId);
  assert.deepEqual(bound.map((ask) => ask.id).sort(), [waiting.id, alsoWaiting.id].sort());
  assert.ok(bound.every((ask) => ask.turnId === turnId));
  assert.equal((await asks.named(userId, unrelated.id))?.turnId, undefined);
  assert.deepEqual(await asks.bindDeliveries(target, ["delivery-a", "delivery-b"], turnId), []);
  assert.deepEqual(await asks.bindDeliveries(target, [], turnId), []);
});

function eveAccepting(
  sessionId: string,
): EveSessions & { readonly deliveries: string[]; opens: number } {
  const deliveries: string[] = [];
  const eve = {
    deliveries,
    opens: 0,
    async open() {
      eve.opens += 1;
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      return { outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId };
    },
    async send() {
      const deliveryId = `delivery-${deliveries.length + 1}`;
      deliveries.push(deliveryId);
      return { outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId, deliveryId };
    },
    async cancel() {
      return { outcome: EVE_CANCEL_OUTCOME.ACCEPTED };
    },
  };
  return eve;
}

test("two retries of one client id in flight together dispatch once: the second finds the session the first wrote under the row's lock, and both answer the same record", async () => {
  const userId = await database.createUser();
  const conversationId = await conversation(userId);
  const eve = eveAccepting(`wrun_${randomUUID()}`);
  const seams = { run: database.run, asks, eve, now: () => NOW };
  const input = {
    userId,
    conversationId,
    clientId: randomUUID(),
    question: "what changed?",
    origin: ASK_ORIGIN.TYPED,
  };
  const [first, second] = await Promise.all([acceptAsk(seams, input), acceptAsk(seams, input)]);
  assert.deepEqual(first, second);
  assert.ok(first.ok);
  assert.equal(eve.opens, 1);
  assert.deepEqual(eve.deliveries, []);
});

test("over the real record, a follow-up ask stands queued under its own id until eve's start names its delivery, and then reads as the turn it ran in", async () => {
  const userId = await database.createUser();
  const conversationId = await conversation(userId);
  const sessionId = `wrun_${randomUUID()}`;
  await database.db
    .update(conversations)
    .set({ runtimeSessionId: sessionId })
    .where(eq(conversations.id, conversationId));
  const eve = eveAccepting(sessionId);
  const seams = { run: database.run, asks, eve, now: () => NOW };
  const reads = { store: database.store, run: database.run, asks };
  const clientId = randomUUID();
  const accepted = await acceptAsk(seams, {
    userId,
    conversationId,
    clientId,
    question: "what changed?",
    origin: ASK_ORIGIN.TYPED,
  });
  assert.ok(accepted.ok);
  assert.deepEqual(eve.deliveries, ["delivery-1"]);
  const queued = await askStanding(reads, userId, accepted.answer.id);
  assert.equal(queued?.answer.status, TURN_STATUS.QUEUED);
  assert.equal(queued?.answer.turnId, undefined);

  const writer = await storeWriter({
    run: database.run,
    tools: CATALOG_TOOL_SET,
    now: () => new Date(NOW),
  });
  const relay = new StreamRelay({
    writer,
    asks,
    offer: async () => true,
    now: () => NOW,
    report: () => undefined,
  });
  const standing: RelayStanding = {
    sessionId,
    target: { userId, conversationId },
    turn: BRAIN_HOST_TURN.TYPED,
    state: memoryRelayState(),
  };
  const started = stampedEveEvent(
    { type: "turn.started", data: { turnId: "turn_3", sequence: 3 } },
    NOW,
  );
  const withDeliveries: MessageStreamEvent = {
    ...started,
    meta: { ...started.meta, deliveryIds: ["delivery-1"] },
  };
  await relay.handle(withDeliveries, standing);
  await relay.handle(withDeliveries, standing);

  const turnId = hostTurnId(sessionId, "turn_3");
  const running = await askStanding(reads, userId, accepted.answer.id);
  assert.equal(running?.answer.turnId, turnId);
  assert.equal(running?.answer.status, TURN_STATUS.RUNNING);
  assert.deepEqual(await askStanding(reads, userId, turnId), {
    ...running,
    answer: { ...running?.answer, id: turnId },
    ask: undefined,
  });

  const again = await acceptAsk(seams, {
    userId,
    conversationId,
    clientId,
    question: "what changed?",
    origin: ASK_ORIGIN.TYPED,
  });
  assert.deepEqual(again, accepted);
  assert.deepEqual(eve.deliveries, ["delivery-1"]);
  assert.deepEqual(
    await acceptAsk(seams, {
      userId: await database.createUser(),
      conversationId,
      clientId: randomUUID(),
      question: "what changed?",
      origin: ASK_ORIGIN.TYPED,
    }),
    { ok: false, refusal: ASK_REFUSAL.NOT_FOUND },
  );
});

test("two first asks of different client ids on a conversation with no session open one session between them: the second waits on the conversation's lock, reads the session the first opened, and sends into it", async () => {
  const userId = await database.createUser();
  const conversationId = await conversation(userId);
  const eve = eveAccepting(`wrun_${randomUUID()}`);
  const seams = { run: database.run, asks, eve, now: () => NOW };
  const ask = (clientId: string) =>
    acceptAsk(seams, {
      userId,
      conversationId,
      clientId,
      question: "what changed?",
      origin: ASK_ORIGIN.TYPED,
    });
  const [first, second] = await Promise.all([ask(randomUUID()), ask(randomUUID())]);
  assert.ok(first.ok && second.ok);
  assert.notEqual(first.answer.id, second.answer.id);
  assert.equal(eve.opens, 1);
  assert.deepEqual(eve.deliveries, ["delivery-1"]);
  const rows = await Promise.all([
    asks.named(userId, first.answer.id),
    asks.named(userId, second.answer.id),
  ]);
  assert.equal(rows[0]?.sessionId, rows[1]?.sessionId);
  assert.equal([rows[0]?.deliveryId, rows[1]?.deliveryId].filter((d) => d !== undefined).length, 1);
});
