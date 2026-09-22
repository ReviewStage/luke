import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { LIVE_BRAIN_SUBMISSION, sidebandOverSocket } from "@sidecar/voice/live-session";
import { FakeLiveSocket } from "@sidecar/voice/testing";
import { Effect, Exit, Schema, Scope } from "effect";
import type { MessageStreamEvent } from "eve/client";
import { afterAll } from "vitest";
import { CONVERSATION_EVENT_KIND, DEVICE_PLATFORM, MESSAGE_ROLE } from "../server/core";
import { CONVERSATION_KIND } from "../server/db/storage-vocabulary";
import { offerBriefing } from "../server/hosted/brain-host/announce";
import { BRAIN_HOST_TURN } from "../server/hosted/brain-host/bounds";
import {
  EVE_SEND_OUTCOME,
  type EveMessage,
  type EveSessions,
} from "../server/hosted/brain-host/eve-sessions";
import { hostTurnId } from "../server/hosted/brain-host/ids";
import {
  memoryRelayState,
  type RelayStanding,
  StreamRelay,
} from "../server/hosted/brain-host/relay";
import { CATALOG_TOOL_SET } from "../server/hosted/brain-tool-set";
import { payloadKeyRing } from "../server/hosted/encryption";
import { type ConversationTarget, storeWriter } from "../server/hosted/store";
import { askRecord } from "../server/hosted/store/asks";
import {
  LIVE_CLIENT_EVENT,
  LIVE_CLOSE_REASON,
  LIVE_SERVER_EVENT,
  type LiveAppendEvent,
  type LiveClientEvent,
  type LiveServerEventType,
} from "../server/live";
import { hostedLiveExchange } from "../server/voice/live-exchange";
import { voiceSessionRecord } from "../server/voice/session-record";
import { announceTurn, FIRST_EVE_TURN, spokenTurn } from "./support/eve-turns";
import { openHostedStoreTestDatabase, TEST_PAYLOAD_SECRET } from "./support/hosted-store-database";
import { delegated, heard, sessionStarted } from "./support/live-events";
import { settled } from "./support/settle";
import {
  insertConversation,
  insertDevice,
  readEventsByMessage,
  readMessagesByConversationTyped,
  readVoiceSessionByLiveSessionId,
  readVoiceTranscriptSegmentsBySession,
  setVoiceSessionDeviceId,
} from "./support/store-rows";

/**
 * The hosted live exchange composed whole over the real store on PGlite: a
 * scripted sideband stands for the session, a fake eve for the judgment, and
 * the real relay for eve's stream. What these tests hold to is the lift's
 * acceptance in the parts this build can run: a spoken ask runs a turn
 * through the ask door and is spoken from the service's own appends, its
 * words and Luke's landing as segments and one user message; a briefing on
 * offer is claimed as the session's device before it is appended and marked
 * spoken by the session's own voice after; and a session with no device
 * speaks no briefing. Every row is an account's this test created.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const NOW = 1_800_000_000_000;

const DelegatedMetadataSchema = Schema.Struct({ delegation_id: Schema.String });

/** The delegation a row's metadata names, where it names one. */
function delegationOf(row: { readonly metadata: unknown }): string | undefined {
  return Schema.is(DelegatedMetadataSchema)(row.metadata) ? row.metadata.delegation_id : undefined;
}
const KEYS = payloadKeyRing(TEST_PAYLOAD_SECRET);
/** Where every acknowledged append ends on the session's clock; the voice that follows begins past it. */
const APPEND_END_MS = 1_000;

/** The acknowledgment each append type earns, as the API names them. */
const ACKNOWLEDGMENT_OF: ReadonlyMap<LiveClientEvent["type"], LiveServerEventType> = new Map([
  [LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND, LIVE_SERVER_EVENT.INSTRUCTIONS_APPENDED],
  [LIVE_CLIENT_EVENT.THINKING_APPEND, LIVE_SERVER_EVENT.THINKING_APPENDED],
  [LIVE_CLIENT_EVENT.COMMENTARY_APPEND, LIVE_SERVER_EVENT.COMMENTARY_APPENDED],
]);

