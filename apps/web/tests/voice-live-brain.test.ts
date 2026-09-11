import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import {
  LIVE_BRAIN_RUN_END,
  LIVE_BRAIN_RUN_EVENT,
  LIVE_BRAIN_SUBMISSION,
  type LiveBrainRunEvent,
} from "@sidecar/voice/live-session";
import { SCHEMA_REFUSAL } from "@sidecar/wire";
import type { MessageStreamEvent } from "eve/client";
import { afterAll, test } from "vitest";
import { ASK_ORIGIN, TURN_END, TURN_EVENT_KIND, TURN_SLOW_STEP } from "../server/core";
import { ASK_REFUSAL } from "../server/hosted/brain-ask";
import { BRAIN_HOST_TURN } from "../server/hosted/brain-host/bounds";
import {
  EVE_SEND_OUTCOME,
  type EveMessage,
  type EveSessions,
} from "../server/hosted/brain-host/eve-sessions";
import {
  memoryRelayState,
  type RelayStanding,
  StreamRelay,
} from "../server/hosted/brain-host/relay";
import { CATALOG_TOOL_SET } from "../server/hosted/brain-tool-set";
import { type ConversationTarget, storeWriter } from "../server/hosted/store";
import { askRecord } from "../server/hosted/store/asks";
import type { MessageListRead } from "../server/hosted/store/message-reads";
import {
  HOSTED_ASK_REFUSAL_NOTE,
  type HostedLiveBrain,
  type HostedLiveBrainOptions,
  hostedLiveBrain,
} from "../server/voice/live-brain";
import { FIRST_EVE_TURN, spokenTurn } from "./support/eve-turns";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import { deleteConversation, insertConversation } from "./support/store-rows";

/**
 * The hosted live brain over the real ask door and the real store on PGlite:
 * a spoken ask admitted and recorded through `acceptAsk` under a fake eve, its
 * turn driven through the real relay as eve's stream would drive it, and the
 * run seams the live session service consumes read back under the ask's id.
 * Every row belongs to an account the test created, since on CI this file
 * shares one database with every other store file. Synthetic throughout: no
 * real question, title, or spoken word.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const NOW = 1_800_000_000_000;
/**
 * The follow's bounds narrowed so a poll is milliseconds, with the bound left
 * wide: a turn's events land through the store, and the store on CI is one
 * Postgres shared with every other job, so a bound measured in milliseconds
 * against it would expire under load before the turn's first event arrives.
 */
const QUICK = { POLL_MS: 5, FOLLOW_MS: 60_000 };
/** The same cadence with the bound close enough to reach inside a test. */
const BOUNDED = { POLL_MS: 5, FOLLOW_MS: 150 };

const writer = await storeWriter({
  run: database.run,
  tools: CATALOG_TOOL_SET,
  now: () => new Date(NOW),
});
const asks = askRecord(database.run);
const relay = new StreamRelay({
  writer,
  asks,
  stopTurn: async () => undefined,
  offer: async () => false,
  now: () => NOW,
  report: () => undefined,
});

/** An eve session id of this test's own: the relay names a turn by session and eve turn, so a counted id would collide across the files that share one database on CI. */
function mintSession(): string {
  return `wrun_${randomUUID()}`;
}

interface FakeEve extends EveSessions {
  readonly opened: EveMessage[];
  failNext: number | undefined;
}

function fakeEve(): FakeEve {
  const eve: FakeEve = {
    opened: [],
    failNext: undefined,
    async open(message) {
      eve.opened.push(message);
      if (eve.failNext !== undefined) {
        const status = eve.failNext;
        eve.failNext = undefined;
        return { outcome: EVE_SEND_OUTCOME.FAILED, status };
      }
      return { outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId: mintSession() };
    },
    async send(sessionId) {
      return { outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId, deliveryId: "delivery-1" };
    },
    async cancel() {
      return { outcome: EVE_SEND_OUTCOME.ACCEPTED };
    },
  };
  return eve;
}

/** A fresh account with its standing main, the conversation a spoken ask lands in. */
async function account(): Promise<ConversationTarget> {
  const userId = await database.createUser();
  const conversationId = await insertConversation(database.run, { userId });
  return { userId, conversationId };
}

interface Stand {
  readonly eve: FakeEve;
  readonly brain: HostedLiveBrain;
  readonly events: LiveBrainRunEvent[];
  readonly reports: string[];
}

