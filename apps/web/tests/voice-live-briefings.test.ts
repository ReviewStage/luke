import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { eq } from "drizzle-orm";
import { Duration, Effect, Exit, Result, Schema, Scope } from "effect";
import { TestClock } from "effect/testing";
import { SqlClient } from "effect/unstable/sql";
import type { MessageStreamEvent } from "eve/client";
import { afterAll } from "vitest";
import {
  CONVERSATION_EVENT_KIND,
  DEVICE_PLATFORM,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
} from "../server/core";
import { db } from "../server/db/query";
import { events } from "../server/db/storage-schema";
import { CONVERSATION_KIND } from "../server/db/storage-vocabulary";
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
import {
  type HostedBriefingDelivery,
  type HostedBriefings,
  hostedBriefings,
} from "../server/voice/live-briefings";
import { voiceSessionRecord } from "../server/voice/session-record";
import { announceTurn, FIRST_EVE_TURN } from "./support/eve-turns";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import {
  insertConversation,
  insertDevice,
  setDeviceQuietUntil,
  setVoiceSessionDeviceId,
} from "./support/store-rows";

/**
 * The hosted briefing path over the real store on PGlite: an announce turn
 * driven through the real relay puts a briefing on offer, and the look
 * reads its words, claims it as the session's device, and delivers it with
 * the claim, in that order and only when every step landed. Every row
 * belongs to an account the test created, since on CI this file shares one
 * database with every other store file. Synthetic throughout.
 *
 * Every test is an `it.effect` over the one `SqlClient` the harness opened,
 * so the schedule the start puts the looks on keeps time on the ambient
 * `TestClock`: a look on the schedule is a clock the test advances rather
 * than a pause it waits out.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const sqlClient = await database.run(Effect.service(SqlClient.SqlClient));

const NOW = 1_800_000_000_000;

/** The poll the stands are built with, short enough that a look is one small advance of the clock. */
const POLL_MS = 5;

/** The most clock advances a wait for a scheduled look makes before it fails. */
const LOOK_ATTEMPTS = 400;

/** How many polls a stopped schedule is given to prove it looks no more. */
const QUIET_POLLS = 12;

const writer = await database.run(
  storeWriter({
    tools: CATALOG_TOOL_SET,
  }),
);
const relay = new StreamRelay({
  writer,
  asks: askRecord(),
  stopTurn: () => Effect.void,
  offer: (target, turnId) => offerBriefing({ writer, now: () => NOW }, target, turnId),
  deliverCompletion: () => Effect.void,
  now: () => NOW,
  report: () => undefined,
});
const sessionRecord = voiceSessionRecord(() => NOW);
const speech = { writer };

const account = Effect.fnUntraced(function* () {
  const userId = yield* Effect.promise(() => database.createUser());
  const conversationId = yield* Effect.promise(() => insertConversation(database.run, { userId }));
  return { userId, conversationId } satisfies ConversationTarget;
});

const device = Effect.fnUntraced(function* (userId: string) {
  const id = randomUUID();
  yield* Effect.promise(() =>
    insertDevice(database.run, {
      id,
      userId,
      installationId: `install-${id}`,
      platform: DEVICE_PLATFORM.IOS,
      lastSeenAt: new Date(NOW),
    }),
  );
  return id;
});

/** A registered live session for the account, its row naming the device given, or none. */
const voiceSession = Effect.fnUntraced(function* (userId: string, deviceId: string | undefined) {
  const liveSessionId = `sess_${randomUUID()}`;
  yield* sessionRecord.register({ userId, sessionId: liveSessionId });
  if (deviceId !== undefined) {
    yield* Effect.promise(() => setVoiceSessionDeviceId(database.run, liveSessionId, deviceId));
  }
  return liveSessionId;
});

const play = Effect.fnUntraced(function* (
  events: readonly MessageStreamEvent[],
  standing: RelayStanding,
) {
  for (const event of events) yield* relay.handle(event, standing);
});

