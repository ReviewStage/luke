import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { it } from "@effect/vitest";
import { VOICE_SERVICE_FRAME, VOICE_SERVICE_HEADER, VOICE_SERVICE_PATH } from "@sidecar/hosted";
import {
  LIVE_AUDIO_FORMAT,
  PROACTIVE_SPEECH_KIND,
  speechAppends,
  speechOpening,
} from "@sidecar/live";
import { STOP_SPEAKING_INSTRUCTION } from "@sidecar/voice/live-session";
import { isRecord, unparsedWire, type WireRecord } from "@sidecar/wire";
import { Effect, Exit, Schema, Scope } from "effect";
import { afterAll } from "vitest";
import {
  CONVERSATION_EVENT_KIND,
  DEVICE_PLATFORM,
  HOSTED_API_ERROR,
  MESSAGE_ROLE,
} from "../server/core";
import { CONVERSATION_KIND } from "../server/db/storage-vocabulary";
import { offerBriefing } from "../server/hosted/brain-host/announce";
import { BRAIN_HOST_TURN } from "../server/hosted/brain-host/bounds";
import {
  EVE_SEND_OUTCOME,
  type EveMessage,
  type EveSessions,
} from "../server/hosted/brain-host/eve-sessions";
import { memoryRelayState, StreamRelay } from "../server/hosted/brain-host/relay";
import { CATALOG_TOOL_SET } from "../server/hosted/brain-tool-set";
import { type ConversationTarget, storeWriter } from "../server/hosted/store";
import { askRecord } from "../server/hosted/store/asks";
import {
  LIVE_CLIENT_EVENT,
  LIVE_INPUT_AUDIO_APPEND,
  LIVE_SERVER_EVENT,
  LIVE_VOICE,
  type LiveClientEvent,
  SEED_CONTENT_TYPE,
  SEED_ITEM_TYPE,
  SEED_ROLE,
} from "../server/live";
import { deploymentExchange } from "../server/voice/deployment-exchange";
import { VOICE_ROUTE } from "../server/voice/frames";
import type { AttachedSession, ExchangeReport } from "../server/voice/live-exchange";
import { LOG_EVENT, type LogEntry } from "../server/voice/log";
import { UNPERMITTED_FRAME_REASON } from "../server/voice/relay";
import {
  listening,
  VoiceService,
  type VoiceServiceOptions,
  voiceServer,
} from "../server/voice/service";
import { voiceSessionRecord } from "../server/voice/session-record";
import { SOCKET_CLOSE_CODE } from "../server/voice/socket";
import { announceTurn, FIRST_EVE_TURN, spokenTurn } from "./support/eve-turns";
import { openHostedStoreTestDatabase, TEST_PAYLOAD_SECRET } from "./support/hosted-store-database";
import {
  appended,
  delegated,
  heard,
  said,
  sessionStarted,
  thinkingAppended,
} from "./support/live-events";
import {
  insertConversation,
  insertDevice,
  readEventsByConversation,
  readEventsByMessage,
  readMessagesByConversationTyped,
  readVoiceSessionsByUserTyped,
  readVoiceTranscriptSegmentsBySession,
} from "./support/store-rows";
import {
  connect,
  fakeAccounts,
  readSocket,
  type SocketReader,
  send,
  sendText,
  startFakeOpenAi,
} from "./support/voice-fakes";

/**
 * The hosted exchange attached to the sessions route, over the real store on
 * PGlite, a fake OpenAI at the far end of the sideband, and a fake eve behind
 * the ask door. The exchange is offered as the route itself offers it: through
 * `deploymentExchange`, the composition `voice/function.ts` passes, over this
 * suite's database and secret rather than the deployment's, with eve alone
 * handed in as a fake. What these tests hold to is the production case: the
 * exchange stands before the desktop is answered, seeds nothing a second
 * time, reads the developer's words off the same sideband the relay pipes,
 * answers through eve and appends the reply upstream while the desktop still
 * receives every server frame; the desktop's stop passes and its idle report
 * reaches the exchange, which closes the session on it; an older desktop's
 * own append is refused with the close; a deployment missing a secret, or an
 * exchange that cannot stand, refuses the session; and when the relay settles
 * the exchange's record writes are drained before the session is reported
 * ended. The inert case stays as the statement of what the service does
 * without a seam, a configuration nothing ships. Every row is an account's
 * this test created.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const NOW = 1_800_000_000_000;

const DelegatedMetadataSchema = Schema.Struct({ delegation_id: Schema.String });

/** The delegation a row's metadata names, where it names one. */
function delegationOf(row: { readonly metadata: unknown }): string | undefined {
  return Schema.is(DelegatedMetadataSchema)(row.metadata) ? row.metadata.delegation_id : undefined;
}
const API_KEY = "sk-test-project-key";
const BEARER = "Bearer account-token-1";
const SDP_OFFER =
  "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
const CLOSE_TIMEOUT_MS = 300;
/** How long a frame is waited on where none is expected, before its absence counts. */
const QUIET_MS = 150;

const SEED = [
  {
    type: SEED_ITEM_TYPE,
    role: SEED_ROLE.USER,
    content: [{ type: SEED_CONTENT_TYPE.INPUT_TEXT, text: "What needs me?" }],
  },
  {
    type: SEED_ITEM_TYPE,
    role: SEED_ROLE.ASSISTANT,
    content: [{ type: SEED_CONTENT_TYPE.OUTPUT_TEXT, text: "Nothing yet." }],
  },
];

