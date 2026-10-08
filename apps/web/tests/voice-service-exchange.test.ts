import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import { it } from "@effect/vitest";
import { VOICE_SERVICE_FRAME, VOICE_SERVICE_PATH } from "@sidecar/hosted";
import { VOICE_PHASE } from "@sidecar/hosted/planning-view";
import { STOP_SPEAKING_INSTRUCTION } from "@sidecar/voice/live-session";
import { isRecord, unparsedWire, type WireRecord } from "@sidecar/wire";
import { Effect, Exit, Option, Redacted, Schema, Scope } from "effect";
import { afterAll } from "vitest";
import { HOSTED_API_ERROR, MESSAGE_ROLE } from "../server/core";
import { BRAIN_HOST_TURN } from "../server/hosted/brain-host/bounds";
import {
  EVE_SEND_OUTCOME,
  type EveMessage,
  type EveSessions,
} from "../server/hosted/brain-host/eve-sessions";
import { memoryRelayState, StreamRelay } from "../server/hosted/brain-host/relay";
import { HOSTED_TOOL_SET } from "../server/hosted/brain-tool-set";
import {
  createPlan,
  openPlanConversation,
  readPlan,
  savePlanDocument,
} from "../server/hosted/plan-store";
import { type ConversationTarget, storeWriter } from "../server/hosted/store";
import { askRecord } from "../server/hosted/store/asks";
import {
  LIVE_CLIENT_EVENT,
  LIVE_INPUT_BOUNDS,
  LIVE_SERVER_EVENT,
  LIVE_VOICE,
  type LiveClientEvent,
  planningOpeningInstruction,
  SEED_CONTENT_TYPE,
  SEED_ITEM_TYPE,
  SEED_ROLE,
  sessionInstructions,
  startupTokens,
} from "../server/live";
import { deploymentExchange } from "../server/voice/deployment-exchange";
import type { AttachedSession } from "../server/voice/live-exchange";
import { FINALIZATION, LOG_EVENT, type LogEntry } from "../server/voice/log";
import { UNPERMITTED_FRAME_REASON } from "../server/voice/relay";
import {
  listening,
  VoiceService,
  type VoiceServiceOptions,
  voiceServer,
} from "../server/voice/service";
import { voiceSessionRecord } from "../server/voice/session-record";
import { SOCKET_CLOSE_CODE } from "../server/voice/socket";
import { FIRST_EVE_TURN, spokenTurn } from "./support/eve-turns";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import {
  appended,
  delegated,
  heard,
  said,
  sessionStarted,
  thinkingAppended,
} from "./support/live-events";
import {
  readMessagesByConversationTyped,
  readVoiceSessionsByUserTyped,
} from "./support/store-rows";
import {
  connect,
  fakeAccounts,
  hangUpDevice,
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
 * suite's database rather than the deployment's, with eve alone
 * handed in as a fake. What these tests hold to is the production case: the
 * exchange stands before the desktop is answered, seeds nothing a second
 * time, reads the developer's words off the same sideband the relay pipes,
 * answers through eve and appends the reply upstream while the desktop still
 * receives every server frame; the desktop's stop passes and its idle report
 * reaches the exchange, which closes the session on it; an older desktop's
 * own append is refused with the close; a deployment missing a secret, or an
 * exchange that cannot stand, refuses the session; and when the relay settles
 * the exchange's record writes are drained before the session is reported
 * ended; and every call lands in the conversation of the plan it is about.
 * The inert case stays as the statement of what the service does without a
 * seam, a configuration nothing ships. Every row is an account's this test
 * created.
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
/** The log's lines about the call's opening, which the service writes of every call it creates. */
const GREETING_EVENTS: readonly LogEntry["event"][] = [
  LOG_EVENT.GREETING_SENT,
  LOG_EVENT.GREETING_ACKNOWLEDGED,
  LOG_EVENT.GREETING_REFUSED,
  LOG_EVENT.GREETING_UNACKNOWLEDGED,
  LOG_EVENT.GREETING_CUED,
];

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
    tools: HOSTED_TOOL_SET,
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
    open(message) {
      eve.opened.push(message);
      return Effect.succeed({
        outcome: EVE_SEND_OUTCOME.ACCEPTED,
        sessionId: `wrun_${randomUUID()}`,
      });
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

/** A plan the account starts, as the Plans tab's new-plan form saves one. */
const PLAN = {
  name: "Teammate invitations",
} as const;

/** An account holding one plan, and the plan's conversation every call about it lands in. */
async function account(): Promise<{ target: ConversationTarget; planId: string }> {
  const userId = await database.createUser();
  const plan = await database.run(createPlan(userId, PLAN));
  const conversationId = Option.getOrThrow(
    await database.run(openPlanConversation(userId, plan.id)),
  );
  return { target: { userId, conversationId }, planId: plan.id };
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

/** The service's own word about the plan, sent beside the relayed frames as the call goes. */
const PLAN_FRAMES: readonly unknown[] = [
  VOICE_SERVICE_FRAME.PLAN_ACTIVITY,
  VOICE_SERVICE_FRAME.PLAN_DRAFT,
];

/** The next frame relayed to the desktop, past the service's own word about the plan. */
async function relayedFrame(reader: SocketReader, timeoutMs?: number): Promise<WireRecord> {
  for (;;) {
    const frame = record(await reader.next(timeoutMs));
    if (!PLAN_FRAMES.includes(frame.type)) return frame;
  }
}

async function until(predicate: () => boolean, what: () => string): Promise<void> {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    if (predicate()) return;
    await sleep(5);
  }
  assert.fail(`timed out waiting for ${what()}`);
}

interface Stand {
  /** The account and the conversation of the plan its calls are about by default. */
  readonly target: ConversationTarget;
  readonly planId: string;
  readonly eve: FakeEve;
  readonly log: LogEntry[];
  readonly reports: string[];
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
  const { target, planId } = await account();
  const openAi = await startFakeOpenAi();
  const eve = fakeEve();
  const log: LogEntry[] = [];
  const reports: string[] = [];
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
            deploymentSecret: () =>
              offer === OFFER.UNCONFIGURED ? undefined : Redacted.make("deployment-secret"),
            eveOrigin: () => "https://eve.test",
            openAiKey: () => undefined,
            eve: () => eve,
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
    planId,
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

/** The desktop's opening frame for a call about the plan named. */
function createFrame(planId: string, input: readonly WireRecord[] = []): WireRecord {
  return {
    type: VOICE_SERVICE_FRAME.SESSION_CREATE,
    sdp: SDP_OFFER,
    voice: LIVE_VOICE.MARIN,
    input: [...input],
    planId,
  };
}

/** A signed-in desktop through to a standing session: the created frame read, and OpenAI's end of the sideband. */
async function openSession(
  context: Stand,
  planId: string = context.planId,
  input: readonly WireRecord[] = [],
) {
  const opened = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), { authorization: BEARER });
  assert.ok("reader" in opened);
  const desktop = opened.reader;
  await send(desktop.socket, createFrame(planId, input));
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

/** A call's own opening, the first thing the service sends up once the call starts. */
async function readOpening(upstream: SocketReader): Promise<void> {
  const opening = clientEvent(await upstream.next(5_000));
  assert.ok(opening.type === LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND);
  assert.equal(opening.content, planningOpeningInstruction());
}

/** The desktop hangs up; the session answers the relay's close; the service reports the session ended. */
async function hangUp(context: Stand, session: Awaited<ReturnType<typeof openSession>>) {
  await hangUpDevice(session.desktop.socket, SOCKET_CLOSE_CODE.NORMAL);
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

      // The call's opening is the service's own; nothing follows it.
      await readOpening(session.upstream);
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
      const session = await openSession(context, context.planId, SEED);
      assert.equal(session.created.type, VOICE_SERVICE_FRAME.SESSION_CREATED);
      assert.deepEqual(
        context.log.map((entry) => entry.event),
        [LOG_EVENT.EXCHANGE_ATTACHED, LOG_EVENT.SESSION_CREATED],
      );
      // One creation, seeded by the plan and the desktop's frame alone: the exchange adopted the session and seeded nothing.
      assert.equal(context.openAi.creates.length, 1);
      const create = context.openAi.creates[0];
      assert.ok(create && isRecord(create.body.session));
      assert.ok(Array.isArray(create.body.session.input));
      assert.deepEqual(create.body.session.input.slice(1), SEED);
      assert.deepEqual(await framesWithin(session.upstream, QUIET_MS), []);

      const upstreamSessionId = context.openAi.attaches[0]?.sessionId ?? "";
      await speak(session.attach.socket, upstreamSessionId);
      await readOpening(session.upstream);
      await until(
        () => context.eve.opened.length === 1,
        () => `the ask to reach eve; reports ${JSON.stringify(context.reports)}`,
      );
      assert.deepEqual(
        context.eve.opened.map((message) => [message.conversationId, message.turn]),
        [[context.target.conversationId, BRAIN_HOST_TURN.SPOKEN]],
      );
      // The desktop was handed every server frame the session spoke, raw, as the relay always did.
      const relayed = [await relayedFrame(session.desktop), await relayedFrame(session.desktop)];
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
      await send(desktop.socket, createFrame(context.planId));
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
  "a deployment missing its own secret composes no exchange and refuses every session as unavailable, logged as the exchange failing",
  () =>
    Effect.promise(async () => {
      const context = await stand(OFFER.UNCONFIGURED);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const opened = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), {
          authorization: BEARER,
        });
        assert.ok("reader" in opened);
        await send(opened.reader.socket, createFrame(context.planId));
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
      assert.equal((await relayedFrame(session.desktop)).type, LIVE_SERVER_EVENT.SESSION_STARTED);
      await readOpening(session.upstream);

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
        (await relayedFrame(session.desktop)).type,
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
      assert.equal((await relayedFrame(session.desktop)).type, LIVE_SERVER_EVENT.SESSION_CLOSED);
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
  "the session's one close is the exchange's: the Mac's hang-up, an older build's session.close, and the socket going after them put exactly one session.close up, and its session.closed is recorded",
  () =>
    Effect.promise(async () => {
      const context = await stand(OFFER.EXCHANGE);
      const session = await openSession(context);
      const upstreamSessionId = context.openAi.attaches[0]?.sessionId ?? "";
      await sendText(session.attach.socket, JSON.stringify(sessionStarted(upstreamSessionId)));
      assert.equal(record(await session.desktop.next()).type, LIVE_SERVER_EVENT.SESSION_STARTED);
      await readOpening(session.upstream);

      await send(session.desktop.socket, { type: VOICE_SERVICE_FRAME.SESSION_HANG_UP });
      const closing = clientEvent(await session.upstream.next(5_000));
      assert.equal(closing.type, LIVE_CLIENT_EVENT.CLOSE);
      // An older build's own close, and the socket going, ask again and send nothing more.
      await hangUpDevice(session.desktop.socket, SOCKET_CLOSE_CODE.NORMAL);
      assert.deepEqual(await framesWithin(session.upstream, QUIET_MS), []);
      await sendText(
        session.attach.socket,
        JSON.stringify({
          type: LIVE_SERVER_EVENT.SESSION_CLOSED,
          event_id: "closed",
          reason: "close_requested",
          usage: { seconds: 9 },
        }),
      );
      await until(
        () => context.log.some((entry) => entry.event === LOG_EVENT.SESSION_ENDED),
        () => `the session to be reported ended; log ${JSON.stringify(context.log)}`,
      );
      const ended = context.log.find((entry) => entry.event === LOG_EVENT.SESSION_ENDED);
      assert.ok(ended && ended.event === LOG_EVENT.SESSION_ENDED);
      assert.equal(ended.framesToUpstream, 0);
      assert.equal(ended.finalization, FINALIZATION.CONFIRMED);
      assert.equal(ended.seconds, 9);
      await context.stop();
    }),
);

it.effect(
  "an older build's own session.close and its socket going after it are one ask: the exchange's close is the only one that goes up",
  () =>
    Effect.promise(async () => {
      const context = await stand(OFFER.EXCHANGE);
      const session = await openSession(context);
      const upstreamSessionId = context.openAi.attaches[0]?.sessionId ?? "";
      await sendText(session.attach.socket, JSON.stringify(sessionStarted(upstreamSessionId)));
      assert.equal(record(await session.desktop.next()).type, LIVE_SERVER_EVENT.SESSION_STARTED);
      await readOpening(session.upstream);
      const olderClose = { type: LIVE_CLIENT_EVENT.CLOSE, event_id: "older-close" } as const;
      await send(session.desktop.socket, olderClose);
      session.desktop.socket.close(SOCKET_CLOSE_CODE.NORMAL);
      const closing = clientEvent(await session.upstream.next(5_000));
      assert.equal(closing.type, LIVE_CLIENT_EVENT.CLOSE);
      assert.notEqual(closing.event_id, olderClose.event_id);
      assert.deepEqual(await framesWithin(session.upstream, QUIET_MS), []);
      await sendText(
        session.attach.socket,
        JSON.stringify({
          type: LIVE_SERVER_EVENT.SESSION_CLOSED,
          event_id: "closed",
          reason: "close_requested",
          usage: { seconds: 3 },
        }),
      );
      await until(
        () => context.log.some((entry) => entry.event === LOG_EVENT.SESSION_ENDED),
        () => `the session to be reported ended; log ${JSON.stringify(context.log)}`,
      );
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
      assert.equal((await relayedFrame(session.desktop)).type, LIVE_SERVER_EVENT.SESSION_STARTED);
      await readOpening(session.upstream);

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
        context.log.map((entry) => entry.event).filter((event) => !GREETING_EVENTS.includes(event)),
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
      await send(desktop.socket, createFrame(context.planId));
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
      await send(desktop.socket, createFrame(context.planId));
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
          relayed.push(
            String((await relayedFrame(desktop, Math.max(1, deadline - Date.now()))).type),
          );
        } catch {
          break;
        }
      }
      assert.deepEqual(
        relayed,
        [LIVE_SERVER_EVENT.SESSION_STARTED, LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA],
        `desktop frames after created: ${JSON.stringify(relayed)}; log ${JSON.stringify(context.log.map((entry) => entry.event))}; reports ${JSON.stringify(context.reports)}; upstream paused ${attach.socket.isPaused}`,
      );
      // The start the session spoke while the exchange stood is the one the call opens on.
      await readOpening(upstream);
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
        await hangUpDevice(desktop.socket, SOCKET_CLOSE_CODE.NORMAL);
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

/** The conversation the plan resumes in, as the plan's row names it now. */
async function planConversationOf(userId: string, planId: string): Promise<string | undefined> {
  const stored = await database.run(readPlan(userId, planId));
  return Option.getOrUndefined(stored)?.conversationId;
}

/** The delegations the conversation's developer lines were written under, in order. */
async function spokenDelegations(conversationId: string): Promise<(string | undefined)[]> {
  const rows = await readMessagesByConversationTyped(database.run, conversationId);
  return rows.filter((row) => row.role === MESSAGE_ROLE.USER).map((row) => delegationOf(row));
}

/** The account's `voice_sessions` row for the live session named. */
async function sessionRowOf(userId: string, sessionId: string) {
  const rows = await readVoiceSessionsByUserTyped(database.run, userId);
  return rows.find((row) => row.liveSessionId === sessionId);
}

/** The session hangs up from the desktop's side and answers the relay's close, as `hangUp` does for any connection. */
async function hangUpConnection(
  desktop: SocketReader,
  attach: { readonly socket: Parameters<typeof sendText>[0] },
  upstream: SocketReader,
): Promise<void> {
  await hangUpDevice(desktop.socket, SOCKET_CLOSE_CODE.NORMAL);
  const closing = clientEvent(await upstream.next(5_000));
  assert.equal(closing.type, LIVE_CLIENT_EVENT.CLOSE);
  await sendText(
    attach.socket,
    JSON.stringify({
      type: LIVE_SERVER_EVENT.SESSION_CLOSED,
      event_id: `closed-${randomUUID()}`,
      reason: "close_requested",
      usage: { seconds: 1 },
    }),
  );
}

it.effect(
  "a call is created under the planning instructions, its spoken ask reaches eve in its plan's conversation and never another plan's, and a re-attach is bound to the same plan by the session's row",
  () =>
    Effect.promise(async () => {
      const context = await stand(OFFER.EXCHANGE);
      const plan = await database.run(createPlan(context.target.userId, PLAN));
      const session = await openSession(context, plan.id);
      assert.equal(session.created.type, VOICE_SERVICE_FRAME.SESSION_CREATED);
      const create = context.openAi.creates[0];
      assert.ok(create && isRecord(create.body.session));
      assert.equal(create.body.session.instructions, sessionInstructions());

      const sessionId = context.openAi.attaches[0]?.sessionId ?? "";
      await speak(session.attach.socket, sessionId);
      await readOpening(session.upstream);
      await until(
        () => context.eve.opened.length === 1,
        () => `the ask to reach eve; reports ${JSON.stringify(context.reports)}`,
      );
      const planned = await planConversationOf(context.target.userId, plan.id);
      assert.ok(planned);
      assert.notEqual(planned, context.target.conversationId);
      assert.deepEqual(
        context.eve.opened.map((message) => [message.conversationId, message.turn]),
        [[planned, BRAIN_HOST_TURN.SPOKEN]],
      );

      // A fresh connection names no plan; the session's row binds it, and its words land in the same plan.
      const again = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), {
        authorization: BEARER,
      });
      assert.ok("reader" in again);
      await send(again.reader.socket, { type: VOICE_SERVICE_FRAME.SESSION_ATTACH, sessionId });
      const reattach = await context.openAi.nextAttach();
      const reattachUpstream = readSocket(reattach.socket);
      assert.equal(record(await again.reader.next()).type, VOICE_SERVICE_FRAME.SESSION_ATTACHED);
      assert.deepEqual(
        context.offered.map((offered) => offered.planId),
        [plan.id, plan.id],
      );
      await sendText(reattach.socket, JSON.stringify(heard("Any member can invite.", 5000, 6400)));
      await sendText(reattach.socket, JSON.stringify(delegated("dl_2", 6500)));
      // The line is attached to its ask once the brain took it, so the hang-up waits for the record.
      const planConversation = await planConversationOf(context.target.userId, plan.id);
      assert.ok(planConversation);
      for (let attempt = 0; attempt < 600; attempt += 1) {
        if ((await spokenDelegations(planConversation)).includes("dl_2")) break;
        await sleep(5);
      }

      await hangUpConnection(again.reader, reattach, reattachUpstream);
      await hangUpConnection(session.desktop, session.attach, session.upstream);
      await until(
        () => context.log.filter((entry) => entry.event === LOG_EVENT.SESSION_ENDED).length === 2,
        () => `both connections to be reported ended; log ${JSON.stringify(context.log)}`,
      );
      assert.deepEqual(await spokenDelegations(planConversation), ["dl_1", "dl_2"]);
      assert.deepEqual(await spokenDelegations(context.target.conversationId), []);
      await context.stop();
    }),
);

it.effect(
  "a planning call tells the desktop what each part of Luke is doing, from the hand-off to nothing doing once Luke begins the reply",
  () =>
    Effect.promise(async () => {
      const context = await stand(OFFER.EXCHANGE);
      const plan = await database.run(createPlan(context.target.userId, PLAN));
      const session = await openSession(context, plan.id);
      const sessionId = context.openAi.attaches[0]?.sessionId ?? "";
      await speak(session.attach.socket, sessionId);
      await until(
        () => context.eve.opened.length === 1,
        () => `the ask to reach eve; reports ${JSON.stringify(context.reports)}`,
      );
      const nextActivity = async (): Promise<WireRecord> => {
        for (let index = 0; index < 12; index += 1) {
          const frame = record(await session.desktop.next(5_000));
          if (frame.type === VOICE_SERVICE_FRAME.PLAN_ACTIVITY) return frame;
        }
        return assert.fail("no plan.activity frame reached the desktop");
      };
      assert.deepEqual(await nextActivity(), {
        type: VOICE_SERVICE_FRAME.PLAN_ACTIVITY,
        planId: plan.id,
        voice: VOICE_PHASE.HANDING_OFF,
        notes: false,
      });

      const planned = await planConversationOf(context.target.userId, plan.id);
      const eveSession = await asks.latestSession(context.target.userId, planned ?? "");
      assert.ok(planned && eveSession);
      const standing = {
        sessionId: eveSession,
        target: { userId: context.target.userId, conversationId: planned },
        turn: BRAIN_HOST_TURN.SPOKEN,
        model: "scripted-model",
        state: memoryRelayState(),
      };
      for (const event of spokenTurn(FIRST_EVE_TURN, NOW))
        await database.run(relay.handle(event, standing));
      // Each append is acknowledged as OpenAI would, so the reply is spoken and the run can end.
      let spoken = 0;
      while (spoken < 2) {
        const sent = clientEvent(await session.upstream.next(5_000));
        if (sent.type === LIVE_CLIENT_EVENT.THINKING_APPEND) {
          await sendText(session.attach.socket, JSON.stringify(thinkingAppended(sent.event_id)));
          continue;
        }
        if (sent.type !== LIVE_CLIENT_EVENT.COMMENTARY_APPEND) continue;
        spoken += 1;
        await sendText(
          session.attach.socket,
          JSON.stringify(appended(sent.event_id, 3000 + spoken * 1000, 4000 + spoken * 1000)),
        );
      }
      await sendText(session.attach.socket, JSON.stringify(said("One agent", 6000, 6400)));
      const idle = { type: VOICE_SERVICE_FRAME.PLAN_ACTIVITY, planId: plan.id, notes: false };
      const told: WireRecord[] = [];
      while (!isDeepStrictEqual(told.at(-1), idle) && told.length < 12) {
        told.push(await nextActivity());
      }
      assert.deepEqual(told.at(-1), idle);
      assert.ok(told.some((frame) => frame.voice === VOICE_PHASE.ABOUT_TO_ANSWER));

      await hangUp(context, session);
      await context.stop();
    }),
);

it.effect(
  "a planning call whose socket drops mid-call is detached rather than closed, re-attaches, and its next ask lands in the plan's conversation",
  () =>
    Effect.promise(async () => {
      const context = await stand(OFFER.EXCHANGE);
      const plan = await database.run(createPlan(context.target.userId, PLAN));
      const session = await openSession(context, plan.id);
      const sessionId = context.openAi.attaches[0]?.sessionId ?? "";
      await speak(session.attach.socket, sessionId);
      const planConversation = await planConversationOf(context.target.userId, plan.id);
      assert.ok(planConversation);
      for (let attempt = 0; attempt < 600; attempt += 1) {
        if ((await spokenDelegations(planConversation)).includes("dl_1")) break;
        await sleep(5);
      }

      // The platform cuts the socket: no hang-up went up, so neither the
      // relay nor the exchange says `session.close` to the session.
      session.desktop.socket.terminate();
      await session.upstream.closed;
      const sentUp = await framesWithin(session.upstream, QUIET_MS);
      assert.ok(sentUp.every((event) => event.type !== LIVE_CLIENT_EVENT.CLOSE));
      await until(
        () => context.log.some((entry) => entry.event === LOG_EVENT.SESSION_ENDED),
        () => `the dropped connection to be reported ended; log ${JSON.stringify(context.log)}`,
      );
      const detached = context.log.find((entry) => entry.event === LOG_EVENT.SESSION_ENDED);
      assert.ok(detached && detached.event === LOG_EVENT.SESSION_ENDED);
      assert.equal(detached.finalization, FINALIZATION.DETACHED);
      // The row is stamped detached, so the tick would end the session if no device came back.
      const detachedRow = await sessionRowOf(context.target.userId, sessionId);
      assert.ok(detachedRow?.detachedAt);
      assert.equal(detachedRow.closedAt, null);

      const again = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), {
        authorization: BEARER,
      });
      assert.ok("reader" in again);
      await send(again.reader.socket, { type: VOICE_SERVICE_FRAME.SESSION_ATTACH, sessionId });
      const reattach = await context.openAi.nextAttach();
      const reattachUpstream = readSocket(reattach.socket);
      assert.equal(record(await again.reader.next()).type, VOICE_SERVICE_FRAME.SESSION_ATTACHED);
      // The re-attach cleared the stamp: a connection holds the session again.
      assert.equal((await sessionRowOf(context.target.userId, sessionId))?.detachedAt, null);
      await sendText(reattach.socket, JSON.stringify(heard("Any member can invite.", 5000, 6400)));
      await sendText(reattach.socket, JSON.stringify(delegated("dl_2", 6500)));
      for (let attempt = 0; attempt < 600; attempt += 1) {
        if ((await spokenDelegations(planConversation)).includes("dl_2")) break;
        await sleep(5);
      }

      await hangUpConnection(again.reader, reattach, reattachUpstream);
      await until(
        () => context.log.filter((entry) => entry.event === LOG_EVENT.SESSION_ENDED).length === 2,
        () => `the re-attached connection to be reported ended; log ${JSON.stringify(context.log)}`,
      );
      assert.deepEqual(await spokenDelegations(planConversation), ["dl_1", "dl_2"]);
      assert.deepEqual(await spokenDelegations(context.target.conversationId), []);
      await context.stop();
    }),
);