/** Puts one briefing on offer the way the brain does: an announce turn through the relay. Answers the offered message's id. */
const offered = Effect.fnUntraced(function* (target: ConversationTarget, briefing: string) {
  const standing: RelayStanding = {
    sessionId: `wrun_${randomUUID()}`,
    target,
    kind: CONVERSATION_KIND.MAIN,
    turn: BRAIN_HOST_TURN.OBSERVATION,
    model: "scripted-model",
    state: memoryRelayState(),
  };
  yield* play(announceTurn(FIRST_EVE_TURN, briefing, NOW), standing);
  const offers = yield* database.store.speech.open(target.userId);
  const turnId = hostTurnId(standing.sessionId, FIRST_EVE_TURN);
  const journal = yield* database.store.messages.byClientId(
    target.userId,
    target.conversationId,
    CATALOG_TOOL_SET,
    turnId,
  );
  assert.ok(journal.ok);
  const messageId = journal.ok ? journal.value[0]?.id : undefined;
  assert.ok(messageId);
  assert.ok(offers.some((offer) => offer.messageId === messageId));
  return messageId;
});

const speechEventsOf = Effect.fnUntraced(function* (messageId: string) {
  const rows = yield* db
    .select({ kind: events.kind, deviceId: events.deviceId })
    .from(events)
    .where(eq(events.messageId, messageId))
    .orderBy(events.seq);
  return rows.map((row) => [row.kind, row.deviceId]);
});

const VoiceSessionDeviceRowSchema = Schema.Struct({
  deviceId: Schema.NullOr(Schema.String),
});

interface Stand {
  readonly deliveries: HostedBriefingDelivery[];
  readonly reports: string[];
  readonly briefings: HostedBriefings;
  /** The socket's own scope as the attachment opens one; closing it ends the looking. */
  readonly stop: Effect.Effect<void>;
}

const stand = Effect.fnUntraced(function* (
  target: ConversationTarget,
  liveSessionId: string,
  now: () => number = () => NOW,
  offersPerLook = 8,
) {
  const deliveries: HostedBriefingDelivery[] = [];
  const reports: string[] = [];
  const scope = yield* Scope.make();
  const briefings = yield* Scope.provide(
    hostedBriefings({
      userId: target.userId,
      speech,
      offers: database.store.speech,
      tools: CATALOG_TOOL_SET,
      deviceId: Effect.gen(function* () {
        const [row] = yield* db
          .select({ deviceId: voiceSessions.deviceId })
          .from(voiceSessions)
          .where(eq(voiceSessions.liveSessionId, liveSessionId));
        if (row === undefined) return undefined;
        return Schema.decodeUnknownSync(VoiceSessionDeviceRowSchema)(row).deviceId ?? undefined;
      }),
      deliver: (delivery) => deliveries.push(delivery),
      now,
      report: (message) => reports.push(message),
      bounds: { POLL_MS, OFFERS_PER_LOOK: offersPerLook },
    }),
    scope,
  );
  return {
    deliveries,
    reports,
    briefings,
    stop: Scope.close(scope, Exit.void),
  } satisfies Stand;
});

/**
 * Advances the clock one poll at a time until `ready` holds. Note that each
 * step also reads the account's offers, because the scheduled look's own
 * read is a real database round trip: the read is what turns the loop over
 * to the looking fiber, and the advance is what wakes it.
 */
const looked = Effect.fnUntraced(function* (
  userId: string,
  ready: () => boolean,
  what: string,
): Effect.fn.Return<void, never, SqlClient.SqlClient> {
  for (let attempt = 0; attempt < LOOK_ATTEMPTS; attempt += 1) {
    if (ready()) return;
    yield* TestClock.adjust(Duration.millis(POLL_MS));
    yield* Effect.orDie(database.store.speech.open(userId));
  }
  assert.fail(`timed out waiting for ${what}`);
});