const writer = await database.run(
  storeWriter({
    tools: CATALOG_TOOL_SET,
    now: () => new Date(NOW),
  }),
);
const askEffects = askRecord();
const asks = {
  latestSession: (userId: string, conversationId: string) =>
    database.run(askEffects.latestSession(userId, conversationId)),
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

interface FakeEve extends EveSessions {
  readonly opened: EveMessage[];
}

function fakeEve(): FakeEve {
  const eve: FakeEve = {
    opened: [],
    async open(message) {
      eve.opened.push(message);
      return { outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId: `wrun_${randomUUID()}` };
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

async function account(): Promise<ConversationTarget> {
  const userId = await database.createUser();
  const conversationId = await insertConversation(database.run, { userId });
  return { userId, conversationId };
}

function record(text: string): WireRecord {
  const value = unparsedWire(JSON.parse(text));
  assert.ok(isRecord(value));
  return value;
}

function clientEvent(text: string): LiveClientEvent {
  // SAFETY: the fake upstream is handed only what the service and the desktop send, which is Live client events.
  return JSON.parse(text) as LiveClientEvent;
}

/** Every frame the upstream reader has within the quiet window; none is a claim, not a timeout. */
async function framesWithin(reader: SocketReader, ms: number): Promise<LiveClientEvent[]> {
  const frames: LiveClientEvent[] = [];
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      frames.push(clientEvent(await reader.next(Math.max(1, deadline - Date.now()))));
    } catch {
      break;
    }
  }
  return frames;
}

async function until(predicate: () => boolean, what: () => string): Promise<void> {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    if (predicate()) return;
    await sleep(5);
  }
  assert.fail(`timed out waiting for ${what()}`);
}

interface Stand {
  readonly target: ConversationTarget;
  readonly eve: FakeEve;
  readonly log: LogEntry[];
  readonly reports: ExchangeReport[];
  readonly openAi: Awaited<ReturnType<typeof startFakeOpenAi>>;
  /** Every session the attachment was offered, in order, as the route described it. */
  readonly offered: AttachedSession[];
  /** Lets a gated attachment proceed; a no-op for every other offer. */
  release(): void;
  url(path: string): string;
  stop(): Promise<void>;
}

/** How the exchange is offered: as the route does, not at all, one that cannot stand, one on a deployment missing its secret, or one held until the test releases it. */
const OFFER = {
  NONE: "none",
  EXCHANGE: "exchange",
  FAILING: "failing",
  UNCONFIGURED: "unconfigured",
  GATED: "gated",
} as const;

type Offer = (typeof OFFER)[keyof typeof OFFER];

/** The service for one account, with the exchange offered as the route would offer it, or nothing, or one that cannot stand. */
async function stand(offer: Offer): Promise<Stand> {
  const target = await account();
  const openAi = await startFakeOpenAi();
  const eve = fakeEve();
  const log: LogEntry[] = [];
  const reports: ExchangeReport[] = [];
  const accounts = { ...fakeAccounts(), resolveUserId: () => Effect.succeedSome(target.userId) };
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const attachment: VoiceServiceOptions["exchange"] =
    offer === OFFER.NONE
      ? undefined
      : offer === OFFER.FAILING
        ? () => Effect.fail(new Error("the store is not reachable"))
        : deploymentExchange({
            encryptionSecret: () =>
              offer === OFFER.UNCONFIGURED ? undefined : TEST_PAYLOAD_SECRET,
            deploymentSecret: () => "deployment-secret",
            eveOrigin: () => "https://eve.test",
            eve: () => eve,
            now: () => NOW,
            report: (reported) => reports.push(reported),
          });
  const offered: AttachedSession[] = [];
  const exchange: VoiceServiceOptions["exchange"] =
    attachment === undefined
      ? undefined
      : (session) =>
          Effect.gen(function* () {
            offered.push(session);
            if (offer === OFFER.GATED) yield* Effect.promise(() => gate);
            return yield* attachment(session);
          });
  const voice = voiceServer();
  const scope = await database.run(Scope.make());
  const port = await database.run(
    Scope.provide(
      Effect.gen(function* () {
        const listener = yield* listening(voice, 0, "127.0.0.1");
        yield* VoiceService.make({
          server: voice,
          apiKey: API_KEY,
          accounts,
          record: sessionRecord,
          openAiBaseUrl: openAi.baseUrl,
          log: (entry) => {
            log.push(entry);
          },
          closeTimeoutMs: CLOSE_TIMEOUT_MS,
          firstFrameTimeoutMs: 1_000,
          attachTimeoutMs: 2_000,
          ...(exchange === undefined ? undefined : { exchange }),
        });
        return listener;
      }),
      scope,
    ),
  );
  return {
    target,
    eve,
    log,
    reports,
    openAi,
    offered,
    release: () => release(),
    url: (path) => `ws://127.0.0.1:${port}${path}`,
    stop: async () => {
      await database.run(Scope.close(scope, Exit.void));
      await openAi.close();
    },
  };
}

/** A signed-in desktop through to a standing session: the created frame read, and OpenAI's end of the sideband. */
async function openSession(context: Stand) {
  const opened = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), { authorization: BEARER });
  assert.ok("reader" in opened);
  const desktop = opened.reader;
  await send(desktop.socket, {
    type: VOICE_SERVICE_FRAME.SESSION_CREATE,
    sdp: SDP_OFFER,
    voice: LIVE_VOICE.MARIN,
    input: SEED,
  });
  const attach = await context.openAi.nextAttach();
  // The upstream reader stands the instant the attach lands, ahead of the created frame, so a frame
  // the service sent between its attach and its answer is seen rather than lost before any listener.
  const upstream = readSocket(attach.socket);
  const created = record(await desktop.next());
  return { desktop, upstream, attach, created };
}

/** The session speaks: started, the developer's words, and the delegation that cuts them. */
async function speak(attachSocket: Parameters<typeof sendText>[0], sessionId: string) {
  await sendText(attachSocket, JSON.stringify(sessionStarted(sessionId)));
  await sendText(attachSocket, JSON.stringify(heard("What needs me?", 1000, 2400)));
  await sendText(attachSocket, JSON.stringify(delegated("dl_1", 2500)));
}

/** The desktop hangs up; the session answers the relay's close; the service reports the session ended. */
async function hangUp(context: Stand, session: Awaited<ReturnType<typeof openSession>>) {
  session.desktop.socket.close(SOCKET_CLOSE_CODE.NORMAL);
  const closing = clientEvent(await session.upstream.next());
  assert.equal(closing.type, LIVE_CLIENT_EVENT.CLOSE);
  await sendText(
    session.attach.socket,
    JSON.stringify({
      type: LIVE_SERVER_EVENT.SESSION_CLOSED,
      event_id: "closed",
      reason: "close_requested",
      usage: { seconds: 4 },
    }),
  );
  await until(
    () => context.log.some((entry) => entry.event === LOG_EVENT.SESSION_ENDED),
    () => `the session to be reported ended; log ${JSON.stringify(context.log)}`,
  );
}