const writer = await database.run(
  storeWriter({
    tools: CATALOG_TOOL_SET,
  }),
);
const askEffects = askRecord();
const asks = {
  record: (write: Parameters<typeof askEffects.record>[0]) =>
    database.run(askEffects.record(write)),
  named: (userId: string, id: string) => database.run(askEffects.named(userId, id)),
  latestSession: (userId: string, conversationId: string) =>
    database.run(askEffects.latestSession(userId, conversationId)),
  dispatchOnce: (
    target: Parameters<typeof askEffects.dispatchOnce>[0],
    id: string,
    dispatch: Parameters<typeof askEffects.dispatchOnce>[2],
  ) => database.run(askEffects.dispatchOnce(target, id, dispatch)),
  cancelRequested: (id: string, at: Date) => database.run(askEffects.cancelRequested(id, at)),
  bindDeliveries: (
    target: Parameters<typeof askEffects.bindDeliveries>[0],
    deliveryIds: Parameters<typeof askEffects.bindDeliveries>[1],
    turnId: string,
  ) => database.run(askEffects.bindDeliveries(target, deliveryIds, turnId)),
  stoppedOn: (target: Parameters<typeof askEffects.stoppedOn>[0], turnId: string) =>
    database.run(askEffects.stoppedOn(target, turnId)),
};
const relay = new StreamRelay({
  writer,
  asks: askEffects,
  stopTurn: () => Effect.void,
  offer: (target, turnId) => offerBriefing({ writer, now: () => NOW }, target, turnId),
  deliverCompletion: () => Effect.void,
  now: () => NOW,
  report: () => undefined,
});
const sessionRecord = voiceSessionRecord(() => NOW);

/** An eve session id of this test's own: the relay names a turn by session and eve turn, so a counted id would collide across the files that share one database on CI. */
function mintEveSession(): string {
  return `wrun_${randomUUID()}`;
}

interface FakeEve extends EveSessions {
  readonly opened: EveMessage[];
}

function fakeEve(): FakeEve {
  const eve: FakeEve = {
    opened: [],
    open(message) {
      eve.opened.push(message);
      return Effect.succeed({ outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId: mintEveSession() });
    },
    send(sessionId) {
      return Effect.succeed({
        outcome: EVE_SEND_OUTCOME.ACCEPTED,
        sessionId,
        deliveryId: "delivery-1",
      });
    },
    cancel() {
      return Effect.succeed({ outcome: EVE_SEND_OUTCOME.ACCEPTED });
    },
  };
  return eve;
}

async function account(): Promise<ConversationTarget> {
  const userId = await database.createUser();
  const conversationId = await insertConversation(database.run, { userId });
  return { userId, conversationId };
}

async function device(userId: string): Promise<string> {
  const id = randomUUID();
  await insertDevice(database.run, {
    id,
    userId,
    installationId: `install-${id}`,
    platform: DEVICE_PLATFORM.IOS,
    lastSeenAt: new Date(NOW),
  });
  return id;
}

async function play(events: readonly MessageStreamEvent[], standing: RelayStanding) {
  for (const event of events) await database.run(relay.handle(event, standing));
}

/**
 * The exchange keeps time on the store runtime's clock, which is the real
 * one, so this suite runs under `it.live`: a wait for a row is a poll on a
 * `Schedule` (`settled`), and a wait after an offer the exchange must leave
 * alone is the suite's one plain sleep, asserting that nothing is appended.
 */
const QUIET_MS = 30;

/** The exchange composed over one scripted session, the way the voice service would compose it once it attaches. */
async function stand(target: ConversationTarget, deviceId: string | undefined) {
  const liveSessionId = `sess_${randomUUID()}`;
  await database.run(sessionRecord.register({ userId: target.userId, sessionId: liveSessionId }));
  if (deviceId !== undefined) {
    await setVoiceSessionDeviceId(database.run, liveSessionId, deviceId);
  }
  const socket = new FakeLiveSocket();
  // The session's side of every send, as OpenAI would answer it: each append acknowledged
  // on the timeline at once, and a close answered with the final event.
  socket.onSent((frame) => {
    const sent: LiveClientEvent = JSON.parse(frame);
    if (sent.type === LIVE_CLIENT_EVENT.CLOSE) {
      socket.receive({
        type: LIVE_SERVER_EVENT.SESSION_CLOSED,
        event_id: "closed",
        reason: LIVE_CLOSE_REASON.CLOSE_REQUESTED,
        usage: { seconds: 1 },
      });
      return;
    }
    const acknowledged = ACKNOWLEDGMENT_OF.get(sent.type);
    if (acknowledged === undefined) return;
    socket.receive({
      type: acknowledged,
      event_id: `ack-${sent.event_id}`,
      client_event_id: sent.event_id,
      start_ms: 0,
      end_ms: APPEND_END_MS,
    });
  });
  const eve = fakeEve();
  const reports: string[] = [];
  // The socket's own scope, as the attachment opens one: the exchange is built in it and the test's own stop closes it.
  const scope = await database.run(Scope.make());
  const standing = await database.run(
    Scope.provide(
      hostedLiveExchange({
        userId: target.userId,
        liveSessionId,
        conversationId: target.conversationId,
        context: { keys: KEYS },
        writer,
        eve,
        now: () => NOW,
        createId: () => randomUUID(),
        report: (message) => reports.push(message),
      }),
      scope,
    ),
  );
  const exchange = { ...standing, stop: () => database.run(Scope.close(scope, Exit.void)) };
  const adopted = await database.run(
    exchange.adopt({
      sessionId: liveSessionId,
      attach: () => Effect.succeed(sidebandOverSocket(socket)),
      started: false,
    }),
  );
  assert.ok(adopted);
  socket.receive(sessionStarted(liveSessionId));
  const commentary = (): LiveAppendEvent[] =>
    socket.sent
      .map((frame): LiveClientEvent => JSON.parse(frame))
      .filter(
        (event): event is LiveAppendEvent => event.type === LIVE_CLIENT_EVENT.COMMENTARY_APPEND,
      );
  return { liveSessionId, socket, eve, exchange, reports, commentary };
}