/** The text of each startup message a created session was seeded with, by role. */
function seededTexts(context: Stand, index: number): Array<{ role: unknown; text: unknown }> {
  const create = context.openAi.creates[index];
  assert.ok(create && isRecord(create.body.session));
  const input = create.body.session.input;
  assert.ok(Array.isArray(input));
  return input.map((item) => {
    assert.ok(isRecord(item) && Array.isArray(item.content) && isRecord(item.content[0]));
    return { role: item.role, text: item.content[0].text };
  });
}

it.effect(
  "a planning call opens knowing its saved plan: the name, the document, and its assumptions, and a document past the startup bound, alone or in any script, is cut from its end and never refused",
  () =>
    Effect.promise(async () => {
      const context = await stand(OFFER.EXCHANGE);
      const plan = await database.run(createPlan(context.target.userId, PLAN));
      await database.run(
        savePlanDocument(context.target.userId, plan.id, {
          body: "# Teammate invitations\n\n## Goal\nOwners invite teammates by email.\n",
          assumptions: [{ text: "Invitations expire after seven days." }],
        }),
      );
      const saved = await openSession(context, plan.id);
      const [seed, ...rest] = seededTexts(context, 0);
      assert.deepEqual(rest, []);
      assert.equal(seed?.role, SEED_ROLE.DEVELOPER);
      const text = String(seed?.text);
      for (const expected of [
        PLAN.name,
        "Owners invite teammates by email.",
        "Invitations expire after seven days.",
      ]) {
        assert.ok(text.includes(expected), `the seed to carry ${expected}; it read ${text}`);
      }
      await hangUpConnection(saved.desktop, saved.attach, saved.upstream);

      const long = await database.run(
        createPlan(context.target.userId, { ...PLAN, name: "Billing export" }),
      );
      const tail = "The last line of a very long plan.";
      await database.run(
        savePlanDocument(context.target.userId, long.id, {
          body: `# Billing export\n\n${"Every invoice row is exported. ".repeat(4_000)}\n${tail}\n`,
          assumptions: [],
        }),
      );
      const cut = await openSession(context, long.id);
      const [longSeed] = seededTexts(context, 1);
      const longText = String(longSeed?.text);
      assert.ok(longText.includes("Billing export"));
      assert.ok(!longText.includes(tail));
      assert.ok(startupTokens(longText) <= LIVE_INPUT_BOUNDS.TOKENS);
      await hangUpConnection(cut.desktop, cut.attach, cut.upstream);

      // A body past the bound on its own is still cut and never refused: a
      // CJK character is a token of its own, so twenty thousand of them are
      // more than twice the room, where four characters to a token let all of
      // them through.
      const wide = await database.run(
        createPlan(context.target.userId, { ...PLAN, name: "請求書の書き出し" }),
      );
      await database.run(
        savePlanDocument(context.target.userId, wide.id, {
          body: `# 請求書の書き出し\n\n${"請求書を書き出す。".repeat(2_500)}\n${tail}\n`,
          assumptions: [],
        }),
      );
      const wideCall = await openSession(context, wide.id);
      const [wideSeed, ...wideRest] = seededTexts(context, 2);
      assert.deepEqual(wideRest, []);
      const wideText = String(wideSeed?.text);
      assert.ok(wideText.includes("請求書の書き出し"));
      assert.ok(!wideText.includes(tail));
      assert.ok(startupTokens(wideText) <= LIVE_INPUT_BOUNDS.TOKENS);
      await hangUpConnection(wideCall.desktop, wideCall.attach, wideCall.upstream);
      await until(
        () => context.log.filter((entry) => entry.event === LOG_EVENT.SESSION_ENDED).length === 3,
        () => `all three calls to be reported ended; log ${JSON.stringify(context.log)}`,
      );
      await context.stop();
    }),
);