it.effect(
  "with no exchange offered the service only pipes: the session speaks, and nothing of Luke's reaches it, eve, or the record",
  () =>
    Effect.promise(async () => {
      const context = await stand(OFFER.NONE);
      const session = await openSession(context);
      assert.equal(session.created.type, VOICE_SERVICE_FRAME.SESSION_CREATED);
      await speak(session.attach.socket, context.openAi.attaches[0]?.sessionId ?? "");

      assert.deepEqual(await framesWithin(session.upstream, QUIET_MS), []);
      assert.deepEqual(context.eve.opened, []);
      assert.deepEqual(
        await readMessagesByConversationTyped(database.run, context.target.conversationId),
        [],
      );
      assert.equal(
        context.log.some(
          (entry) =>
            entry.event === LOG_EVENT.EXCHANGE_ATTACHED ||
            entry.event === LOG_EVENT.EXCHANGE_FAILED,
        ),
        false,
      );

      await hangUp(context, session);
      await context.stop();
    }),
);

it.effect(
  "with the exchange offered it stands before the desktop is answered, seeds nothing a second time, reads the developer's words off the piped sideband, answers through eve, and appends the reply upstream while the desktop still receives every server frame",
  () =>
    Effect.promise(async () => {
      const context = await stand(OFFER.EXCHANGE);
      const session = await openSession(context);
      assert.equal(session.created.type, VOICE_SERVICE_FRAME.SESSION_CREATED);
      assert.deepEqual(
        context.log.map((entry) => entry.event),
        [LOG_EVENT.EXCHANGE_ATTACHED, LOG_EVENT.SESSION_CREATED],
      );
      // One creation, seeded by the desktop's frame alone: the exchange adopted the session and seeded nothing.
      assert.equal(context.openAi.creates.length, 1);
      const create = context.openAi.creates[0];
      assert.ok(create && isRecord(create.body.session));
      assert.deepEqual(create.body.session.input, SEED);
      assert.deepEqual(await framesWithin(session.upstream, QUIET_MS), []);

      const upstreamSessionId = context.openAi.attaches[0]?.sessionId ?? "";
      await speak(session.attach.socket, upstreamSessionId);
      await until(
        () => context.eve.opened.length === 1,
        () => `the ask to reach eve; reports ${JSON.stringify(context.reports)}`,
      );
      assert.deepEqual(
        context.eve.opened.map((message) => [message.conversationId, message.turn]),
        [[context.target.conversationId, BRAIN_HOST_TURN.SPOKEN]],
      );
      // The desktop was handed every server frame the session spoke, raw, as the relay always did.
      const relayed = [record(await session.desktop.next()), record(await session.desktop.next())];
      assert.deepEqual(
        relayed.map((frame) => frame.type),
        [LIVE_SERVER_EVENT.SESSION_STARTED, LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA],
      );

      const eveSession = await asks.latestSession(
        context.target.userId,
        context.target.conversationId,
      );
      assert.ok(eveSession);
      const standing = {
        sessionId: eveSession,
        target: context.target,
        kind: CONVERSATION_KIND.MAIN,
        turn: BRAIN_HOST_TURN.SPOKEN,
        model: "scripted-model",
        state: memoryRelayState(),
      };
      for (const event of spokenTurn(FIRST_EVE_TURN, NOW))
        await database.run(relay.handle(event, standing));
      // The reply reaches the session as the service's own appends, each acknowledged here as OpenAI
      // would: the thinking note the reply streams under, then the sentences, which alone are spoken.
      const spoken: string[] = [];
      const kinds: string[] = [];
      const diagnosis = async () => {
        const rows = await readMessagesByConversationTyped(
          database.run,
          context.target.conversationId,
        );
        return `kinds ${JSON.stringify(kinds)}; reports ${JSON.stringify(context.reports)}; rows ${JSON.stringify(rows.map((row) => [row.role, row.clientId, row.finishedAt !== null]))}; log ${JSON.stringify(context.log.map((entry) => entry.event))}`;
      };
      while (spoken.length < 2) {
        const sent = clientEvent(
          await session.upstream.next(5_000).catch(async (error: Error) => {
            assert.fail(`${error.message}: ${await diagnosis()}`);
          }),
        );
        kinds.push(sent.type);
        if (sent.type === LIVE_CLIENT_EVENT.THINKING_APPEND) {
          await sendText(session.attach.socket, JSON.stringify(thinkingAppended(sent.event_id)));
          continue;
        }
        assert.equal(sent.type, LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
        if (sent.type !== LIVE_CLIENT_EVENT.COMMENTARY_APPEND) break;
        assert.equal(sent.delegation_id, "dl_1");
        spoken.push(sent.content);
        await sendText(
          session.attach.socket,
          JSON.stringify(
            appended(sent.event_id, 3000 + spoken.length * 1000, 4000 + spoken.length * 1000),
          ),
        );
      }
      assert.deepEqual(spoken, ["One agent finished.", "Another is waiting on you."]);
      assert.equal(kinds.includes(LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND), false);

      await hangUp(context, session);
      // The record was drained before the session was reported ended: the developer's line stands attached to the delegation.
      const rows = await readMessagesByConversationTyped(
        database.run,
        context.target.conversationId,
      );
      assert.deepEqual(
        rows.filter((row) => row.role === MESSAGE_ROLE.USER).map((row) => delegationOf(row)),
        ["dl_1"],
      );
      await context.stop();
    }),
);

it.effect(
  "an exchange offered that cannot stand refuses the session as unavailable, with the sideband released and the refusal logged, rather than running it with no one to answer",
  () =>
    Effect.promise(async () => {
      const context = await stand(OFFER.FAILING);
      const opened = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), {
        authorization: BEARER,
      });
      assert.ok("reader" in opened);
      const desktop = opened.reader;
      await send(desktop.socket, {
        type: VOICE_SERVICE_FRAME.SESSION_CREATE,
        sdp: SDP_OFFER,
        voice: LIVE_VOICE.MARIN,
        input: SEED,
      });
      const attach = await context.openAi.nextAttach();
      // The upstream reader stands the instant the attach lands: the session's
      // scope releases the sideband as it ends, which is before the refusal
      // the desktop is answered with has crossed back to this test.
      const upstream = readSocket(attach.socket);
      const refusal = record(await desktop.next());
      assert.equal(refusal.error, "unavailable");
      const closed = await desktop.closed;
      assert.equal(closed.code, SOCKET_CLOSE_CODE.POLICY_VIOLATION);
      assert.equal((await upstream.closed).code, SOCKET_CLOSE_CODE.GOING_AWAY);
      assert.deepEqual(
        context.log.map((entry) => entry.event),
        [LOG_EVENT.EXCHANGE_FAILED, LOG_EVENT.SESSION_REFUSED],
      );
      await context.stop();
    }),
);

