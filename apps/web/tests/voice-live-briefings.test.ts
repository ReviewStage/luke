import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { asc, eq } from "drizzle-orm";
import type { MessageStreamEvent } from "eve/client";
import { afterAll, test } from "vitest";
import {
  CONVERSATION_EVENT_KIND,
  DEVICE_PLATFORM,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
} from "../server/core";
import { devices } from "../server/db/devices-schema";
import { CONVERSATION_KIND, conversations, events } from "../server/db/storage-schema";
import { voiceSessions } from "../server/db/voice-schema";
import { offerBriefing } from "../server/hosted/brain-host/announce";
import { BRAIN_HOST_TURN } from "../server/hosted/brain-host/bounds";
import { hostTurnId } from "../server/hosted/brain-host/ids";
import {
  memoryRelayState,
  type RelayStanding,
  StreamRelay,
} from "../server/hosted/brain-host/relay";
import { CATALOG_TOOL_SET } from "../server/hosted/brain-tool-set";
import { type ConversationTarget, storeWriter } from "../server/hosted/store";
import { askRecord } from "../server/hosted/store/asks";
import { claimSpeech, offerSpeech, SPEECH_OFFER } from "../server/hosted/store/speech";
import { type HostedBriefingDelivery, hostedBriefings } from "../server/voice/live-briefings";
import { voiceSessionRecord } from "../server/voice/session-record";
import { announceTurn, FIRST_EVE_TURN } from "./support/eve-turns";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";

/**
 * The hosted briefing path over the real store on PGlite: an announce turn
 * driven through the real relay puts a briefing on offer, and the look
 * reads its words, claims it as the session's device, and delivers it with
 * the claim, in that order and only when every step landed. Every row
 * belongs to an account the test created, since on CI this file shares one
 * database with every other store file. Synthetic throughout.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const NOW = 1_800_000_000_000;

const writer = await storeWriter({
  run: database.run,
  tools: CATALOG_TOOL_SET,
  now: () => new Date(NOW),
});
const relay = new StreamRelay({
  writer,
  asks: askRecord(database.run),
  offer: (target, turnId) =>
    offerBriefing({ run: database.run, writer, now: () => NOW }, target, turnId),
  now: () => NOW,
  report: () => undefined,
});
const sessionRecord = voiceSessionRecord(database.db, () => NOW);
const speech = { run: database.run, writer };

async function account(): Promise<ConversationTarget> {
  const userId = await database.createUser();
  const [row] = await database.db
    .insert(conversations)
    .values({ userId, kind: CONVERSATION_KIND.MAIN })
    .returning({ id: conversations.id });
  assert.ok(row);
  return { userId, conversationId: row.id };
}

async function device(userId: string): Promise<string> {
  const id = randomUUID();
  await database.db.insert(devices).values({
    id,
    userId,
    installationId: `install-${id}`,
    platform: DEVICE_PLATFORM.IOS,
    lastSeenAt: new Date(NOW),
  });
  return id;
}

/** A registered live session for the account, its row naming the device given, or none. */
async function voiceSession(userId: string, deviceId: string | undefined): Promise<string> {
  const liveSessionId = `sess_${randomUUID()}`;
  await sessionRecord.register({ userId, sessionId: liveSessionId });
  if (deviceId !== undefined) {
    await database.db
      .update(voiceSessions)
      .set({ deviceId })
      .where(eq(voiceSessions.liveSessionId, liveSessionId));
  }
  return liveSessionId;
}

async function play(events: readonly MessageStreamEvent[], standing: RelayStanding) {
  for (const event of events) await relay.handle(event, standing);
}

/** Puts one briefing on offer the way the brain does: an announce turn through the relay. Answers the offered message's id. */
async function offered(target: ConversationTarget, briefing: string): Promise<string> {
  const standing: RelayStanding = {
    sessionId: `wrun_${randomUUID()}`,
    target,
    turn: BRAIN_HOST_TURN.OBSERVATION,
    model: "scripted-model",
    state: memoryRelayState(),
  };
  await play(announceTurn(FIRST_EVE_TURN, briefing, NOW), standing);
  const offers = await database.store.speech.open(target.userId);
  const turnId = hostTurnId(standing.sessionId, FIRST_EVE_TURN);
  const journal = await database.store.messages.byClientId(
    target.userId,
    target.conversationId,
    CATALOG_TOOL_SET,
    turnId,
  );
  assert.ok(journal.ok);
  const messageId = journal.value[0]?.id;
  assert.ok(messageId);
  assert.ok(offers.some((offer) => offer.messageId === messageId));
  return messageId;
}

