import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { VOICE_SERVICE_FRAME, VOICE_SERVICE_PATH } from "@sidecar/hosted";
import { isRecord, unparsedWire, type WireRecord } from "@sidecar/wire";
import { afterAll, test } from "vitest";
import { MESSAGE_ROLE } from "../server/core";
import { offerBriefing } from "../server/hosted/brain-host/announce";
import { BRAIN_HOST_TURN } from "../server/hosted/brain-host/bounds";
import {
  EVE_SEND_OUTCOME,
  type EveMessage,
  type EveSessions,
} from "../server/hosted/brain-host/eve-sessions";
import { memoryRelayState, StreamRelay } from "../server/hosted/brain-host/relay";
import { CATALOG_TOOL_SET } from "../server/hosted/brain-tool-set";
import { payloadKeyRing } from "../server/hosted/encryption";
import { type ConversationTarget, storeWriter } from "../server/hosted/store";
import { askRecord } from "../server/hosted/store/asks";
import {
  LIVE_CLIENT_EVENT,
  LIVE_SERVER_EVENT,
  LIVE_VOICE,
  type LiveClientEvent,
  SEED_CONTENT_TYPE,
  SEED_ITEM_TYPE,
  SEED_ROLE,
} from "../server/live";
import { exchangeAttachment } from "../server/voice/exchange-attachment";
import { LOG_EVENT, type LogEntry } from "../server/voice/log";
import { SOCKET_CLOSE_CODE } from "../server/voice/relay";
import { VoiceService, type VoiceServiceOptions } from "../server/voice/service";
import { voiceSessionRecord } from "../server/voice/session-record";
import { FIRST_EVE_TURN, spokenTurn } from "./support/eve-turns";
import { openHostedStoreTestDatabase, TEST_PAYLOAD_SECRET } from "./support/hosted-store-database";
import {
  appended,
  delegated,
  heard,
  sessionStarted,
  thinkingAppended,
} from "./support/live-events";
import { insertConversation, readMessagesByConversationTyped } from "./support/store-rows";
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
 * the ask door. What these tests hold to is the seam's whole contract: with
 * no exchange offered the service only pipes and nothing of Luke's reaches
 * the session or the record; with one offered it stands before the desktop is
 * answered, seeds nothing a second time, reads the developer's words off the
 * same sideband the relay pipes, answers through eve and appends the reply
 * upstream while the desktop still receives every server frame; one offered
 * that cannot stand refuses the session; and when the relay settles the
 * exchange's record writes are drained before the session is reported ended.
 * Every row is an account's this test created.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const NOW = 1_800_000_000_000;
const KEYS = payloadKeyRing(TEST_PAYLOAD_SECRET);
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
  offer: (target, turnId) =>
    offerBriefing({ run: database.run, writer, now: () => NOW }, target, turnId),
  now: () => NOW,
  report: () => undefined,
});
const sessionRecord = voiceSessionRecord(database.run, () => NOW);

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
  readonly reports: string[];
  readonly openAi: Awaited<ReturnType<typeof startFakeOpenAi>>;
  /** Lets a gated attachment proceed; a no-op for every other offer. */
  release(): void;
  url(path: string): string;
  stop(): Promise<void>;
}

/** How the exchange is offered: as the route would, not at all, one that cannot stand, or one held until the test releases it. */
const OFFER = {
  NONE: "none",
  EXCHANGE: "exchange",
  FAILING: "failing",
  GATED: "gated",
} as const;

type Offer = (typeof OFFER)[keyof typeof OFFER];