it.effect(
  "a deployment missing the payload secret composes no exchange and refuses every session as unavailable, logged as the exchange failing",
  () =>
    Effect.promise(async () => {
      const context = await stand(OFFER.UNCONFIGURED);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const opened = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), {
          authorization: BEARER,
        });
        assert.ok("reader" in opened);
        await send(opened.reader.socket, {
          type: VOICE_SERVICE_FRAME.SESSION_CREATE,
          sdp: SDP_OFFER,
          voice: LIVE_VOICE.MARIN,
          input: SEED,
        });
        await context.openAi.nextAttach();
        assert.equal(record(await opened.reader.next()).error, HOSTED_API_ERROR.UNAVAILABLE);
        assert.equal((await opened.reader.closed).code, SOCKET_CLOSE_CODE.POLICY_VIOLATION);
      }
      assert.deepEqual(
        context.log.map((entry) => entry.event),
        [
          LOG_EVENT.EXCHANGE_FAILED,
          LOG_EVENT.SESSION_REFUSED,
          LOG_EVENT.EXCHANGE_FAILED,
          LOG_EVENT.SESSION_REFUSED,
        ],
      );
      assert.deepEqual(context.eve.opened, []);
      await context.stop();
    }),
);

it.effect(
  "the desktop's stop is read by the relay and handed to the exchange, which appends the one instruction itself under its own id; and the desktop's idle report closes the session through the exchange",
  () =>
    Effect.promise(async () => {
      const context = await stand(OFFER.EXCHANGE);
      const session = await openSession(context);
      const upstreamSessionId = context.openAi.attaches[0]?.sessionId ?? "";
      await sendText(session.attach.socket, JSON.stringify(sessionStarted(upstreamSessionId)));
      assert.equal(record(await session.desktop.next()).type, LIVE_SERVER_EVENT.SESSION_STARTED);

      // The stop, as the desktop's holder sends it: the service's own frame, forwarded nowhere.
      await send(session.desktop.socket, { type: VOICE_SERVICE_FRAME.SESSION_STOP });
      // What reaches the session is the exchange's own instruction append: its id, no delegation, the service's text.
      const instructed = clientEvent(await session.upstream.next(5_000));
      assert.equal(instructed.type, LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND);
      assert.ok(instructed.type === LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND);
      assert.equal(instructed.delegation_id, null);
      assert.equal(instructed.content, STOP_SPEAKING_INSTRUCTION);
      // OpenAI acknowledges it by the exchange's id, and the desktop is shown the acknowledgment as it is shown every server frame.
      await sendText(
        session.attach.socket,
        JSON.stringify({
          type: LIVE_SERVER_EVENT.INSTRUCTIONS_APPENDED,
          event_id: "ack-1",
          client_event_id: instructed.event_id,
          start_ms: 0,
          end_ms: 0,
        }),
      );
      assert.equal(
        record(await session.desktop.next()).type,
        LIVE_SERVER_EVENT.INSTRUCTIONS_APPENDED,
      );
      assert.deepEqual(await framesWithin(session.upstream, QUIET_MS), []);
      assert.deepEqual(context.reports, []);

      // The peer's idle: read by the relay, handed to the exchange, and never
      // forwarded. Nothing was appended since the session started and no reply
      // is in flight, so the exchange's idle window is already spent and it
      // closes the session gracefully at once.
      await send(session.desktop.socket, {
        type: VOICE_SERVICE_FRAME.SESSION_ACTIVITY,
        idle: true,
      });
      const closing = clientEvent(await session.upstream.next(5_000));
      assert.equal(closing.type, LIVE_CLIENT_EVENT.CLOSE);
      await sendText(
        session.attach.socket,
        JSON.stringify({
          type: LIVE_SERVER_EVENT.SESSION_CLOSED,
          event_id: "closed",
          reason: "close_requested",
          usage: { seconds: 9 },
        }),
      );
      // The desktop is handed the close it caused, and then its socket ends normally.
      assert.equal(record(await session.desktop.next()).type, LIVE_SERVER_EVENT.SESSION_CLOSED);
      assert.equal((await session.desktop.closed).code, SOCKET_CLOSE_CODE.NORMAL);
      await until(
        () => context.log.some((entry) => entry.event === LOG_EVENT.SESSION_ENDED),
        () => `the session to be reported ended; log ${JSON.stringify(context.log)}`,
      );
      const ended = context.log.find((entry) => entry.event === LOG_EVENT.SESSION_ENDED);
      assert.ok(ended && ended.event === LOG_EVENT.SESSION_ENDED);
      assert.equal(ended.reportsRead, 2);
      assert.equal(ended.framesToUpstream, 0);
      assert.equal(ended.seconds, 9);
      await context.stop();
    }),
);