function stand(
  target: ConversationTarget,
  bounds: NonNullable<HostedLiveBrainOptions["bounds"]> = QUICK,
  store: HostedLiveBrainOptions["store"] = database.store,
): Stand {
  const eve = fakeEve();
  const events: LiveBrainRunEvent[] = [];
  const reports: string[] = [];
  const brain = hostedLiveBrain({
    userId: target.userId,
    asks: { run: database.run, asks, eve, now: () => NOW },
    store,
    report: (message) => reports.push(message),
    bounds,
  });
  brain.onRunEvent((event) => events.push(event));
  return { eve, brain, events, reports };
}

/** The eve session an accepted ask was handed to, from the record; a follow-up would read it the same way. */
async function sessionOf(target: ConversationTarget, askId: string): Promise<string> {
  const ask = await asks.named(target.userId, askId);
  assert.ok(ask?.sessionId);
  return ask.sessionId;
}

async function play(events: readonly MessageStreamEvent[], standing: RelayStanding) {
  for (const event of events) await relay.handle(event, standing);
}

async function until(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (predicate()) return;
    await sleep(5);
  }
  assert.fail(`timed out waiting for ${what}`);
}

test("a spoken ask goes through the ask door under the spoken origin with the submission id as its client id, answers the ask's id as the run, and a retry of the submission finds the same run with eve reached once", async () => {
  const target = await account();
  const f = stand(target);
  const submissionId = randomUUID();
  const ask = { submissionId, question: "Developer: what needs me?" };

  const accepted = await f.brain.submitAsk(ask);
  assert.equal(accepted.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
  if (accepted.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
  assert.deepEqual(
    f.eve.opened.map((message) => [message.conversationId, message.turn, message.message]),
    [[target.conversationId, BRAIN_HOST_TURN.SPOKEN, ask.question]],
  );
  const recorded = await asks.named(target.userId, accepted.runId);
  assert.deepEqual(
    [recorded?.origin, recorded?.clientId, recorded?.conversationId],
    [ASK_ORIGIN.SPOKEN, submissionId, target.conversationId],
  );

  const again = await f.brain.submitAsk(ask);
  assert.deepEqual(again, accepted);
  assert.equal(f.eve.opened.length, 1);
  f.brain.stop();
});

test("an accepted ask's turn is followed from the record: the slow step, the settled mark, the sentences, and the end reach the service under the ask's id, exactly once, however many times the submission was retried", async () => {
  const target = await account();
  const f = stand(target);
  const ask = { submissionId: randomUUID(), question: "q" };
  const accepted = await f.brain.submitAsk(ask);
  assert.equal(accepted.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
  if (accepted.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
  assert.deepEqual(await f.brain.submitAsk(ask), accepted);
  const standing: RelayStanding = {
    sessionId: await sessionOf(target, accepted.runId),
    target,
    turn: BRAIN_HOST_TURN.SPOKEN,
    model: "scripted-model",
    state: memoryRelayState(),
  };
  const events = spokenTurn(FIRST_EVE_TURN, NOW);
  const requested = events.findIndex((event) => event.type === "actions.requested") + 1;
  await play(events.slice(0, requested), standing);
  await until(() => f.events.length === 1, "the slow step");
  await play(events.slice(requested), standing);
  await until(() => f.events.length === 5, "the turn's end");
  await sleep(QUICK.POLL_MS * 6);

  assert.deepEqual(
    f.events.map((event) => event.kind),
    [
      LIVE_BRAIN_RUN_EVENT.SLOW_STEP,
      LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED,
      LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
      LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
      LIVE_BRAIN_RUN_EVENT.ENDED,
    ],
  );
  assert.deepEqual(new Set(f.events.map((event) => event.runId)), new Set([accepted.runId]));
  const [slow, , first, second, end] = f.events;
  assert.equal(
    slow?.kind === LIVE_BRAIN_RUN_EVENT.SLOW_STEP && slow.step,
    TURN_SLOW_STEP.TRANSCRIPT_READ,
  );
  assert.equal(
    first?.kind === LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE && first.sentence,
    "One agent finished.",
  );
  assert.equal(
    second?.kind === LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE && second.sentence,
    "Another is waiting on you.",
  );
  assert.equal(end?.kind === LIVE_BRAIN_RUN_EVENT.ENDED && end.end, LIVE_BRAIN_RUN_END.COMPLETED);
  assert.deepEqual(f.reports, []);
  f.brain.stop();
});

test("a refusal at the door is spoken as the build's own note for it, and every refusal has one", async () => {
  const target = await account();
  const f = stand(target);
  f.eve.failNext = 502;
  const refused = await f.brain.submitAsk({ submissionId: randomUUID(), question: "q" });
  assert.deepEqual(refused, {
    outcome: LIVE_BRAIN_SUBMISSION.REFUSED,
    refusal: HOSTED_ASK_REFUSAL_NOTE[ASK_REFUSAL.UPSTREAM],
  });
  assert.deepEqual(Object.keys(HOSTED_ASK_REFUSAL_NOTE).sort(), Object.values(ASK_REFUSAL).sort());
  await sleep(QUICK.POLL_MS * 4);
  assert.deepEqual(f.events, []);
  f.brain.stop();
});

test("an ask whose turn never starts is told as failed at the follow bound, once, and the bound is reported", async () => {
  const target = await account();
  const f = stand(target, BOUNDED);
  const accepted = await f.brain.submitAsk({ submissionId: randomUUID(), question: "q" });
  assert.equal(accepted.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
  if (accepted.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
  await until(() => f.events.length === 1, "the follow bound");
  await sleep(QUICK.POLL_MS * 6);
  assert.deepEqual(f.events, [
    { kind: LIVE_BRAIN_RUN_EVENT.ENDED, runId: accepted.runId, end: LIVE_BRAIN_RUN_END.FAILED },
  ]);
  assert.equal(f.reports.length, 1);
  f.brain.stop();
});

test("a journal the store cannot read ends the ask as failed, once, and is reported, never told as a completed end with no sentences", async () => {
  const target = await account();
  const unreadable: MessageListRead = {
    ok: false,
    refusal: SCHEMA_REFUSAL.MALFORMED,
    seq: 0,
    path: [],
  };
  const f = stand(target, QUICK, {
    turns: database.store.turns,
    messages: { ...database.store.messages, byClientId: async () => unreadable },
  });
  const accepted = await f.brain.submitAsk({ submissionId: randomUUID(), question: "q" });
  assert.equal(accepted.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
  if (accepted.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
  await play(spokenTurn(FIRST_EVE_TURN, NOW), {
    sessionId: await sessionOf(target, accepted.runId),
    target,
    turn: BRAIN_HOST_TURN.SPOKEN,
    model: "scripted-model",
    state: memoryRelayState(),
  });
  await until(() => f.events.length >= 1, "the unreadable journal's end");
  await sleep(QUICK.POLL_MS * 6);
  assert.deepEqual(f.events, [
    { kind: LIVE_BRAIN_RUN_EVENT.ENDED, runId: accepted.runId, end: LIVE_BRAIN_RUN_END.FAILED },
  ]);
  assert.equal(f.reports.length, 1);
  f.brain.stop();
});

test("an ask the record no longer holds ends as failed rather than being followed forever", async () => {
  const target = await account();
  const f = stand(target);
  const accepted = await f.brain.submitAsk({ submissionId: randomUUID(), question: "q" });
  assert.equal(accepted.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
  if (accepted.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
  await deleteConversation(database.run, target.conversationId);
  await until(() => f.events.length === 1, "the lost ask's end");
  assert.deepEqual(f.events, [
    { kind: LIVE_BRAIN_RUN_EVENT.ENDED, runId: accepted.runId, end: LIVE_BRAIN_RUN_END.FAILED },
  ]);
  f.brain.stop();
});

test("stop ends every follow: a turn that completes after it reaches no listener", async () => {
  const target = await account();
  const f = stand(target);
  const accepted = await f.brain.submitAsk({ submissionId: randomUUID(), question: "q" });
  assert.equal(accepted.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
  if (accepted.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
  f.brain.stop();
  await play(spokenTurn(FIRST_EVE_TURN, NOW), {
    sessionId: await sessionOf(target, accepted.runId),
    target,
    turn: BRAIN_HOST_TURN.SPOKEN,
    model: "scripted-model",
    state: memoryRelayState(),
  });
  await sleep(QUICK.POLL_MS * 8);
  assert.deepEqual(f.events, []);
});

test("the stream's vocabulary and the service's are one set of words on each side", () => {
  assert.deepEqual(
    Object.values(TURN_EVENT_KIND).sort(),
    Object.values(LIVE_BRAIN_RUN_EVENT).sort(),
  );
  assert.deepEqual(Object.values(TURN_END).sort(), Object.values(LIVE_BRAIN_RUN_END).sort());
});