const withSql = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  Effect.provideService(effect, SqlClient.SqlClient, sqlClient);

it.effect(
  "an offered briefing is read, claimed as the session's device, and delivered with its claim, once; a second look finds it claimed and delivers nothing",
  () =>
    withSql(
      Effect.gen(function* () {
        const target = yield* account();
        const deviceId = yield* device(target.userId);
        const f = yield* stand(target, yield* voiceSession(target.userId, deviceId));
        const messageId = yield* offered(target, "One agent finished.");

        yield* f.briefings.look;
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
        assert.deepEqual(yield* speechEventsOf(messageId), [
          [CONVERSATION_EVENT_KIND.SPEECH_OFFERED, null],
          [CONVERSATION_EVENT_KIND.SPEECH_CLAIMED, deviceId],
        ]);
        yield* f.briefings.look;
        assert.equal(f.deliveries.length, 1);
        assert.deepEqual(f.reports, []);
      }),
    ),
);

it.effect(
  "a session whose row names no device claims nothing and delivers nothing, and says so once per look",
  () =>
    withSql(
      Effect.gen(function* () {
        const target = yield* account();
        const f = yield* stand(target, yield* voiceSession(target.userId, undefined));
        const messageId = yield* offered(target, "Another is waiting on you.");

        yield* f.briefings.look;
        assert.deepEqual(f.deliveries, []);
        assert.deepEqual(yield* speechEventsOf(messageId), [
          [CONVERSATION_EVENT_KIND.SPEECH_OFFERED, null],
        ]);
        assert.equal(f.reports.length, 1);
      }),
    ),
);

it.effect("an offer another device claimed first is not delivered here", () =>
  withSql(
    Effect.gen(function* () {
      const target = yield* account();
      const mine = yield* device(target.userId);
      const other = yield* device(target.userId);
      const f = yield* stand(target, yield* voiceSession(target.userId, mine));
      const messageId = yield* offered(target, "Claimed elsewhere.");
      assert.equal(
        Result.isSuccess(yield* claimSpeech(speech, target.userId, messageId, other, NOW)),
        true,
      );

      yield* f.briefings.look;
      assert.deepEqual(f.deliveries, []);
      assert.deepEqual(yield* speechEventsOf(messageId), [
        [CONVERSATION_EVENT_KIND.SPEECH_OFFERED, null],
        [CONVERSATION_EVENT_KIND.SPEECH_CLAIMED, other],
      ]);
    }),
  ),
);

it.effect(
  "an offer the record refuses to claim, here one past its expiry while still reading as offered, delivers nothing",
  () =>
    withSql(
      Effect.gen(function* () {
        const target = yield* account();
        const deviceId = yield* device(target.userId);
        const f = yield* stand(
          target,
          yield* voiceSession(target.userId, deviceId),
          () => NOW + SPEECH_OFFER.TTL_MS + 1,
        );
        const messageId = yield* offered(target, "Too late.");

        yield* f.briefings.look;
        assert.deepEqual(f.deliveries, []);
        assert.deepEqual(yield* speechEventsOf(messageId), [
          [CONVERSATION_EVENT_KIND.SPEECH_OFFERED, null],
        ]);
      }),
    ),
);

it.effect(
  "an offer whose announcement has no words this build can read is left standing, unclaimed, rather than claimed and never spoken",
  () =>
    withSql(
      Effect.gen(function* () {
        const target = yield* account();
        const deviceId = yield* device(target.userId);
        const f = yield* stand(target, yield* voiceSession(target.userId, deviceId));
        const written = yield* writer.recordUserMessage(target, {
          clientId: randomUUID(),
          text: "not an announcement",
          metadata: { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.TYPED },
        });
        assert.ok(Result.isSuccess(written));
        if (!Result.isSuccess(written)) return;
        const messageId = written.success.id;
        assert.equal(
          Result.isSuccess(yield* offerSpeech(speech, target.userId, messageId, NOW)),
          true,
        );

        yield* f.briefings.look;
        assert.deepEqual(f.deliveries, []);
        assert.deepEqual(yield* speechEventsOf(messageId), [
          [CONVERSATION_EVENT_KIND.SPEECH_OFFERED, null],
        ]);
        assert.equal(f.reports.length, 1);
      }),
    ),
);