it.effect(
  "a beat the desktop asks for is spoken by the exchange from the build's script with the frame's bounded values, and the desktop is told by kind once it was spoken to the end",
  () =>
    Effect.promise(async () => {
      const context = await stand(OFFER.EXCHANGE);
      const session = await openSession(context);
      const upstreamSessionId = context.openAi.attaches[0]?.sessionId ?? "";
      await sendText(session.attach.socket, JSON.stringify(sessionStarted(upstreamSessionId)));
      assert.equal(record(await session.desktop.next()).type, LIVE_SERVER_EVENT.SESSION_STARTED);

      // The launch greeting opens the session the guide's way, before anything else is
      // said into it: the instruction acknowledged first, then the cue.
      const launch = {
        type: VOICE_SERVICE_FRAME.SESSION_BEAT,
        kind: PROACTIVE_SPEECH_KIND.LAUNCH,
        firstName: "Ada",
      } as const;
      await send(session.desktop.socket, launch);
      const opening = speechOpening({ ...launch, decidedAt: 0 });
      assert.ok(opening);
      const instructed = clientEvent(await session.upstream.next(5_000));
      assert.equal(instructed.type, LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND);
      assert.ok(instructed.type === LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND);
      assert.equal(instructed.delegation_id, null);
      assert.equal(instructed.content, opening.instruction);
      assert.ok(opening.instruction.includes("Ada"));
      await sendText(
        session.attach.socket,
        JSON.stringify({
          type: LIVE_SERVER_EVENT.INSTRUCTIONS_APPENDED,
          event_id: "ack-launch",
          client_event_id: instructed.event_id,
          start_ms: 1000,
          end_ms: 1000,
        }),
      );
      const cued = clientEvent(await session.upstream.next(5_000));
      assert.equal(cued.type, LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
      assert.ok(cued.type === LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
      assert.equal(cued.content, opening.cue);
      await sendText(session.attach.socket, JSON.stringify(appended(cued.event_id, 1000, 2000)));
      await sendText(session.attach.socket, JSON.stringify(said("Hey Ada, I'm here.", 1000, 3000)));
      // The desktop is handed every server frame, and then the service's own word by kind alone.
      const toDesktop: string[] = [];
      for (let index = 0; index < 8; index += 1) {
        const frame = record(await session.desktop.next(5_000));
        toDesktop.push(String(frame.type));
        if (frame.type === VOICE_SERVICE_FRAME.SESSION_SPOKEN) {
          assert.deepEqual(frame, {
            type: VOICE_SERVICE_FRAME.SESSION_SPOKEN,
            kind: PROACTIVE_SPEECH_KIND.LAUNCH,
          });
          break;
        }
      }
      assert.deepEqual(toDesktop, [
        LIVE_SERVER_EVENT.INSTRUCTIONS_APPENDED,
        LIVE_SERVER_EVENT.COMMENTARY_APPENDED,
        LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA,
        VOICE_SERVICE_FRAME.SESSION_SPOKEN,
      ]);
      assert.deepEqual(await framesWithin(session.upstream, QUIET_MS), []);

      // The arrival beat, as the desktop's holder sends it: the kind and the two values its script may mention.
      const arrival = {
        type: VOICE_SERVICE_FRAME.SESSION_BEAT,
        kind: PROACTIVE_SPEECH_KIND.ARRIVAL,
        sessionTitle: "Fix the flaky test",
        talkKeyLabel: "Right Option",
      } as const;
      await send(session.desktop.socket, arrival);
      // What reaches the session is the exchange's own commentary append under no delegation,
      // the build's script with the frame's values inside it and nothing of the desktop's wording.
      const spoken = clientEvent(await session.upstream.next(5_000));
      assert.equal(spoken.type, LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
      assert.ok(spoken.type === LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
      assert.equal(spoken.delegation_id, null);
      const [script] = speechAppends({ ...arrival, decidedAt: 0 });
      assert.equal(spoken.content, script);
      assert.ok(script?.includes('titled "Fix the flaky test"'));
      assert.ok(script?.includes("holding the Right Option key"));
      await sendText(session.attach.socket, JSON.stringify(appended(spoken.event_id, 4000, 7000)));
      // Output short of the append's end is not the beat spoken; output past it is.
      await sendText(session.attach.socket, JSON.stringify(said("You're all set.", 4000, 6000)));
      assert.deepEqual(await framesWithin(session.upstream, QUIET_MS), []);
      await sendText(session.attach.socket, JSON.stringify(said(" Go back to work.", 6000, 7500)));
      const seen: string[] = [];
      for (let index = 0; index < 8; index += 1) {
        const frame = record(await session.desktop.next(5_000));
        seen.push(String(frame.type));
        if (frame.type === VOICE_SERVICE_FRAME.SESSION_SPOKEN) {
          assert.deepEqual(frame, {
            type: VOICE_SERVICE_FRAME.SESSION_SPOKEN,
            kind: PROACTIVE_SPEECH_KIND.ARRIVAL,
          });
          break;
        }
      }
      assert.deepEqual(seen, [
        LIVE_SERVER_EVENT.COMMENTARY_APPENDED,
        LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA,
        LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA,
        VOICE_SERVICE_FRAME.SESSION_SPOKEN,
      ]);
      assert.deepEqual(await framesWithin(session.upstream, QUIET_MS), []);
      assert.deepEqual(context.eve.opened, []);

      await hangUp(context, session);
      const ended = context.log.find((entry) => entry.event === LOG_EVENT.SESSION_ENDED);
      assert.ok(ended && ended.event === LOG_EVENT.SESSION_ENDED);
      assert.equal(ended.reportsRead, 2);
      assert.equal(ended.framesToUpstream, 0);
      await context.stop();
    }),
);

it.effect(
  "an older desktop build's own append is refused at the relay with the close, before it reaches the session, and the exchange still ends the session with its record",
  () =>
    Effect.promise(async () => {
      const context = await stand(OFFER.EXCHANGE);
      const session = await openSession(context);
      const upstreamSessionId = context.openAi.attaches[0]?.sessionId ?? "";
      await sendText(session.attach.socket, JSON.stringify(sessionStarted(upstreamSessionId)));
      assert.equal(record(await session.desktop.next()).type, LIVE_SERVER_EVENT.SESSION_STARTED);

      // What the unwired path would have sent: the local exchange speaking a reply.
      await send(session.desktop.socket, {
        type: LIVE_CLIENT_EVENT.COMMENTARY_APPEND,
        event_id: "old-desktop-1",
        delegation_id: "dl_1",
        content: "One agent finished.",
      });
      const end = await session.desktop.closed;
      assert.equal(end.code, SOCKET_CLOSE_CODE.POLICY_VIOLATION);
      assert.equal(end.reason, UNPERMITTED_FRAME_REASON);
      // The refused append never reached OpenAI: the next frame there is the relay's own close.
      const closing = clientEvent(await session.upstream.next(5_000));
      assert.equal(closing.type, LIVE_CLIENT_EVENT.CLOSE);
      await sendText(
        session.attach.socket,
        JSON.stringify({
          type: LIVE_SERVER_EVENT.SESSION_CLOSED,
          event_id: "closed",
          reason: "close_requested",
          usage: { seconds: 2 },
        }),
      );
      await until(
        () => context.log.some((entry) => entry.event === LOG_EVENT.SESSION_ENDED),
        () => `the session to be reported ended; log ${JSON.stringify(context.log)}`,
      );
      assert.deepEqual(
        context.log.map((entry) => entry.event),
        [
          LOG_EVENT.EXCHANGE_ATTACHED,
          LOG_EVENT.SESSION_CREATED,
          LOG_EVENT.FRAME_REFUSED,
          LOG_EVENT.USAGE_RECORDED,
          LOG_EVENT.SESSION_ENDED,
        ],
      );
      assert.deepEqual(context.eve.opened, []);
      await context.stop();
    }),
);

it.effect(
  "a desktop that hangs up while the exchange is standing is answered nothing: the exchange is stopped, the session closed gracefully, the sideband released, and no session is reported created or ended",
  () =>
    Effect.promise(async () => {
      const context = await stand(OFFER.GATED);
      const opened = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), {
        authorization: BEARER,
      });
      assert.ok("reader" in opened);
      const desktop = opened.reader;
      await send(desktop.socket, {
        type: VOICE_SERVICE_FRAME.SESSION_CREATE,
        sdp: SDP_OFFER,
        voice: LIVE_VOICE.MARIN,
        input: SEED,
      });
      const attach = await context.openAi.nextAttach();
      const upstream = readSocket(attach.socket);
      desktop.socket.close(SOCKET_CLOSE_CODE.NORMAL);
      await desktop.closed;
      context.release();
      // The exchange's own graceful close, answered as OpenAI would, so its stop settles on the final event.
      const closing = clientEvent(await upstream.next(5_000));
      assert.equal(closing.type, LIVE_CLIENT_EVENT.CLOSE);
      await sendText(
        attach.socket,
        JSON.stringify({
          type: LIVE_SERVER_EVENT.SESSION_CLOSED,
          event_id: "closed",
          reason: "close_requested",
          usage: { seconds: 0 },
        }),
      );
      // The exchange's own graceful close is what closes the socket, normally; the release after it finds it gone.
      const upstreamClosed = await upstream.closed;
      assert.equal(upstreamClosed.code, SOCKET_CLOSE_CODE.NORMAL);
      assert.deepEqual(
        context.log.map((entry) => entry.event),
        [LOG_EVENT.EXCHANGE_ATTACHED],
      );
      await context.stop();
    }),
);

it.effect(
  "what the session speaks while the exchange is standing is read once both consumers listen: the desktop is handed the frames in order, and the exchange has heard the start and the words when the delegation arrives",
  () =>
    Effect.promise(async () => {
      const context = await stand(OFFER.GATED);
      const opened = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), {
        authorization: BEARER,
      });
      assert.ok("reader" in opened);
      const desktop = opened.reader;
      await send(desktop.socket, {
        type: VOICE_SERVICE_FRAME.SESSION_CREATE,
        sdp: SDP_OFFER,
        voice: LIVE_VOICE.MARIN,
        input: SEED,
      });
      const attach = await context.openAi.nextAttach();
      const upstream = readSocket(attach.socket);
      const upstreamSessionId = context.openAi.attaches[0]?.sessionId ?? "";
      // Spoken before either consumer listens: the exchange is still standing, the relay not yet piping.
      await sendText(attach.socket, JSON.stringify(sessionStarted(upstreamSessionId)));
      await sendText(attach.socket, JSON.stringify(heard("What needs me?", 1000, 2400)));
      await sleep(QUIET_MS);
      context.release();
      const created = record(
        await desktop.next(5_000).catch((error: Error) => {
          assert.fail(
            `${error.message}: log ${JSON.stringify(context.log.map((entry) => entry.event))}; reports ${JSON.stringify(context.reports)}; upstream open ${attach.socket.readyState}`,
          );
        }),
      );
      assert.equal(created.type, VOICE_SERVICE_FRAME.SESSION_CREATED);
      const relayed: string[] = [];
      const deadline = Date.now() + 1_500;
      while (Date.now() < deadline) {
        try {
          relayed.push(String(record(await desktop.next(Math.max(1, deadline - Date.now()))).type));
        } catch {
          break;
        }
      }
      assert.deepEqual(
        relayed,
        [LIVE_SERVER_EVENT.SESSION_STARTED, LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA],
        `desktop frames after created: ${JSON.stringify(relayed)}; log ${JSON.stringify(context.log.map((entry) => entry.event))}; reports ${JSON.stringify(context.reports)}; upstream paused ${attach.socket.isPaused}`,
      );
      await sendText(attach.socket, JSON.stringify(delegated("dl_1", 2500)));
      await until(
        () => context.eve.opened.length === 1,
        () => `the ask to reach eve; reports ${JSON.stringify(context.reports)}`,
      );
      assert.deepEqual(
        context.eve.opened.map((message) => [message.conversationId, message.turn]),
        [[context.target.conversationId, BRAIN_HOST_TURN.SPOKEN]],
      );
      // The acceptance itself sends nothing: until the brain answers, the exchange
      // puts no frame of its own on the session.
      assert.deepEqual(await framesWithin(upstream, QUIET_MS), []);
      await context.stop();
    }),
);

