import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import {
  LIVE_BRAIN_SUBMISSION,
  type LiveSessionSource,
  sidebandOverSocket,
} from "@sidecar/voice/live-session";
import { arrival, FakeLiveSocket, onFakeChange } from "@sidecar/voice/testing";
import { Duration, Effect, Exit, Schema, Scope } from "effect";
import { TestClock } from "effect/testing";
import { SqlClient } from "effect/unstable/sql";
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
  /** Tells a waiter that eve was reached, so a wait on the ask arriving polls nothing. */
  readonly onChange: (notify: () => void) => () => void;
}

function fakeEve(): FakeEve {
  const listeners = new Set<() => void>();
  const announce = () => {
    for (const listener of [...listeners]) listener();
  };
  const eve: FakeEve = {
    opened: [],
    onChange: (notify) => {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    open(message) {
      eve.opened.push(message);
      announce();
      return Effect.succeed({ outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId: mintEveSession() });
    },
    send(sessionId) {
      announce();
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

const play = Effect.fnUntraced(function* (
  events: readonly MessageStreamEvent[],
  standing: RelayStanding,
) {
  for (const event of events) yield* relay.handle(event, standing);
});

/** The one client the suite's runtime holds, provided to the exchange's fibers so every statement takes the same permit. */
const sqlClient = await database.run(Effect.service(SqlClient.SqlClient));

/**
 * The exchange is built in the test's own fiber, so the brain's follow of an
 * accepted ask keeps time on the ambient `TestClock`: a wait here advances it
 * by that follow's own poll and awaits a real statement each time, which is
 * what lets the look the poll woke land, and nothing here waits on the
 * machine.
 */
const FOLLOW_POLL = Duration.millis(250);
/** The most steps a wait walks before it gives up, well past what any fixture here needs. */
const WAIT_STEPS = 200;
/** How many of those steps a test walks to say that nothing is appended. */
const QUIET_STEPS = 4;

/** One step of the wait: the follow's poll on the test's own clock, then a real statement. */
const step = Effect.gen(function* () {
  yield* TestClock.adjust(FOLLOW_POLL);
  yield* Effect.orDie(Effect.asVoid(sqlClient`select 1`));
});

/** Waits for what only a look can bring, naming it and reading the fixtures behind it where a test offers a diagnosis. */
function settled(
  ready: () => boolean | Promise<boolean>,
  waitedFor: string,
  diagnose?: () => Promise<string>,
) {
  return Effect.gen(function* () {
    for (let walked = 0; walked < WAIT_STEPS; walked += 1) {
      if (yield* Effect.promise(async () => ready())) return;
      yield* step;
    }
    yield* Effect.promise(async () => {
      const detail = diagnose ? `: ${await diagnose()}` : "";
      assert.fail(`timed out waiting for ${waitedFor}${detail}`);
    });
  });
}

/** The steps a test walks to say that nothing more arrives, each one a look the exchange was free to take. */
const quiet = Effect.gen(function* () {
  for (let walked = 0; walked < QUIET_STEPS; walked += 1) yield* step;
});

/** The exchange composed over one scripted session, the way the voice service would compose it once it attaches. */
const stand = Effect.fnUntraced(function* (
  target: ConversationTarget,
  deviceId: string | undefined,
) {
  const liveSessionId = `sess_${randomUUID()}`;
  yield* sessionRecord.register({ userId: target.userId, sessionId: liveSessionId });
  if (deviceId !== undefined) {
    yield* Effect.promise(() => setVoiceSessionDeviceId(database.run, liveSessionId, deviceId));
  }
  const socket = new FakeLiveSocket();
  const source: LiveSessionSource = {
    create: (input) =>
      Effect.succeed({
        sessionId: liveSessionId,
        sdpAnswer: `answer-for-${input.sdpOffer}`,
        attach: () => Effect.succeed(sidebandOverSocket(socket)),
      }),
    setVoice: () => undefined,
    diagnostics: () => {
      throw new Error("not read here");
    },
  };
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
  const scope = yield* Scope.make();
  const standing = yield* Scope.provide(
    hostedLiveExchange({
      userId: target.userId,
      liveSessionId,
      conversationId: target.conversationId,
      context: { keys: KEYS },
      writer,
      eve,
      source: () => source,
      conversationEntries: () => [],
      emit: () => undefined,
      now: () => NOW,
      createId: () => randomUUID(),
      report: (message) => reports.push(message),
    }),
    scope,
  );
  const exchange = { ...standing, stop: () => Scope.close(scope, Exit.void) };
  const created = yield* exchange.service.createSession("offer");
  assert.ok(created);
  socket.receive(sessionStarted(liveSessionId));
  const commentary = (): LiveAppendEvent[] =>
    socket.sent
      .map((frame): LiveClientEvent => JSON.parse(frame))
      .filter(
        (event): event is LiveAppendEvent => event.type === LIVE_CLIENT_EVENT.COMMENTARY_APPEND,
      );
  return { liveSessionId, socket, eve, exchange, reports, commentary };
});

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

it.effect(
  "a spoken ask runs a turn through the ask door and is spoken from the service's own appends, its words one user message and both speakers' words segments",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      const f = yield* stand(target, undefined);
      f.socket.receive(heard("What needs me?", 1000, 2400));
      f.socket.receive(delegated("dl_1", 2500));
      yield* arrival(f.eve.onChange, () => f.eve.opened.length === 1, "the ask to reach eve");
      assert.deepEqual(
        f.eve.opened.map((message) => [message.conversationId, message.turn]),
        [[target.conversationId, BRAIN_HOST_TURN.SPOKEN]],
      );
      const recorded = yield* askEffects.latestSession(target.userId, target.conversationId);
      assert.ok(recorded);
      yield* play(spokenTurn(FIRST_EVE_TURN, NOW), {
        sessionId: recorded,
        target,
        kind: CONVERSATION_KIND.MAIN,
        turn: BRAIN_HOST_TURN.SPOKEN,
        model: "scripted-model",
        state: memoryRelayState(),
      });
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
      yield* f.exchange.stop();
    }).pipe(Effect.provideService(SqlClient.SqlClient, sqlClient)),
);

it.effect(
  "a briefing on offer is claimed as the session's device before it is appended, and the session's own voice past the append marks it spoken",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      const deviceId = yield* Effect.promise(() => device(target.userId));
      const f = yield* stand(target, deviceId);
      const standing: RelayStanding = {
        sessionId: mintEveSession(),
        target,
        kind: CONVERSATION_KIND.MAIN,
        turn: BRAIN_HOST_TURN.OBSERVATION,
        model: "scripted-model",
        state: memoryRelayState(),
      };
      yield* play(announceTurn(FIRST_EVE_TURN, "One agent finished.", NOW), standing);
      const [offer] = yield* database.store.speech.open(target.userId);
      assert.ok(offer);

      yield* f.exchange.briefings.look;
      yield* arrival(
        onFakeChange,
        () => f.commentary().length === 1,
        "the briefing to be appended",
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
      yield* f.exchange.stop();
    }).pipe(Effect.provideService(SqlClient.SqlClient, sqlClient)),
);

it.effect(
  "a session whose row names no device appends no briefing: the offer stands unclaimed for the push or the sweep",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      const f = yield* stand(target, undefined);
      yield* play(announceTurn(FIRST_EVE_TURN, "Not for this session.", NOW), {
        sessionId: mintEveSession(),
        target,
        kind: CONVERSATION_KIND.MAIN,
        turn: BRAIN_HOST_TURN.OBSERVATION,
        model: "scripted-model",
        state: memoryRelayState(),
      });
      const [offer] = yield* database.store.speech.open(target.userId);
      assert.ok(offer);
      yield* f.exchange.briefings.look;
      yield* quiet;
      assert.deepEqual(f.commentary(), []);
      assert.deepEqual(yield* Effect.promise(() => speechEventsOf(offer.messageId)), [
        CONVERSATION_EVENT_KIND.SPEECH_OFFERED,
      ]);
      assert.equal(f.reports.length, 1);
      yield* f.exchange.stop();
    }).pipe(Effect.provideService(SqlClient.SqlClient, sqlClient)),
);

it.effect(
  "after a Clear, a spoken ask is refused at the door and eve is not reached: the record and the ask name one conversation, never the record's old main and eve's new one",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      const deviceId = yield* Effect.promise(() => device(target.userId));
      const f = yield* stand(target, deviceId);
      const cleared = yield* database.store.main.clear(target.userId, new Date(NOW));
      assert.deepEqual(cleared.cleared, [target.conversationId]);

      const refused = yield* f.exchange.brain.submitAsk({
        submissionId: randomUUID(),
        question: "Developer: still there?",
      });
      assert.equal(refused.outcome, LIVE_BRAIN_SUBMISSION.REFUSED);
      assert.deepEqual(f.eve.opened, []);
      yield* f.exchange.stop();
    }).pipe(Effect.provideService(SqlClient.SqlClient, sqlClient)),
);