function socketSent(f: { socket: FakeLiveSocket }): string {
  const types = f.socket.sent.map((frame) => {
    const sent: LiveClientEvent = JSON.parse(frame);
    return sent.type;
  });
  return JSON.stringify(types);
}

async function speechEventsOf(messageId: string) {
  const rows = await readEventsByMessage(database.run, messageId);
  return rows.map((row) => row.kind);
}

it.live(
  "a spoken ask runs a turn through the ask door and is spoken from the service's own appends, its words one user message and both speakers' words segments",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      const f = yield* Effect.promise(() => stand(target, undefined));
      f.socket.receive(heard("What needs me?", 1000, 2400));
      f.socket.receive(delegated("dl_1", 2500));
      yield* settled(
        () => f.eve.opened.length === 1,
        "the ask to reach eve",
        async () => `reports ${JSON.stringify(f.reports)}`,
      );
      assert.deepEqual(
        f.eve.opened.map((message) => [message.conversationId, message.turn]),
        [[target.conversationId, BRAIN_HOST_TURN.SPOKEN]],
      );
      const recorded = yield* Effect.promise(() =>
        asks.latestSession(target.userId, target.conversationId),
      );
      assert.ok(recorded);
      yield* Effect.promise(() =>
        play(spokenTurn(FIRST_EVE_TURN, NOW), {
          sessionId: recorded,
          target,
          kind: CONVERSATION_KIND.MAIN,
          turn: BRAIN_HOST_TURN.SPOKEN,
          model: "scripted-model",
          state: memoryRelayState(),
        }),
      );
      const diagnosis = async () => {
        const ask = (await asks.latestSession(target.userId, target.conversationId)) ?? "none";
        const turn = await database.run(
          database.store.turns.named(target.userId, [hostTurnId(recorded, FIRST_EVE_TURN)]),
        );
        const rows = (
          await readMessagesByConversationTyped(database.run, target.conversationId)
        ).map((row) => ({ clientId: row.clientId, role: row.role }));
        return `ask session ${ask}; turn rows ${turn.length} (${turn[0]?.status}); messages ${JSON.stringify(rows)}; commentary ${JSON.stringify(f.commentary().map((e) => e.content))}; reports ${JSON.stringify(f.reports)}; sent ${socketSent(f)}`;
      };
      yield* settled(() => f.commentary().length >= 2, "the reply to be spoken", diagnosis);
      assert.deepEqual(
        f.commentary().map((event) => [event.delegation_id, event.content]),
        [
          ["dl_1", "One agent finished."],
          ["dl_1", "Another is waiting on you."],
        ],
      );
      const rows = yield* Effect.promise(() =>
        readMessagesByConversationTyped(database.run, target.conversationId),
      );
      // One user row stands for one spoken ask: the developer's words as the session transcribed
      // them, under the id the service's ledger minted, naming the delegation that is the ask's
      // id, and tied to the turn the ask ran. The question as eve received it is on the ask's
      // record, never a second line.
      const userRows = rows
        .filter((row) => row.role === MESSAGE_ROLE.USER)
        .map((row) => [delegationOf(row), row.turnId]);
      assert.deepEqual(userRows, [["dl_1", hostTurnId(recorded, FIRST_EVE_TURN)]]);
      const [session] = yield* Effect.promise(() =>
        readVoiceSessionByLiveSessionId(database.run, f.liveSessionId),
      );
      assert.ok(session);
      const segments = yield* Effect.promise(() =>
        readVoiceTranscriptSegmentsBySession(
          database.run,
          Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(session).id,
        ),
      );
      assert.deepEqual(
        segments.map((segment) => segment.text),
        ["What needs me?"],
      );
      yield* Effect.promise(() => f.exchange.stop());
    }),
);