it.effect(
  "a fresh connection re-attached to a running session offers the exchange the session as started, where the creation offered it as not yet started, since the running session speaks its start to no later listener",
  () =>
    Effect.promise(async () => {
      const context = await stand(OFFER.EXCHANGE);
      const first = await openSession(context);
      assert.equal(first.created.type, VOICE_SERVICE_FRAME.SESSION_CREATED);
      const sessionId = context.openAi.attaches[0]?.sessionId ?? "";
      const again = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), {
        authorization: BEARER,
      });
      assert.ok("reader" in again);
      await send(again.reader.socket, { type: VOICE_SERVICE_FRAME.SESSION_ATTACH, sessionId });
      const reattach = await context.openAi.nextAttach();
      const reattached = record(await again.reader.next());
      assert.equal(reattached.type, VOICE_SERVICE_FRAME.SESSION_ATTACHED);
      assert.deepEqual(
        context.offered.map((session) => [session.sessionId, session.started]),
        [
          [sessionId, false],
          [sessionId, true],
        ],
      );
      // Both connections hang up; each relay's close is answered so each exchange's stop settles.
      for (const [desktop, attach, upstream] of [
        [again.reader, reattach, readSocket(reattach.socket)] as const,
        [first.desktop, first.attach, first.upstream] as const,
      ]) {
        desktop.socket.close(SOCKET_CLOSE_CODE.NORMAL);
        const closing = clientEvent(await upstream.next(5_000));
        assert.equal(closing.type, LIVE_CLIENT_EVENT.CLOSE);
        await sendText(
          attach.socket,
          JSON.stringify({
            type: LIVE_SERVER_EVENT.SESSION_CLOSED,
            event_id: `closed-${desktop.socket.url}`,
            reason: "close_requested",
            usage: { seconds: 1 },
          }),
        );
      }
      await until(
        () => context.log.filter((entry) => entry.event === LOG_EVENT.SESSION_ENDED).length === 2,
        () =>
          `both sessions to be reported ended; log ${JSON.stringify(context.log.map((entry) => entry.event))}`,
      );
      await context.stop();
    }),
);