it.effect(
  "a plan just started is seeded as new and a plan under way as the one the call continues, so a new plan opens on no progress",
  () =>
    Effect.promise(async () => {
      const context = await stand(OFFER.EXCHANGE);
      const fresh = await database.run(createPlan(context.target.userId, PLAN));
      const freshCall = await openSession(context, fresh.id);
      const [freshSeed] = seededTexts(context, 0);
      await hangUpConnection(freshCall.desktop, freshCall.attach, freshCall.upstream);

      const saved = await database.run(createPlan(context.target.userId, PLAN));
      await database.run(
        savePlanDocument(context.target.userId, saved.id, {
          body: "# Teammate invitations\n\n## Goal\nOwners invite teammates by email.\n",
          assumptions: [],
        }),
      );
      const savedCall = await openSession(context, saved.id);
      const [savedSeed] = seededTexts(context, 1);
      await hangUpConnection(savedCall.desktop, savedCall.attach, savedCall.upstream);

      const firstLine = (seed: { text: unknown } | undefined) => String(seed?.text).split("\n")[0];
      assert.notEqual(firstLine(freshSeed), firstLine(savedSeed));
      await until(
        () => context.log.filter((entry) => entry.event === LOG_EVENT.SESSION_ENDED).length === 2,
        () => `both calls to be reported ended; log ${JSON.stringify(context.log)}`,
      );
      await context.stop();
    }),
);