it.live(
  "a briefing on offer is claimed as the session's device before it is appended, and the session's own voice past the append marks it spoken",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      const deviceId = yield* Effect.promise(() => device(target.userId));
      const f = yield* Effect.promise(() => stand(target, deviceId));
      const standing: RelayStanding = {
        sessionId: mintEveSession(),
        target,
        kind: CONVERSATION_KIND.MAIN,
        turn: BRAIN_HOST_TURN.OBSERVATION,
        model: "scripted-model",
        state: memoryRelayState(),
      };
      yield* Effect.promise(() =>
        play(announceTurn(FIRST_EVE_TURN, "One agent finished.", NOW), standing),
      );
      const [offer] = yield* Effect.promise(() =>
        database.run(database.store.speech.open(target.userId)),
      );
      assert.ok(offer);

      yield* Effect.promise(() => database.run(f.exchange.briefings.look));
      yield* settled(
        () => f.commentary().length === 1,
        "the briefing to be appended",
        async () => `reports ${JSON.stringify(f.reports)}`,
      );
      assert.deepEqual(
        f.commentary().map((event) => [event.delegation_id, event.content]),
        [[null, "One agent finished."]],
      );
      assert.deepEqual(yield* Effect.promise(() => speechEventsOf(offer.messageId)), [
        CONVERSATION_EVENT_KIND.SPEECH_OFFERED,
        CONVERSATION_EVENT_KIND.SPEECH_CLAIMED,
      ]);

      f.socket.receive({
        type: LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA,
        event_id: "out-1",
        delta: "One agent finished.",
        start_ms: 4000,
        end_ms: 5200,
      });
      yield* settled(
        async () => (await speechEventsOf(offer.messageId)).length === 3,
        "the spoken mark",
      );
      assert.deepEqual(yield* Effect.promise(() => speechEventsOf(offer.messageId)), [
        CONVERSATION_EVENT_KIND.SPEECH_OFFERED,
        CONVERSATION_EVENT_KIND.SPEECH_CLAIMED,
        CONVERSATION_EVENT_KIND.SPEECH_SPOKEN,
      ]);
      assert.deepEqual(f.reports, []);
      yield* Effect.promise(() => f.exchange.stop());
    }),
);

it.live(
  "a session whose row names no device appends no briefing: the offer stands unclaimed for the push or the sweep",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      const f = yield* Effect.promise(() => stand(target, undefined));
      yield* Effect.promise(() =>
        play(announceTurn(FIRST_EVE_TURN, "Not for this session.", NOW), {
          sessionId: mintEveSession(),
          target,
          kind: CONVERSATION_KIND.MAIN,
          turn: BRAIN_HOST_TURN.OBSERVATION,
          model: "scripted-model",
          state: memoryRelayState(),
        }),
      );
      const [offer] = yield* Effect.promise(() =>
        database.run(database.store.speech.open(target.userId)),
      );
      assert.ok(offer);
      yield* Effect.promise(() => database.run(f.exchange.briefings.look));
      yield* Effect.sleep(QUIET_MS);
      assert.deepEqual(f.commentary(), []);
      assert.deepEqual(yield* Effect.promise(() => speechEventsOf(offer.messageId)), [
        CONVERSATION_EVENT_KIND.SPEECH_OFFERED,
      ]);
      assert.equal(f.reports.length, 1);
      yield* Effect.promise(() => f.exchange.stop());
    }),
);

it.live(
  "after a Clear, a spoken ask is refused at the door and eve is not reached: the record and the ask name one conversation, never the record's old main and eve's new one",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      const deviceId = yield* Effect.promise(() => device(target.userId));
      const f = yield* Effect.promise(() => stand(target, deviceId));
      const cleared = yield* Effect.promise(() =>
        database.run(database.store.main.clear(target.userId, new Date(NOW))),
      );
      assert.deepEqual(cleared.cleared, [target.conversationId]);

      const refused = yield* Effect.promise(() =>
        database.run(
          f.exchange.brain.submitAsk({
            submissionId: randomUUID(),
            question: "Developer: still there?",
          }),
        ),
      );
      assert.equal(refused.outcome, LIVE_BRAIN_SUBMISSION.REFUSED);
      assert.deepEqual(f.eve.opened, []);
      yield* Effect.promise(() => f.exchange.stop());
    }),
);