async function speechEventsOf(messageId: string) {
  const rows = await database.db
    .select({ kind: events.kind, deviceId: events.deviceId })
    .from(events)
    .where(eq(events.messageId, messageId))
    .orderBy(asc(events.seq));
  return rows.map((row) => [row.kind, row.deviceId]);
}

interface Stand {
  readonly deliveries: HostedBriefingDelivery[];
  readonly reports: string[];
  readonly briefings: ReturnType<typeof hostedBriefings>;
}

function stand(
  target: ConversationTarget,
  liveSessionId: string,
  pollMs = 5,
  now: () => number = () => NOW,
  offersPerLook = 8,
): Stand {
  const deliveries: HostedBriefingDelivery[] = [];
  const reports: string[] = [];
  const briefings = hostedBriefings({
    userId: target.userId,
    speech,
    offers: database.store.speech,
    tools: CATALOG_TOOL_SET,
    deviceId: async () => {
      const [row] = await database.db
        .select({ deviceId: voiceSessions.deviceId })
        .from(voiceSessions)
        .where(eq(voiceSessions.liveSessionId, liveSessionId));
      return row?.deviceId ?? undefined;
    },
    deliver: (delivery) => deliveries.push(delivery),
    now,
    report: (message) => reports.push(message),
    bounds: { POLL_MS: pollMs, OFFERS_PER_LOOK: offersPerLook },
  });
  return { deliveries, reports, briefings };
}

async function until(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (predicate()) return;
    await sleep(5);
  }
  assert.fail(`timed out waiting for ${what}`);
}

test("an offered briefing is read, claimed as the session's device, and delivered with its claim, once; a second look finds it claimed and delivers nothing", async () => {
  const target = await account();
  const deviceId = await device(target.userId);
  const f = stand(target, await voiceSession(target.userId, deviceId));
  const messageId = await offered(target, "One agent finished.");

  await f.briefings.look();
  assert.deepEqual(
    f.deliveries.map((delivery) => [
      delivery.briefing,
      delivery.claim.messageId,
      delivery.claim.deviceId,
      delivery.claim.userId,
      delivery.claim.conversationId,
    ]),
    [["One agent finished.", messageId, deviceId, target.userId, target.conversationId]],
  );
  assert.deepEqual(await speechEventsOf(messageId), [
    [CONVERSATION_EVENT_KIND.SPEECH_OFFERED, null],
    [CONVERSATION_EVENT_KIND.SPEECH_CLAIMED, deviceId],
  ]);
  await f.briefings.look();
  assert.equal(f.deliveries.length, 1);
  assert.deepEqual(f.reports, []);
});

test("a session whose row names no device claims nothing and delivers nothing, and says so once per look", async () => {
  const target = await account();
  const f = stand(target, await voiceSession(target.userId, undefined));
  const messageId = await offered(target, "Another is waiting on you.");

  await f.briefings.look();
  assert.deepEqual(f.deliveries, []);
  assert.deepEqual(await speechEventsOf(messageId), [
    [CONVERSATION_EVENT_KIND.SPEECH_OFFERED, null],
  ]);
  assert.equal(f.reports.length, 1);
});

test("an offer another device claimed first is not delivered here", async () => {
  const target = await account();
  const mine = await device(target.userId);
  const other = await device(target.userId);
  const f = stand(target, await voiceSession(target.userId, mine));
  const messageId = await offered(target, "Claimed elsewhere.");
  assert.equal((await claimSpeech(speech, target.userId, messageId, other, NOW)).ok, true);

  await f.briefings.look();
  assert.deepEqual(f.deliveries, []);
  assert.deepEqual(await speechEventsOf(messageId), [
    [CONVERSATION_EVENT_KIND.SPEECH_OFFERED, null],
    [CONVERSATION_EVENT_KIND.SPEECH_CLAIMED, other],
  ]);
});