it.effect(
  "a delivered briefing is decided at the claim, not the offer: an offer minutes old is handed over as decided now, so the service does not drop as stale what the record still holds open",
  () =>
    withSql(
      Effect.gen(function* () {
        const target = yield* account();
        const deviceId = yield* device(target.userId);
        const later = NOW + 5 * 60_000;
        const f = yield* stand(target, yield* voiceSession(target.userId, deviceId), () => later);
        yield* offered(target, "Five minutes ago.");

        yield* f.briefings.look;
        assert.deepEqual(
          f.deliveries.map((delivery) => [delivery.briefing, delivery.decidedAt]),
          [["Five minutes ago.", later]],
        );
      }),
    ),
);

it.effect(
  "offers other devices hold claims on do not take the look's page from a newer offer",
  () =>
    withSql(
      Effect.gen(function* () {
        const target = yield* account();
        const mine = yield* device(target.userId);
        const other = yield* device(target.userId);
        const f = yield* stand(target, yield* voiceSession(target.userId, mine), () => NOW, 2);
        const first = yield* offered(target, "Claimed elsewhere, one.");
        const second = yield* offered(target, "Claimed elsewhere, two.");
        assert.equal(
          Result.isSuccess(yield* claimSpeech(speech, target.userId, first, other, NOW)),
          true,
        );
        assert.equal(
          Result.isSuccess(yield* claimSpeech(speech, target.userId, second, other, NOW)),
          true,
        );
        const third = yield* offered(target, "Still offered.");

        yield* f.briefings.look;
        assert.deepEqual(
          f.deliveries.map((delivery) => delivery.claim.messageId),
          [third],
        );
      }),
    ),
);

it.effect(
  "while a device of the account reports quiet ahead, the look claims nothing, whether or not the sweep has marked the offer held yet",
  () =>
    withSql(
      Effect.gen(function* () {
        const target = yield* account();
        const deviceId = yield* device(target.userId);
        const quiet = yield* device(target.userId);
        yield* Effect.promise(() =>
          setDeviceQuietUntil(database.run, quiet, new Date(NOW + 60_000)),
        );
        const f = yield* stand(target, yield* voiceSession(target.userId, deviceId));
        const messageId = yield* offered(target, "Into a meeting.");

        yield* f.briefings.look;
        assert.deepEqual(f.deliveries, []);
        assert.deepEqual(yield* speechEventsOf(messageId), [
          [CONVERSATION_EVENT_KIND.SPEECH_OFFERED, null],
        ]);
      }),
    ),
);

it.effect(
  "start looks on the schedule and stop ends it: an offer after the stop is not taken",
  () =>
    withSql(
      Effect.gen(function* () {
        const target = yield* account();
        const deviceId = yield* device(target.userId);
        const f = yield* stand(target, yield* voiceSession(target.userId, deviceId));
        yield* f.briefings.start;
        yield* f.briefings.start;
        yield* offered(target, "First.");
        yield* looked(target.userId, () => f.deliveries.length === 1, "the first briefing");
        yield* f.stop;
        yield* offered(target, "Second.");
        // Note that the stopped schedule is given several polls' worth of clock
        // and a real read between them, because what is asserted is a look that
        // would have happened by now and did not.
        for (let poll = 0; poll < QUIET_POLLS; poll += 1) {
          yield* TestClock.adjust(Duration.millis(POLL_MS));
          yield* database.store.speech.open(target.userId);
        }
        assert.deepEqual(
          f.deliveries.map((delivery) => delivery.briefing),
          ["First."],
        );
      }),
    ),
);