it.effect(
  "a call about another plan lands in that plan's conversation alone, and a plan the account does not hold is refused as not found before any session is created",
  () =>
    Effect.promise(async () => {
      const context = await stand(OFFER.EXCHANGE);
      const first = await database.run(createPlan(context.target.userId, PLAN));
      const second = await database.run(
        createPlan(context.target.userId, { ...PLAN, name: "Billing export" }),
      );
      const stranger = await database.createUser();
      const foreign = await database.run(createPlan(stranger, PLAN));

      const firstCall = await openSession(context, first.id);
      await speak(firstCall.attach.socket, context.openAi.attaches[0]?.sessionId ?? "");
      await readOpening(firstCall.upstream);
      await until(
        () => context.eve.opened.length === 1,
        () => "the first plan's ask to reach eve",
      );
      await hangUpConnection(firstCall.desktop, firstCall.attach, firstCall.upstream);

      const secondCall = await openSession(context, second.id);
      await speak(secondCall.attach.socket, context.openAi.attaches[1]?.sessionId ?? "");
      await readOpening(secondCall.upstream);
      await until(
        () => context.eve.opened.length === 2,
        () => "the second plan's ask to reach eve",
      );
      await hangUpConnection(secondCall.desktop, secondCall.attach, secondCall.upstream);
      await until(
        () => context.log.filter((entry) => entry.event === LOG_EVENT.SESSION_ENDED).length === 2,
        () => `both calls to be reported ended; log ${JSON.stringify(context.log)}`,
      );

      const firstConversation = await planConversationOf(context.target.userId, first.id);
      const secondConversation = await planConversationOf(context.target.userId, second.id);
      assert.ok(firstConversation && secondConversation);
      assert.notEqual(firstConversation, secondConversation);
      assert.deepEqual(
        context.eve.opened.map((message) => message.conversationId),
        [firstConversation, secondConversation],
      );
      assert.deepEqual(await spokenDelegations(firstConversation), ["dl_1"]);
      assert.deepEqual(await spokenDelegations(secondConversation), ["dl_1"]);

      const refused = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), {
        authorization: BEARER,
      });
      assert.ok("reader" in refused);
      await send(refused.reader.socket, {
        type: VOICE_SERVICE_FRAME.SESSION_CREATE,
        sdp: SDP_OFFER,
        voice: LIVE_VOICE.MARIN,
        input: [],
        planId: foreign.id,
      });
      assert.equal(record(await refused.reader.next()).error, HOSTED_API_ERROR.NOT_FOUND);
      assert.equal(context.openAi.creates.length, 2);
      await context.stop();
    }),
);