it.effect(
  "the briefing look runs for as long as the session stands: a briefing on offer is claimed as the session's device and appended into the session with no delegation, without anyone asking for a look",
  () =>
    Effect.promise(async () => {
      const context = await stand(OFFER.EXCHANGE);
      const deviceId = randomUUID();
      await insertDevice(database.run, {
        id: deviceId,
        userId: context.target.userId,
        installationId: `install-${deviceId}`,
        platform: DEVICE_PLATFORM.IOS,
        lastSeenAt: new Date(NOW),
      });
      const opened = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), {
        authorization: BEARER,
        [VOICE_SERVICE_HEADER.DEVICE_ID]: deviceId,
      });
      assert.ok("reader" in opened);
      const desktop = opened.reader;
      await send(desktop.socket, {
        type: VOICE_SERVICE_FRAME.SESSION_CREATE,
        sdp: SDP_OFFER,
        voice: LIVE_VOICE.MARIN,
        input: SEED,
      });
      const attach = await context.openAi.nextAttach();
      const upstream = readSocket(attach.socket);
      const created = record(await desktop.next());
      assert.equal(created.type, VOICE_SERVICE_FRAME.SESSION_CREATED);
      await sendText(
        attach.socket,
        JSON.stringify(sessionStarted(context.openAi.attaches[0]?.sessionId ?? "")),
      );
      // The brain announces, as an observation turn through the relay: one briefing on offer for the account.
      const standing = {
        sessionId: `wrun_${randomUUID()}`,
        target: context.target,
        kind: CONVERSATION_KIND.MAIN,
        turn: BRAIN_HOST_TURN.OBSERVATION,
        model: "scripted-model",
        state: memoryRelayState(),
      };
      for (const event of announceTurn(FIRST_EVE_TURN, "One agent finished.", NOW)) {
        await database.run(relay.handle(event, standing));
      }
      const [offer] = await database.run(database.store.speech.open(context.target.userId));
      assert.ok(offer);
      // The exchange is offered the session as the route resolved it: the
      // phone's own row, and the platform that row named, which is what a
      // report about this session is counted by.
      assert.deepEqual(
        context.offered.map((session) => [session.deviceId, session.platform]),
        [[deviceId, DEVICE_PLATFORM.IOS]],
      );
      // The look polls on its own cadence; nothing here asks it to look.
      const spoken = clientEvent(await upstream.next(10_000));
      assert.equal(spoken.type, LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
      if (spoken.type === LIVE_CLIENT_EVENT.COMMENTARY_APPEND) {
        assert.equal(spoken.delegation_id, null);
        assert.equal(spoken.content, "One agent finished.");
      }
      assert.deepEqual(
        (await readEventsByMessage(database.run, offer.messageId)).map((row) => row.kind),
        [CONVERSATION_EVENT_KIND.SPEECH_OFFERED, CONVERSATION_EVENT_KIND.SPEECH_CLAIMED],
      );
      await hangUp(context, { desktop, upstream, attach, created });
      await context.stop();
    }),
);

/**
 * A base64 run no transcript, no ask, and no row could arrive at on its own,
 * standing in for the developer's audio and Luke's: what the record must not
 * hold a byte of.
 */
const AUDIO_MARKER = {
  DEVICE: "REVWSUNFLUFVRElPLU1BUktFUg==",
  LUKE: "TFVLRS1BVURJTy1NQVJLRVI=",
} as const;

/** A watch through to a started session on the audio route: the created frame read, and OpenAI's end of the primary socket. */
async function openAudioSession(context: Stand, deviceId: string) {
  const opened = await connect(context.url(VOICE_SERVICE_PATH.AUDIO), {
    authorization: BEARER,
    [VOICE_SERVICE_HEADER.DEVICE_ID]: deviceId,
  });
  assert.ok("reader" in opened);
  const watch = opened.reader;
  await send(watch.socket, {
    type: VOICE_SERVICE_FRAME.SESSION_CREATE,
    voice: LIVE_VOICE.MARIN,
    format: LIVE_AUDIO_FORMAT.PCM16_16K,
  });
  const primary = await context.openAi.nextPrimary();
  const upstream = readSocket(primary.socket);
  const created = record(await watch.next());
  return { watch, upstream, primary, created };
}