/** The service for one account, with the exchange offered as the route would offer it, or nothing, or one that cannot stand. */
async function stand(offer: Offer): Promise<Stand> {
  const target = await account();
  const openAi = await startFakeOpenAi();
  const eve = fakeEve();
  const log: LogEntry[] = [];
  const reports: string[] = [];
  const accounts = { ...fakeAccounts(), resolveUserId: async () => target.userId };
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const attachment: VoiceServiceOptions["exchange"] =
    offer === OFFER.NONE
      ? undefined
      : offer === OFFER.FAILING
        ? async () => {
            throw new Error("the store is not reachable");
          }
        : exchangeAttachment({
            context: { run: database.run, keys: KEYS },
            writer,
            eve: () => eve,
            emit: () => undefined,
            now: () => NOW,
            schedule: (callback, delayMs) => setTimeout(callback, delayMs),
            cancel: (timer) => {
              // SAFETY: a timer this composition cancels is one the scheduler above made, a Node timeout.
              clearTimeout(timer as NodeJS.Timeout);
            },
            createId: () => randomUUID(),
            report: (message) => reports.push(message),
          });
  const exchange: VoiceServiceOptions["exchange"] =
    offer === OFFER.GATED && attachment !== undefined
      ? async (session) => {
          await gate;
          return attachment(session);
        }
      : attachment;
  const service = new VoiceService({
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
  const port = await service.listen(0, "127.0.0.1");
  return {
    target,
    eve,
    log,
    reports,
    openAi,
    release: () => release(),
    url: (path) => `ws://127.0.0.1:${port}${path}`,
    stop: async () => {
      await service.close();
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

test("with no exchange offered the service only pipes: the session speaks, and nothing of Luke's reaches it, eve, or the record", async () => {
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
        entry.event === LOG_EVENT.EXCHANGE_ATTACHED || entry.event === LOG_EVENT.EXCHANGE_FAILED,
    ),
    false,
  );

  await hangUp(context, session);
  await context.stop();
});

test("with the exchange offered it stands before the desktop is answered, seeds nothing a second time, reads the developer's words off the piped sideband, answers through eve, and appends the reply upstream while the desktop still receives every server frame", async () => {
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

  const eveSession = await asks.latestSession(context.target.userId, context.target.conversationId);
  assert.ok(eveSession);
  const standing = {
    sessionId: eveSession,
    target: context.target,
    turn: BRAIN_HOST_TURN.SPOKEN,
    model: "scripted-model",
    state: memoryRelayState(),
  };
  for (const event of spokenTurn(FIRST_EVE_TURN, NOW)) await relay.handle(event, standing);
  // The reply reaches the session as the service's own appends, each acknowledged here as OpenAI
  // would: the thinking note the reply streams under, then the sentences, which alone are spoken.
  const spoken: string[] = [];
  const kinds: string[] = [];
  const diagnosis = async () => {
    const rows = await readMessagesByConversationTyped(database.run, context.target.conversationId);
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
  // The record was drained before the session was reported ended: the developer's line stands under the delegation's id.
  const rows = await readMessagesByConversationTyped(database.run, context.target.conversationId);
  assert.deepEqual(
    rows.filter((row) => row.role === MESSAGE_ROLE.USER).map((row) => row.clientId),
    ["dl_1"],
  );
  await context.stop();
});

test("an exchange offered that cannot stand refuses the session as unavailable, with the sideband released and the refusal logged, rather than running it with no one to answer", async () => {
  const context = await stand(OFFER.FAILING);
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
  const refusal = record(await desktop.next());
  assert.equal(refusal.error, "unavailable");
  const closed = await desktop.closed;
  assert.equal(closed.code, SOCKET_CLOSE_CODE.POLICY_VIOLATION);
  const upstreamClosed = await readSocket(attach.socket).closed;
  assert.equal(upstreamClosed.code, SOCKET_CLOSE_CODE.GOING_AWAY);
  assert.deepEqual(
    context.log.map((entry) => entry.event),
    [LOG_EVENT.EXCHANGE_FAILED, LOG_EVENT.SESSION_REFUSED],
  );
  await context.stop();
});

test("a desktop that hangs up while the exchange is standing is answered nothing: the exchange is stopped, the session closed gracefully, the sideband released, and no session is reported created or ended", async () => {
  const context = await stand(OFFER.GATED);
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
});

test("what the session speaks while the exchange is standing is read once both consumers listen: the desktop is handed the frames in order, and the exchange has heard the start and the words when the delegation arrives", async () => {
  const context = await stand(OFFER.GATED);
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
  // What the exchange sends after the ask is its own: appends under the delegation, nothing else.
  const afterAsk = await framesWithin(upstream, QUIET_MS);
  assert.ok(afterAsk.length > 0);
  assert.deepEqual(
    afterAsk.map((frame) => ("delegation_id" in frame ? frame.delegation_id : undefined)),
    afterAsk.map(() => "dl_1"),
  );
  await context.stop();
});