test("an offer the record refuses to claim, here one past its expiry while still reading as offered, delivers nothing", async () => {
  const target = await account();
  const deviceId = await device(target.userId);
  const f = stand(
    target,
    await voiceSession(target.userId, deviceId),
    5,
    () => NOW + SPEECH_OFFER.TTL_MS + 1,
  );
  const messageId = await offered(target, "Too late.");

  await f.briefings.look();
  assert.deepEqual(f.deliveries, []);
  assert.deepEqual(await speechEventsOf(messageId), [
    [CONVERSATION_EVENT_KIND.SPEECH_OFFERED, null],
  ]);
});

test("an offer whose announcement has no words this build can read is left standing, unclaimed, rather than claimed and never spoken", async () => {
  const target = await account();
  const deviceId = await device(target.userId);
  const f = stand(target, await voiceSession(target.userId, deviceId));
  const written = await writer.recordUserMessage(target, {
    clientId: randomUUID(),
    text: "not an announcement",
    metadata: { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.TYPED },
  });
  assert.ok(written.ok);
  assert.equal((await offerSpeech(speech, target.userId, written.id, NOW)).ok, true);

  await f.briefings.look();
  assert.deepEqual(f.deliveries, []);
  assert.deepEqual(await speechEventsOf(written.id), [
    [CONVERSATION_EVENT_KIND.SPEECH_OFFERED, null],
  ]);
  assert.equal(f.reports.length, 1);
});

test("a delivered briefing is decided at the claim, not the offer: an offer minutes old is handed over as decided now, so the service does not drop as stale what the record still holds open", async () => {
  const target = await account();
  const deviceId = await device(target.userId);
  const later = NOW + 5 * 60_000;
  const f = stand(target, await voiceSession(target.userId, deviceId), 5, () => later);
  await offered(target, "Five minutes ago.");

  await f.briefings.look();
  assert.deepEqual(
    f.deliveries.map((delivery) => [delivery.briefing, delivery.decidedAt]),
    [["Five minutes ago.", later]],
  );
});

test("offers other devices hold claims on do not take the look's page from a newer offer", async () => {
  const target = await account();
  const mine = await device(target.userId);
  const other = await device(target.userId);
  const f = stand(target, await voiceSession(target.userId, mine), 5, () => NOW, 2);
  const first = await offered(target, "Claimed elsewhere, one.");
  const second = await offered(target, "Claimed elsewhere, two.");
  assert.equal((await claimSpeech(speech, target.userId, first, other, NOW)).ok, true);
  assert.equal((await claimSpeech(speech, target.userId, second, other, NOW)).ok, true);
  const third = await offered(target, "Still offered.");

  await f.briefings.look();
  assert.deepEqual(
    f.deliveries.map((delivery) => delivery.claim.messageId),
    [third],
  );
});

test("while a device of the account reports quiet ahead, the look claims nothing, whether or not the sweep has marked the offer held yet", async () => {
  const target = await account();
  const deviceId = await device(target.userId);
  const quiet = await device(target.userId);
  await database.db
    .update(devices)
    .set({ quietUntil: new Date(NOW + 60_000) })
    .where(eq(devices.id, quiet));
  const f = stand(target, await voiceSession(target.userId, deviceId));
  const messageId = await offered(target, "Into a meeting.");

  await f.briefings.look();
  assert.deepEqual(f.deliveries, []);
  assert.deepEqual(await speechEventsOf(messageId), [
    [CONVERSATION_EVENT_KIND.SPEECH_OFFERED, null],
  ]);
});

test("start looks on the schedule and stop ends it: an offer after the stop is not taken", async () => {
  const target = await account();
  const deviceId = await device(target.userId);
  const f = stand(target, await voiceSession(target.userId, deviceId));
  f.briefings.start();
  f.briefings.start();
  await offered(target, "First.");
  await until(() => f.deliveries.length === 1, "the first briefing");
  f.briefings.stop();
  await offered(target, "Second.");
  await sleep(60);
  assert.deepEqual(
    f.deliveries.map((delivery) => delivery.briefing),
    ["First."],
  );
});