it.effect(
  "on the audio route one socket carries the developer's audio up and Luke's down, the exchange stands on it as started and answers through eve, and the record holds the words and not one byte of the audio",
  () =>
    Effect.promise(async () => {
      const context = await stand(OFFER.EXCHANGE);
      const deviceId = randomUUID();
      await insertDevice(database.run, {
        id: deviceId,
        userId: context.target.userId,
        installationId: `install-${deviceId}`,
        platform: DEVICE_PLATFORM.WATCHOS,
        lastSeenAt: new Date(NOW),
      });
      // The developer's first words ride in the chunk `session.started` does,
      // so the door holds them and both consumers hear them ahead of the resume.
      context.openAi.startedBeside = [JSON.stringify(heard("What needs me?", 1000, 2400))];
      const session = await openAudioSession(context, deviceId);
      assert.equal(session.created.type, VOICE_SERVICE_FRAME.SESSION_CREATED);
      assert.equal(session.created.sessionId, session.primary.sessionId);
      assert.equal(Object.hasOwn(session.created, "sdpAnswer"), false);
      assert.deepEqual(
        context.log.map((entry) => [entry.event, entry.route]),
        [
          [LOG_EVENT.EXCHANGE_ATTACHED, VOICE_ROUTE.AUDIO],
          [LOG_EVENT.SESSION_CREATED, VOICE_ROUTE.AUDIO],
        ],
      );
      // The exchange was offered the session as the route resolved it: the
      // watch's own row and platform, on the audio route, and already started,
      // since the door read `session.started` itself and the exchange will not
      // hear it again.
      assert.deepEqual(
        context.offered.map((offered) => [
          offered.route,
          offered.deviceId,
          offered.platform,
          offered.started,
        ]),
        [[VOICE_ROUTE.AUDIO, deviceId, DEVICE_PLATFORM.WATCHOS, true]],
      );
      const [row] = await readVoiceSessionsByUserTyped(database.run, context.target.userId);
      assert.ok(row);
      assert.equal(row.liveSessionId, session.primary.sessionId);
      assert.equal(row.deviceId, deviceId);

      // The developer speaks: two appends of audio up the socket, forwarded as the bytes they arrived as.
      const appends = [
        JSON.stringify({ type: LIVE_INPUT_AUDIO_APPEND, audio: AUDIO_MARKER.DEVICE }),
        JSON.stringify({ type: LIVE_INPUT_AUDIO_APPEND, audio: `${AUDIO_MARKER.DEVICE}AA==` }),
      ];
      for (const frame of appends) await sendText(session.watch.socket, frame);
      const arrived: string[] = [];
      for (let index = 0; index < appends.length; index += 1) {
        arrived.push(await session.upstream.next(5_000));
      }
      assert.deepEqual(arrived, appends);

      // The session answers on the one socket: the echo of the developer's
      // audio, Luke's audio, and the delegation that cuts the ask; the watch
      // is shown the held words, then Luke's audio, and nothing else.
      await sendText(
        session.primary.socket,
        JSON.stringify({ type: LIVE_SERVER_EVENT.INPUT_AUDIO_APPEND, audio: AUDIO_MARKER.DEVICE }),
      );
      await sendText(
        session.primary.socket,
        JSON.stringify({ type: LIVE_SERVER_EVENT.OUTPUT_AUDIO_DELTA, delta: AUDIO_MARKER.LUKE }),
      );
      await sendText(session.primary.socket, JSON.stringify(delegated("dl_1", 2500)));
      await until(
        () => context.eve.opened.length === 1,
        () => `the ask to reach eve; reports ${JSON.stringify(context.reports)}`,
      );
      assert.deepEqual(
        context.eve.opened.map((message) => [message.conversationId, message.turn]),
        [[context.target.conversationId, BRAIN_HOST_TURN.SPOKEN]],
      );
      const shown = [record(await session.watch.next()), record(await session.watch.next())];
      assert.deepEqual(
        shown.map((frame) => frame.type),
        [LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA, LIVE_SERVER_EVENT.OUTPUT_AUDIO_DELTA],
      );
      assert.equal(shown[1]?.delta, AUDIO_MARKER.LUKE);

      // The brain answers; the exchange appends the reply under its own ids
      // and the session acknowledges each, as on the sessions route.
      const eveSession = await asks.latestSession(
        context.target.userId,
        context.target.conversationId,
      );
      assert.ok(eveSession);
      const standing = {
        sessionId: eveSession,
        target: context.target,
        kind: CONVERSATION_KIND.MAIN,
        turn: BRAIN_HOST_TURN.SPOKEN,
        model: "scripted-model",
        state: memoryRelayState(),
      };
      for (const event of spokenTurn(FIRST_EVE_TURN, NOW))
        await database.run(relay.handle(event, standing));
      const spoken: string[] = [];
      while (spoken.length < 2) {
        const sent = clientEvent(await session.upstream.next(5_000));
        if (sent.type === LIVE_CLIENT_EVENT.THINKING_APPEND) {
          await sendText(session.primary.socket, JSON.stringify(thinkingAppended(sent.event_id)));
          continue;
        }
        assert.equal(sent.type, LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
        if (sent.type !== LIVE_CLIENT_EVENT.COMMENTARY_APPEND) break;
        spoken.push(sent.content);
        await sendText(
          session.primary.socket,
          JSON.stringify(
            appended(sent.event_id, 3000 + spoken.length * 1000, 4000 + spoken.length * 1000),
          ),
        );
      }
      assert.deepEqual(spoken, ["One agent finished.", "Another is waiting on you."]);
      await sendText(
        session.primary.socket,
        JSON.stringify(said("One agent finished.", 3000, 4000)),
      );

      // The watch hangs up; the relay's close goes up the same socket; the
      // session's final event ends it, and the record is drained before the
      // session is reported ended.
      session.watch.socket.close(SOCKET_CLOSE_CODE.NORMAL);
      const closing = clientEvent(await session.upstream.next(5_000));
      assert.equal(closing.type, LIVE_CLIENT_EVENT.CLOSE);
      await sendText(
        session.primary.socket,
        JSON.stringify({
          type: LIVE_SERVER_EVENT.SESSION_CLOSED,
          event_id: "closed",
          reason: "close_requested",
          usage: { seconds: 6 },
        }),
      );
      await until(
        () => context.log.some((entry) => entry.event === LOG_EVENT.SESSION_ENDED),
        () => `the session to be reported ended; log ${JSON.stringify(context.log)}`,
      );
      const ended = context.log.find((entry) => entry.event === LOG_EVENT.SESSION_ENDED);
      assert.ok(ended && ended.event === LOG_EVENT.SESSION_ENDED);
      assert.equal(ended.route, VOICE_ROUTE.AUDIO);
      // The two appends went up as the watch's own frames; the close the relay sent on its behalf is not counted as one.
      assert.equal(ended.framesToUpstream, appends.length);
      assert.equal(
        ended.bytesToUpstream,
        appends.reduce((total, frame) => total + Buffer.byteLength(frame), 0),
      );
      assert.equal(ended.droppedAudio, 1);
      assert.equal(ended.seconds, 6);

      // The record: the developer's line under the delegation's id, Luke's
      // reply, the session's segments, and its row; and across every row the
      // record can be read from, not one byte of either marker. The sideband
      // reader dropped both audio events by type before the writer saw them.
      const messages = await readMessagesByConversationTyped(
        database.run,
        context.target.conversationId,
      );
      assert.deepEqual(
        messages
          .filter((message) => message.role === MESSAGE_ROLE.USER)
          .map((message) => delegationOf(message)),
        ["dl_1"],
      );
      const events = await readEventsByConversation(database.run, context.target.conversationId);
      const sessions = await readVoiceSessionsByUserTyped(database.run, context.target.userId);
      const segments = await readVoiceTranscriptSegmentsBySession(database.run, row.id);
      assert.ok(segments.length > 0, "the writer cut the session's transcript into segments");
      assert.ok(segments.some((segment) => String(segment.text).includes("What needs me?")));
      const everything = JSON.stringify({
        messages,
        events,
        sessions,
        segments,
        eve: context.eve.opened,
        reports: context.reports,
        log: context.log,
      });
      for (const marker of Object.values(AUDIO_MARKER)) {
        assert.equal(everything.includes(marker), false, `the record holds ${marker}`);
      }
      // Nor does anything the record can be read from hold an audio-shaped row.
      assert.equal(everything.includes(LIVE_SERVER_EVENT.OUTPUT_AUDIO_DELTA), false);
      assert.equal(everything.includes(LIVE_INPUT_AUDIO_APPEND), false);
      await context.stop();
    }),
);
