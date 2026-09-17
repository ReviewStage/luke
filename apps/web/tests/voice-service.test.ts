import assert from "node:assert/strict";
import {
  DEVICE_PLATFORM,
  type DevicePlatform,
  HOSTED_API_ERROR,
  hostedErrorSchema,
  sessionAttachedFrameFromWire,
  sessionAudioCreatedFrameFromWire,
  sessionCreatedFrameFromWire,
  VOICE_SERVICE_FRAME,
  VOICE_SERVICE_HEADER,
  VOICE_SERVICE_PATH,
} from "@sidecar/hosted";
import { LIVE_AUDIO_FORMAT, LIVE_DEFAULT_AUDIO_FORMAT, PROACTIVE_SPEECH_KIND } from "@sidecar/live";
import { STOP_SPEAKING_INSTRUCTION } from "@sidecar/voice/live-session";
import {
  EXCESS_KEYS,
  HTTP_STATUS,
  isRecord,
  isWireString,
  unparsedWire,
  type WireRecord,
} from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Effect, Exit, Result, Scope } from "effect";
import { onTestFinished, test } from "vitest";
import { VOICE_FUNCTION_MAX_DURATION_SECONDS } from "../server/function-durations";
import { VOICE_SECONDS_OUTCOME } from "../server/hosted/quota";
import {
  greetingCue,
  greetingInstruction,
  INTRODUCTION_SEED_BOUNDS,
  introductionSeedItems,
  LIVE_CLIENT_EVENT,
  LIVE_CLOSE_REASON,
  LIVE_DELEGATION_TARGET,
  LIVE_INPUT_AUDIO_APPEND,
  LIVE_SCENE,
  LIVE_SERVER_EVENT,
  LIVE_SESSION_START,
  LIVE_TRANSPORT_TYPE,
  LIVE_VOICE,
  livePrimarySessionConfig,
  RENDERER_CLIENT_EVENTS,
  RENDERER_SERVER_EVENTS,
  SEED_CONTENT_TYPE,
  SEED_ITEM_TYPE,
  SEED_ROLE,
  sessionInstructions,
} from "../server/live";
import { VOICE_ROUTE } from "../server/voice/frames";
import { FINALIZATION, LOG_EVENT, type LogEntry } from "../server/voice/log";
import { INTRODUCTION_INPUT_BOUNDS, SESSIONS_INPUT_BOUNDS } from "../server/voice/opening";
import { UNPERMITTED_FRAME_REASON, UPSTREAM_CLOSED_REASON } from "../server/voice/relay";
import {
  listening,
  SOCKET_BYTE_BUDGET,
  UPGRADE_STATUS,
  VoiceService,
  type VoiceServiceOptions,
  voiceServer,
} from "../server/voice/service";
import { BUDGET_SPENT_REASON, SOCKET_CLOSE_CODE } from "../server/voice/socket";
import { runWithoutDatabase } from "./support/no-database";
import {
  connect,
  FAKE_BEARER,
  FAKE_QUOTA,
  FAKE_SDP_ANSWER,
  FAKE_USER_ID,
  type FakeAccounts,
  type FakeOpenAi,
  type FakeSessionRecord,
  fakeAccounts,
  fakeSessionRecord,
  readSocket,
  send,
  sendText,
  startFakeOpenAi,
} from "./support/voice-fakes";

const API_KEY = "sk-test-project-key";
const BEARER = FAKE_BEARER;
const SDP_OFFER =
  "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
const CLOSE_TIMEOUT_MS = 300;

const developerMessage = (text: string) => ({
  type: SEED_ITEM_TYPE,
  role: SEED_ROLE.DEVELOPER,
  content: [{ type: SEED_CONTENT_TYPE.INPUT_TEXT, text }],
});

const SEED = [
  developerMessage("Roster: one session working."),
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

function createFrame(input: WireRecord[] = SEED): WireRecord {
  return {
    type: VOICE_SERVICE_FRAME.SESSION_CREATE,
    sdp: SDP_OFFER,
    voice: LIVE_VOICE.MARIN,
    input,
  };
}

function record(text: string): WireRecord {
  const value = unparsedWire(JSON.parse(text));
  assert.ok(isRecord(value));
  return value;
}

function hostedError(text: WireRecord): string | undefined {
  // The hosted error record was declared tolerant, so the read drops a key a
  // newer service may have added.
  return Result.getOrUndefined(readEither(hostedErrorSchema, { excess: EXCESS_KEYS.DROP })(text));
}

interface Stand {
  openAi: FakeOpenAi;
  accounts: FakeAccounts;
  record: FakeSessionRecord;
  service: VoiceService;
  log: LogEntry[];
  url(path: string): string;
  /** How many sessions the service holds, read where the test is not inside a fiber. */
  sessions(): Promise<number>;
  /** Closes the scope the service stands in, which is its whole close. */
  close(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * One service in a scope of the test's own, standing on a server built as a
 * function module builds one. The listener is acquired ahead of the service,
 * so closing the scope drains the sessions before it stops listening.
 */
async function stand(overrides: Partial<VoiceServiceOptions> = {}): Promise<Stand> {
  const openAi = await startFakeOpenAi();
  const accounts = fakeAccounts();
  const record = fakeSessionRecord();
  const log: LogEntry[] = [];
  const voice = voiceServer();
  const scope = await runWithoutDatabase(Scope.make());
  const standing = await runWithoutDatabase(
    Scope.provide(
      Effect.gen(function* () {
        const port = yield* listening(voice, 0, "127.0.0.1");
        const service = yield* VoiceService.make({
          server: voice,
          apiKey: API_KEY,
          accounts,
          record,
          openAiBaseUrl: openAi.baseUrl,
          log: (entry) => {
            log.push(entry);
          },
          closeTimeoutMs: CLOSE_TIMEOUT_MS,
          firstFrameTimeoutMs: 1_000,
          attachTimeoutMs: 2_000,
          ...overrides,
        });
        return { port, service };
      }),
      scope,
    ),
  );
  const close = () => runWithoutDatabase(Scope.close(scope, Exit.void));
  return {
    openAi,
    accounts,
    record,
    service: standing.service,
    log,
    url: (path) => `ws://127.0.0.1:${standing.port}${path}`,
    sessions: () => runWithoutDatabase(standing.service.sessions),
    close,
    stop: async () => {
      await close();
      await openAi.close();
    },
  };
}

/** A fresh connection re-attached to a standing session: the attached frame read, and OpenAI's end of the new sideband. */
async function reattach(context: Stand, sessionId: string) {
  const opened = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), { authorization: BEARER });
  assert.ok("reader" in opened);
  const desktop = opened.reader;
  await send(desktop.socket, { type: VOICE_SERVICE_FRAME.SESSION_ATTACH, sessionId });
  const attach = await context.openAi.nextAttach();
  const attached = sessionAttachedFrameFromWire(record(await desktop.next()));
  assert.ok(attached);
  return { desktop, upstream: readSocket(attach.socket), attach, attached };
}

/** A signed-in desktop through to a standing session: the created frame read, and OpenAI's end of the sideband. */
async function openSession(context: Stand) {
  const opened = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), { authorization: BEARER });
  assert.ok("reader" in opened);
  const desktop = opened.reader;
  await send(desktop.socket, createFrame());
  const attach = await context.openAi.nextAttach();
  const created = sessionCreatedFrameFromWire(record(await desktop.next()));
  assert.ok(created);
  return { desktop, upstream: readSocket(attach.socket), attach, created };
}

test("a /sessions upgrade without a bearer is refused with 401 before any socket stands", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());

  const refused = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS));
  assert.deepEqual(refused, { status: UPGRADE_STATUS.UNAUTHORIZED });
  const blank = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), {
    authorization: "Bearer  ",
  });
  assert.deepEqual(blank, { status: UPGRADE_STATUS.UNAUTHORIZED });
  assert.equal(context.accounts.resolved.length, 0);
});

test("without a project key every upgrade is refused with 503 and nothing is resolved", async () => {
  const context = await stand({ apiKey: "  " });
  onTestFinished(() => context.stop());
  assert.deepEqual(
    await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), { authorization: BEARER }),
    {
      status: UPGRADE_STATUS.SERVICE_UNAVAILABLE,
    },
  );
  assert.deepEqual(await connect(context.url(VOICE_SERVICE_PATH.INTRODUCTION)), {
    status: UPGRADE_STATUS.SERVICE_UNAVAILABLE,
  });
  assert.equal(context.accounts.resolved.length, 0);
});

test("an unknown path is refused with 404", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  assert.deepEqual(await connect(context.url("/elsewhere")), { status: UPGRADE_STATUS.NOT_FOUND });
});

test("a spent allowance closes the socket behind one hosted error frame and spends no session", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  context.accounts.spendAnswer = { allowed: false, quota: FAKE_QUOTA };

  const opened = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), { authorization: BEARER });
  assert.ok("reader" in opened);
  await send(opened.reader.socket, createFrame());

  assert.equal(hostedError(record(await opened.reader.next())), HOSTED_API_ERROR.QUOTA_EXHAUSTED);
  const end = await opened.reader.closed;
  assert.equal(end.code, SOCKET_CLOSE_CODE.POLICY_VIOLATION);
  assert.equal(end.reason, HOSTED_API_ERROR.QUOTA_EXHAUSTED);
  assert.equal(context.openAi.creates.length, 0);
  assert.deepEqual(context.accounts.resolved, [BEARER]);
  assert.deepEqual(context.accounts.spent, [FAKE_USER_ID]);
});

test("a bearer no account stands behind is refused as an invalid token and spends nothing", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());

  const opened = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), {
    authorization: "Bearer stale",
  });
  assert.ok("reader" in opened);
  await send(opened.reader.socket, createFrame());
  assert.equal(hostedError(record(await opened.reader.next())), HOSTED_API_ERROR.INVALID_TOKEN);
  assert.equal(context.openAi.creates.length, 0);
  assert.equal(context.accounts.spent.length, 0);
});

test("a first frame that is not session.create is refused as an invalid request", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());

  const opened = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), { authorization: BEARER });
  assert.ok("reader" in opened);
  await send(opened.reader.socket, { type: LIVE_CLIENT_EVENT.INPUT_AUDIO_MUTE, event_id: "m1" });
  assert.equal(hostedError(record(await opened.reader.next())), HOSTED_API_ERROR.INVALID_REQUEST);
  assert.equal((await opened.reader.closed).code, SOCKET_CLOSE_CODE.POLICY_VIOLATION);
  assert.equal(context.accounts.resolved.length, 0);
});

test("a session is authorized, created, registered to its account, attached, and answered in that order", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());

  const { attach, created } = await openSession(context);

  assert.deepEqual(context.accounts.resolved, [BEARER]);
  assert.deepEqual(context.accounts.spent, [FAKE_USER_ID]);
  assert.deepEqual(context.record.registered, [
    { userId: FAKE_USER_ID, sessionId: created.sessionId, deviceId: undefined },
  ]);

  assert.equal(context.openAi.creates.length, 1);
  const create = context.openAi.creates[0];
  assert.ok(create);
  assert.equal(create.authorization, `Bearer ${API_KEY}`);
  const session = create.body.session;
  assert.ok(isRecord(session));
  assert.deepEqual(create.body.transport, { type: LIVE_TRANSPORT_TYPE, sdp: SDP_OFFER });
  assert.equal(session.instructions, sessionInstructions(LIVE_SCENE.DESKTOP));
  assert.deepEqual(session.delegation, { type: LIVE_DELEGATION_TARGET.CLIENT });
  assert.equal(session.store, false);
  assert.deepEqual(session.audio, { output: { voice: LIVE_VOICE.MARIN } });
  assert.deepEqual(session.input, SEED);
  assert.deepEqual(session.client, {
    data_channel: {
      allowed_client_events: RENDERER_CLIENT_EVENTS,
      allowed_server_events: RENDERER_SERVER_EVENTS,
    },
  });
  assert.deepEqual(Object.keys(session).sort(), [
    "audio",
    "client",
    "delegation",
    "input",
    "instructions",
    "model",
    "store",
  ]);

  assert.equal(attach.sessionId, created.sessionId);
  assert.equal(attach.authorization, `Bearer ${API_KEY}`);
  assert.equal(created.sdpAnswer, FAKE_SDP_ANSWER);
  // The answer names the store's own row for the session, as register answered it.
  assert.equal(created.voiceSessionId, context.record.voiceSessionIds.get(created.sessionId));
  assert.ok(created.voiceSessionId);
  assert.deepEqual(created.quota, FAKE_QUOTA);
  assert.equal(await context.sessions(), 1);
});

test("the desktop's hang-up passes through untouched and its stop is read rather than forwarded, every OpenAI frame reaches the desktop untouched, and reflected audio is dropped by type", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  const { desktop, upstream, created } = await openSession(context);

  // The stop is the service's to read; with no exchange standing it goes nowhere.
  await send(desktop.socket, { type: VOICE_SERVICE_FRAME.SESSION_STOP });
  assert.equal(await upstream.arrives(), false);
  const toUpstream = [JSON.stringify({ type: LIVE_CLIENT_EVENT.CLOSE, event_id: "x1" })];
  for (const frame of toUpstream) await sendText(desktop.socket, frame);
  const received: string[] = [];
  for (let index = 0; index < toUpstream.length; index += 1) received.push(await upstream.next());
  assert.deepEqual(received, toUpstream);

  const shown = [
    JSON.stringify({
      type: LIVE_SERVER_EVENT.SESSION_STARTED,
      event_id: "e1",
      session: { id: "live_test_1" },
    }),
    JSON.stringify({
      type: LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA,
      event_id: "e2",
      delta: " ",
      start_ms: 0,
      end_ms: 10,
    }),
    JSON.stringify({
      type: LIVE_SERVER_EVENT.DELEGATION_CREATED,
      event_id: "e3",
      offset_ms: 10,
      delegation: { id: "dlg_1", target: LIVE_DELEGATION_TARGET.CLIENT },
    }),
    JSON.stringify({
      type: LIVE_SERVER_EVENT.USAGE_UPDATED,
      event_id: "e4",
      usage: { seconds: 12 },
    }),
  ];
  const dropped = [
    JSON.stringify({ type: LIVE_SERVER_EVENT.INPUT_AUDIO_APPEND, audio: "AAAA" }),
    JSON.stringify({
      type: LIVE_SERVER_EVENT.OUTPUT_AUDIO_DELTA,
      delta: "AAAA",
      start_ms: 0,
      end_ms: 20,
    }),
  ];
  await sendText(upstream.socket, dropped[0] ?? "");
  for (const frame of shown) await sendText(upstream.socket, frame);
  await sendText(upstream.socket, dropped[1] ?? "");
  const seen: string[] = [];
  for (let index = 0; index < shown.length; index += 1) seen.push(await desktop.next());
  assert.deepEqual(seen, shown);
  assert.equal(await desktop.arrives(), false);
  assert.deepEqual(context.record.usage, [{ sessionId: created.sessionId, seconds: 12 }]);
  assert.deepEqual(context.record.closes, []);
});

test("session.closed is forwarded, its seconds reported exactly once, and both ends closed", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  const { desktop, upstream, created } = await openSession(context);

  const closedEvent = JSON.stringify({
    type: LIVE_SERVER_EVENT.SESSION_CLOSED,
    event_id: "e9",
    reason: LIVE_CLOSE_REASON.CLOSE_REQUESTED,
    usage: { seconds: 61.5 },
  });
  await sendText(upstream.socket, closedEvent);
  await sendText(upstream.socket, closedEvent);

  assert.equal(await desktop.next(), closedEvent);
  const desktopEnd = await desktop.closed;
  assert.equal(desktopEnd.code, SOCKET_CLOSE_CODE.NORMAL);
  await upstream.closed;

  assert.deepEqual(context.accounts.reports, [
    { userId: FAKE_USER_ID, sessionId: created.sessionId, seconds: 61.5 },
  ]);
  assert.deepEqual(context.record.closes, [
    { sessionId: created.sessionId, seconds: 61.5, reason: LIVE_CLOSE_REASON.CLOSE_REQUESTED },
  ]);
  const recorded = context.log.find((entry) => entry.event === LOG_EVENT.USAGE_RECORDED);
  assert.ok(recorded && recorded.event === LOG_EVENT.USAGE_RECORDED);
  assert.equal(recorded.outcome, VOICE_SECONDS_OUTCOME.RECORDED);
  assert.equal(await context.sessions(), 0);
});

test("a seconds report that throws still finalizes the session: both ends are closed and the session is reported ended", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  context.accounts.recordSeconds = () => Effect.die(new Error("the ledger is not reachable"));
  const { desktop, upstream, created } = await openSession(context);

  await sendText(
    upstream.socket,
    JSON.stringify({
      type: LIVE_SERVER_EVENT.SESSION_CLOSED,
      event_id: "e9",
      reason: LIVE_CLOSE_REASON.CLOSE_REQUESTED,
      usage: { seconds: 12 },
    }),
  );

  assert.equal((await desktop.closed).code, SOCKET_CLOSE_CODE.NORMAL);
  await upstream.closed;
  assert.deepEqual(context.record.closes, [
    { sessionId: created.sessionId, seconds: 12, reason: LIVE_CLOSE_REASON.CLOSE_REQUESTED },
  ]);
  const ended = context.log.find((entry) => entry.event === LOG_EVENT.SESSION_ENDED);
  assert.ok(ended && ended.event === LOG_EVENT.SESSION_ENDED);
  assert.equal(ended.finalization, FINALIZATION.CONFIRMED);
  assert.equal(ended.seconds, 12);
  assert.equal(await context.sessions(), 0);
});

test("a desktop that hangs up first has session.close sent for it and its seconds still recorded", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  const { desktop, upstream, created } = await openSession(context);

  desktop.socket.close(SOCKET_CLOSE_CODE.NORMAL);
  const close = record(await upstream.next());
  assert.equal(close.type, LIVE_CLIENT_EVENT.CLOSE);
  assert.equal(Object.keys(close).length, 2);

  await sendText(
    upstream.socket,
    JSON.stringify({
      type: LIVE_SERVER_EVENT.SESSION_CLOSED,
      event_id: "e9",
      reason: LIVE_CLOSE_REASON.REMOTE_HANGUP,
      usage: { seconds: 30 },
    }),
  );
  assert.equal((await upstream.closed).code, SOCKET_CLOSE_CODE.NORMAL);
  assert.deepEqual(context.accounts.reports, [
    { userId: FAKE_USER_ID, sessionId: created.sessionId, seconds: 30 },
  ]);
});

test("a sideband that never answers session.close is released at the timeout with usage unconfirmed", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  const { desktop, upstream } = await openSession(context);

  desktop.socket.close(SOCKET_CLOSE_CODE.NORMAL);
  await upstream.next();
  const end = await upstream.closed;
  assert.equal(end.code, SOCKET_CLOSE_CODE.NORMAL);
  assert.equal(context.accounts.reports.length, 0);
  const ended = context.log.find((entry) => entry.event === LOG_EVENT.SESSION_ENDED);
  assert.ok(ended && ended.event === LOG_EVENT.SESSION_ENDED);
  assert.equal(ended.finalization, "unconfirmed");
});

test("a sideband that closes first takes the desktop socket with it and reports nothing", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  const { desktop, upstream } = await openSession(context);

  upstream.socket.close(SOCKET_CLOSE_CODE.GOING_AWAY);
  const end = await desktop.closed;
  assert.equal(end.code, SOCKET_CLOSE_CODE.GOING_AWAY);
  assert.equal(end.reason, UPSTREAM_CLOSED_REASON);
  assert.equal(context.accounts.reports.length, 0);
  assert.deepEqual(context.record.closes, []);
});

test("an introduction past its byte budget is closed, counted over what the route drops as well as what it carries", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());

  const opened = await connect(context.url(VOICE_SERVICE_PATH.INTRODUCTION));
  assert.ok("reader" in opened);
  const desktop = opened.reader;
  await send(desktop.socket, createFrame([developerMessage("Running: api on main.")]));
  const attach = await context.openAi.nextAttach();
  const upstream = readSocket(attach.socket);
  assert.ok(sessionCreatedFrameFromWire(record(await desktop.next())));

  const spend = JSON.stringify({
    type: LIVE_CLIENT_EVENT.COMMENTARY_APPEND,
    event_id: "b1",
    content: "x".repeat(SOCKET_BYTE_BUDGET.INTRODUCTION),
  });
  await sendText(desktop.socket, spend);

  const end = await desktop.closed;
  assert.equal(end.code, SOCKET_CLOSE_CODE.POLICY_VIOLATION);
  assert.equal(end.reason, BUDGET_SPENT_REASON);
  assert.equal(record(await upstream.next()).type, LIVE_CLIENT_EVENT.CLOSE);
});

test("a socket past its byte budget before it ever opened a session is closed and creates nothing", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());

  const opened = await connect(context.url(VOICE_SERVICE_PATH.INTRODUCTION));
  assert.ok("reader" in opened);
  await sendText(opened.reader.socket, "x".repeat(SOCKET_BYTE_BUDGET.INTRODUCTION + 1));

  const end = await opened.reader.closed;
  assert.equal(end.code, SOCKET_CLOSE_CODE.POLICY_VIOLATION);
  assert.equal(end.reason, BUDGET_SPENT_REASON);
  assert.equal(context.openAi.creates.length, 0);
  assert.equal(context.accounts.introductions, 0);
});

test("a server with no service standing on it refuses every upgrade with 503", async () => {
  const voice = voiceServer();
  const scope = await runWithoutDatabase(Scope.make());
  const port = await runWithoutDatabase(Scope.provide(listening(voice, 0, "127.0.0.1"), scope));
  onTestFinished(() => runWithoutDatabase(Scope.close(scope, Exit.void)));

  assert.deepEqual(await connect(`ws://127.0.0.1:${port}${VOICE_SERVICE_PATH.INTRODUCTION}`), {
    status: UPGRADE_STATUS.SERVICE_UNAVAILABLE,
  });
});

test("a creation OpenAI refuses is answered as an upstream error and nothing is attached", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  context.openAi.createStatus = 500;

  const opened = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), { authorization: BEARER });
  assert.ok("reader" in opened);
  await send(opened.reader.socket, createFrame());
  assert.equal(hostedError(record(await opened.reader.next())), HOSTED_API_ERROR.UPSTREAM_ERROR);
  await opened.reader.closed;
  assert.equal(context.openAi.attaches.length, 0);
});

test("the introduction is created without an account, greeted exactly once after session.started, and shown captions only", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());

  const opened = await connect(context.url(VOICE_SERVICE_PATH.INTRODUCTION));
  assert.ok("reader" in opened);
  const desktop = opened.reader;
  await send(
    desktop.socket,
    createFrame([developerMessage("Running: api on main; web on feature/login.")]),
  );
  const attach = await context.openAi.nextAttach();
  const upstream = readSocket(attach.socket);
  const created = sessionCreatedFrameFromWire(record(await desktop.next()));
  assert.ok(created);
  assert.equal(created.quota, undefined);
  assert.equal(context.accounts.resolved.length, 0);
  assert.equal(context.accounts.introductions, 1);
  assert.equal(context.record.registered.length, 0);

  const create = context.openAi.creates[0];
  assert.ok(create && isRecord(create.body.session));
  assert.equal(create.body.session.instructions, sessionInstructions(LIVE_SCENE.INTRODUCTION));
  assert.deepEqual(create.body.session.client, {
    data_channel: {
      allowed_client_events: RENDERER_CLIENT_EVENTS,
      allowed_server_events: RENDERER_SERVER_EVENTS,
    },
  });

  const started = JSON.stringify({
    type: LIVE_SERVER_EVENT.SESSION_STARTED,
    event_id: "e1",
    session: { id: created.sessionId },
  });
  await sendText(upstream.socket, started);
  const greeting = record(await upstream.next());
  assert.equal(greeting.type, LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND);
  assert.equal(greeting.delegation_id, null);
  assert.equal(greeting.content, greetingInstruction());
  assert.equal(isWireString(greeting.event_id), true);
  assert.equal(await desktop.next(), started);

  await sendText(upstream.socket, started);
  assert.equal(await desktop.next(), started);
  assert.equal(await upstream.arrives(), false);

  const delegation = JSON.stringify({
    type: LIVE_SERVER_EVENT.DELEGATION_CREATED,
    event_id: "e3",
    offset_ms: 10,
    delegation: { id: "dlg_1", target: LIVE_DELEGATION_TARGET.CLIENT },
  });
  const caption = JSON.stringify({
    type: LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA,
    event_id: "e4",
    delta: "Hi",
    start_ms: 0,
    end_ms: 300,
  });
  await sendText(upstream.socket, delegation);
  await sendText(upstream.socket, caption);
  assert.equal(await desktop.next(), caption);
  assert.equal(await desktop.arrives(), false);

  await send(desktop.socket, {
    type: LIVE_CLIENT_EVENT.COMMENTARY_APPEND,
    event_id: "c1",
    delegation_id: null,
    content: "Say something else.",
  });
  const mute = JSON.stringify({ type: LIVE_CLIENT_EVENT.INPUT_AUDIO_MUTE, event_id: "m1" });
  await sendText(desktop.socket, mute);
  assert.equal(await upstream.next(), mute);
  assert.equal(await upstream.arrives(), false);

  await sendText(
    upstream.socket,
    JSON.stringify({
      type: LIVE_SERVER_EVENT.SESSION_CLOSED,
      event_id: "e9",
      reason: LIVE_CLOSE_REASON.CLOSE_REQUESTED,
      usage: { seconds: 20 },
    }),
  );
  await desktop.closed;
  assert.equal(context.accounts.reports.length, 0);
  assert.deepEqual(context.record.usage, []);
  assert.deepEqual(context.record.closes, []);
});

/** The greeting entries of a run's log, in the order they were written. */
const GREETING_EVENTS: readonly LogEntry["event"][] = [
  LOG_EVENT.GREETING_SENT,
  LOG_EVENT.GREETING_ACKNOWLEDGED,
  LOG_EVENT.GREETING_REFUSED,
  LOG_EVENT.GREETING_UNACKNOWLEDGED,
  LOG_EVENT.GREETING_CUED,
];

function greetingLog(context: Stand): LogEntry[] {
  return context.log.filter((entry) => GREETING_EVENTS.includes(entry.event));
}

/** One `session.instructions.appended` about the command the id names. */
function appended(clientEventId: string): string {
  return JSON.stringify({
    type: LIVE_SERVER_EVENT.INSTRUCTIONS_APPENDED,
    event_id: "appended-1",
    client_event_id: clientEventId,
    start_ms: 0,
    end_ms: 40,
  });
}

/** An introduction through to its greeting: the session started, and the append the service sent of its own. */
async function greetedIntroduction(context: Stand) {
  const opened = await connect(context.url(VOICE_SERVICE_PATH.INTRODUCTION));
  assert.ok("reader" in opened);
  const desktop = opened.reader;
  await send(desktop.socket, createFrame([developerMessage("Running: api on main.")]));
  const attach = await context.openAi.nextAttach();
  const upstream = readSocket(attach.socket);
  const created = sessionCreatedFrameFromWire(record(await desktop.next()));
  assert.ok(created);
  await sendText(
    upstream.socket,
    JSON.stringify({
      type: LIVE_SERVER_EVENT.SESSION_STARTED,
      event_id: "started-1",
      session: { id: created.sessionId },
    }),
  );
  const greeting = record(await upstream.next());
  assert.equal(greeting.type, LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND);
  assert.equal(greeting.content, greetingInstruction());
  const eventId = greeting.event_id;
  assert.ok(isWireString(eventId));
  return { desktop, upstream, eventId };
}

test("the greeting's acknowledgment is what the cue follows, and the cue goes up exactly once", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  const { upstream, eventId } = await greetedIntroduction(context);

  assert.equal(await upstream.arrives(), false);
  await sendText(upstream.socket, appended(eventId));
  const cue = record(await upstream.next());
  assert.equal(cue.type, LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
  assert.equal(cue.delegation_id, null);
  assert.equal(cue.content, greetingCue());
  assert.equal(isWireString(cue.event_id), true);
  assert.notEqual(cue.event_id, eventId);

  await sendText(upstream.socket, appended(eventId));
  assert.equal(await upstream.arrives(), false);
  assert.deepEqual(greetingLog(context), [
    { event: LOG_EVENT.GREETING_SENT, route: VOICE_ROUTE.INTRODUCTION },
    { event: LOG_EVENT.GREETING_ACKNOWLEDGED, route: VOICE_ROUTE.INTRODUCTION },
    { event: LOG_EVENT.GREETING_CUED, route: VOICE_ROUTE.INTRODUCTION },
  ]);
});

test("an acknowledgment of some other command leaves the greeting waiting", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  const { upstream, eventId } = await greetedIntroduction(context);

  await sendText(upstream.socket, appended("some-other-command"));
  assert.equal(await upstream.arrives(), false);
  assert.deepEqual(greetingLog(context), [
    { event: LOG_EVENT.GREETING_SENT, route: VOICE_ROUTE.INTRODUCTION },
  ]);

  await sendText(upstream.socket, appended(eventId));
  assert.equal(record(await upstream.next()).type, LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
});

test("an error naming the greeting is written down by its kind, and nothing is cued", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  const { upstream, eventId } = await greetedIntroduction(context);

  await sendText(
    upstream.socket,
    JSON.stringify({
      type: LIVE_SERVER_EVENT.ERROR,
      event_id: "error-1",
      error: {
        type: "invalid_request_error",
        code: "unsupported_content",
        message: "What the greeting said is the one thing the log never keeps.",
        client_event_id: eventId,
      },
    }),
  );

  assert.equal(await upstream.arrives(), false);
  assert.deepEqual(greetingLog(context), [
    { event: LOG_EVENT.GREETING_SENT, route: VOICE_ROUTE.INTRODUCTION },
    {
      event: LOG_EVENT.GREETING_REFUSED,
      route: VOICE_ROUTE.INTRODUCTION,
      errorType: "invalid_request_error",
      errorCode: "unsupported_content",
    },
  ]);
});

test("an error naming the greeting only as error.event_id is a refusal, not a wait run out", async () => {
  const context = await stand({ greetingTimeoutMs: 100 });
  onTestFinished(() => context.stop());
  const { upstream, eventId } = await greetedIntroduction(context);

  await sendText(
    upstream.socket,
    JSON.stringify({
      type: LIVE_SERVER_EVENT.ERROR,
      event_id: "error-1",
      error: {
        type: "invalid_request_error",
        code: "unsupported_content",
        message: "What the greeting said is the one thing the log never keeps.",
        event_id: eventId,
      },
    }),
  );

  // Past the wait, so a refusal the relay had missed would have settled as unacknowledged by now.
  assert.equal(await upstream.arrives(400), false);
  assert.deepEqual(greetingLog(context), [
    { event: LOG_EVENT.GREETING_SENT, route: VOICE_ROUTE.INTRODUCTION },
    {
      event: LOG_EVENT.GREETING_REFUSED,
      route: VOICE_ROUTE.INTRODUCTION,
      errorType: "invalid_request_error",
      errorCode: "unsupported_content",
    },
  ]);
});

test("a greeting neither acknowledged nor refused inside the wait cues nothing, then or later", async () => {
  const context = await stand({ greetingTimeoutMs: 100 });
  onTestFinished(() => context.stop());
  const { upstream, eventId } = await greetedIntroduction(context);

  assert.equal(await upstream.arrives(400), false);
  assert.deepEqual(greetingLog(context), [
    { event: LOG_EVENT.GREETING_SENT, route: VOICE_ROUTE.INTRODUCTION },
    { event: LOG_EVENT.GREETING_UNACKNOWLEDGED, route: VOICE_ROUTE.INTRODUCTION },
  ]);

  // The wait is over, so a late acknowledgment settles nothing a second time.
  await sendText(upstream.socket, appended(eventId));
  assert.equal(await upstream.arrives(), false);
});

test("a caller who hangs up before the acknowledgment is cued nothing when it lands", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  const { desktop, upstream, eventId } = await greetedIntroduction(context);

  desktop.socket.close();
  // The graceful close the docs describe: `session.close` goes up, and the
  // acknowledgment arriving inside that window cues a session on its way out.
  assert.equal(record(await upstream.next()).type, LIVE_CLIENT_EVENT.CLOSE);
  await sendText(upstream.socket, appended(eventId));

  assert.equal(await upstream.arrives(), false);
  assert.deepEqual(greetingLog(context), [
    { event: LOG_EVENT.GREETING_SENT, route: VOICE_ROUTE.INTRODUCTION },
    { event: LOG_EVENT.GREETING_UNACKNOWLEDGED, route: VOICE_ROUTE.INTRODUCTION },
  ]);
});

test("a caller gone before the session starts is not greeted at all", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  const opened = await connect(context.url(VOICE_SERVICE_PATH.INTRODUCTION));
  assert.ok("reader" in opened);
  const desktop = opened.reader;
  await send(desktop.socket, createFrame([developerMessage("Running: api on main.")]));
  const attach = await context.openAi.nextAttach();
  const upstream = readSocket(attach.socket);
  const created = sessionCreatedFrameFromWire(record(await desktop.next()));
  assert.ok(created);

  desktop.socket.close();
  assert.equal(record(await upstream.next()).type, LIVE_CLIENT_EVENT.CLOSE);
  await sendText(
    upstream.socket,
    JSON.stringify({
      type: LIVE_SERVER_EVENT.SESSION_STARTED,
      event_id: "started-1",
      session: { id: created.sessionId },
    }),
  );

  assert.equal(await upstream.arrives(), false);
  assert.deepEqual(greetingLog(context), []);
});

test("an introduction seed beyond one bounded developer message is refused before any session is spent", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());

  const tooMany = await connect(context.url(VOICE_SERVICE_PATH.INTRODUCTION));
  assert.ok("reader" in tooMany);
  await send(tooMany.reader.socket, createFrame([developerMessage("a"), developerMessage("b")]));
  assert.equal(hostedError(record(await tooMany.reader.next())), HOSTED_API_ERROR.INVALID_REQUEST);

  const tooLong = await connect(context.url(VOICE_SERVICE_PATH.INTRODUCTION));
  assert.ok("reader" in tooLong);
  await send(
    tooLong.reader.socket,
    createFrame([developerMessage("x".repeat(INTRODUCTION_INPUT_BOUNDS.CHARS + 1))]),
  );
  assert.equal(hostedError(record(await tooLong.reader.next())), HOSTED_API_ERROR.INVALID_REQUEST);

  const wrongRole = await connect(context.url(VOICE_SERVICE_PATH.INTRODUCTION));
  assert.ok("reader" in wrongRole);
  await send(wrongRole.reader.socket, createFrame([SEED[1] ?? {}]));
  assert.equal(
    hostedError(record(await wrongRole.reader.next())),
    HOSTED_API_ERROR.INVALID_REQUEST,
  );

  assert.equal(context.openAi.creates.length, 0);
});

test("a signed-in seed past the input bounds is refused by shape, before any session is created", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());

  const tooLong = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), {
    authorization: BEARER,
  });
  assert.ok("reader" in tooLong);
  await send(
    tooLong.reader.socket,
    createFrame([developerMessage("x".repeat(SESSIONS_INPUT_BOUNDS.CHARS + 1))]),
  );
  assert.equal(hostedError(record(await tooLong.reader.next())), HOSTED_API_ERROR.INVALID_REQUEST);

  const tooMany = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), {
    authorization: BEARER,
  });
  assert.ok("reader" in tooMany);
  await send(
    tooMany.reader.socket,
    createFrame(
      Array.from({ length: SESSIONS_INPUT_BOUNDS.MESSAGES + 1 }, () => developerMessage("a")),
    ),
  );
  assert.equal(hostedError(record(await tooMany.reader.next())), HOSTED_API_ERROR.INVALID_REQUEST);

  assert.equal(context.openAi.creates.length, 0);
});

test("an introduction spends the shared ceiling only for an admitted frame, and is refused past it before any session is spent", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());

  const empty = await connect(context.url(VOICE_SERVICE_PATH.INTRODUCTION));
  assert.ok("reader" in empty);
  empty.reader.socket.close();
  await empty.reader.closed;
  const malformed = await connect(context.url(VOICE_SERVICE_PATH.INTRODUCTION));
  assert.ok("reader" in malformed);
  await send(malformed.reader.socket, createFrame([developerMessage("a"), developerMessage("b")]));
  await malformed.reader.closed;
  assert.equal(context.accounts.introductions, 0);

  context.accounts.introductionAnswer = { allowed: false };
  const refused = await connect(context.url(VOICE_SERVICE_PATH.INTRODUCTION));
  assert.ok("reader" in refused);
  await send(refused.reader.socket, createFrame([developerMessage("Running: api on main.")]));
  assert.equal(hostedError(record(await refused.reader.next())), HOSTED_API_ERROR.QUOTA_EXHAUSTED);
  assert.equal((await refused.reader.closed).code, SOCKET_CLOSE_CODE.POLICY_VIOLATION);
  assert.equal(context.accounts.introductions, 1);
  assert.equal(context.openAi.creates.length, 0);
});

test("an upgrade carrying a browser Origin is refused with 403 on both routes", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());

  assert.deepEqual(
    await connect(context.url(VOICE_SERVICE_PATH.INTRODUCTION), { origin: "https://evil.test" }),
    { status: UPGRADE_STATUS.FORBIDDEN },
  );
  assert.deepEqual(
    await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), {
      authorization: BEARER,
      origin: "https://evil.test",
    }),
    { status: UPGRADE_STATUS.FORBIDDEN },
  );
  assert.equal(context.accounts.resolved.length, 0);
});

test("closing the service closes every desktop socket and refuses new upgrades with 503", async () => {
  const context = await stand();
  const { desktop, upstream } = await openSession(context);
  onTestFinished(() => context.openAi.close());

  const closing = context.close();
  assert.equal(await desktop.closed.then((end) => end.code), SOCKET_CLOSE_CODE.GOING_AWAY);
  assert.equal(record(await upstream.next()).type, LIVE_CLIENT_EVENT.CLOSE);
  await closing;
});

test("a fresh connection re-attaches its account's session, answers session.attached, and pipes again without spending", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  const first = await openSession(context);
  first.desktop.socket.terminate();
  assert.equal(record(await first.upstream.next()).type, LIVE_CLIENT_EVENT.CLOSE);

  const second = await reattach(context, first.created.sessionId);
  assert.equal(second.attached.sessionId, first.created.sessionId);
  assert.equal(second.attach.sessionId, first.created.sessionId);
  assert.equal(second.attach.authorization, `Bearer ${API_KEY}`);
  assert.equal(context.openAi.creates.length, 1);
  assert.deepEqual(context.accounts.spent, [FAKE_USER_ID]);
  assert.deepEqual(context.accounts.resolved, [BEARER, BEARER]);

  // The re-attached connection reads the desktop's reports as the first did, and forwards none.
  await send(second.desktop.socket, { type: VOICE_SERVICE_FRAME.SESSION_STOP });
  assert.equal(await second.upstream.arrives(), false);
  const caption = JSON.stringify({
    type: LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA,
    event_id: "e4",
    delta: "Hi",
    start_ms: 0,
    end_ms: 300,
  });
  await sendText(second.upstream.socket, caption);
  assert.equal(await second.desktop.next(), caption);
});

test("a desktop frame the sessions route does not admit closes the socket with a policy violation, and the session still ends gracefully with its seconds recorded", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  const { desktop, upstream, created } = await openSession(context);

  // An older build's own exchange: the reply it would have appended.
  await send(desktop.socket, {
    type: LIVE_CLIENT_EVENT.COMMENTARY_APPEND,
    event_id: "c1",
    delegation_id: "dlg_1",
    content: "One agent finished.",
  });
  const end = await desktop.closed;
  assert.equal(end.code, SOCKET_CLOSE_CODE.POLICY_VIOLATION);
  assert.equal(end.reason, UNPERMITTED_FRAME_REASON);
  // Nothing of the refused frame reached OpenAI; the relay's own close did.
  const close = record(await upstream.next());
  assert.equal(close.type, LIVE_CLIENT_EVENT.CLOSE);
  await sendText(
    upstream.socket,
    JSON.stringify({
      type: LIVE_SERVER_EVENT.SESSION_CLOSED,
      event_id: "e9",
      reason: LIVE_CLOSE_REASON.CLOSE_REQUESTED,
      usage: { seconds: 7 },
    }),
  );
  assert.equal((await upstream.closed).code, SOCKET_CLOSE_CODE.NORMAL);
  assert.deepEqual(context.accounts.reports, [
    { userId: FAKE_USER_ID, sessionId: created.sessionId, seconds: 7 },
  ]);
  const refused = context.log.find((entry) => entry.event === LOG_EVENT.FRAME_REFUSED);
  assert.ok(refused && refused.event === LOG_EVENT.FRAME_REFUSED);
  assert.equal(refused.type, LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
  const ended = context.log.find((entry) => entry.event === LOG_EVENT.SESSION_ENDED);
  assert.ok(ended && ended.event === LOG_EVENT.SESSION_ENDED);
  assert.equal(ended.refusedUnpermitted, 1);
  assert.equal(ended.framesToUpstream, 0);
});

test("a frame whose type cannot be read, or one of the service's own vocabulary that is not a report, closes the socket the same way, and the type logged is only a name this build knows", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  for (const frame of [
    "not json",
    JSON.stringify({ type: "session.anything.else", event_id: "z" }),
  ]) {
    const { desktop, upstream } = await openSession(context);
    await sendText(desktop.socket, frame);
    const end = await desktop.closed;
    assert.equal(end.code, SOCKET_CLOSE_CODE.POLICY_VIOLATION);
    assert.equal(end.reason, UNPERMITTED_FRAME_REASON);
    assert.equal(record(await upstream.next()).type, LIVE_CLIENT_EVENT.CLOSE);
  }
  assert.deepEqual(
    context.log
      .filter((entry) => entry.event === LOG_EVENT.FRAME_REFUSED)
      .map((entry) => (entry.event === LOG_EVENT.FRAME_REFUSED ? entry.type : "?")),
    [undefined, undefined],
  );
});

test("the desktop's own instruction append, the stop as an older build sent it, is refused with the close: no instruction text of the desktop's choosing reaches the session", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  const { desktop, upstream } = await openSession(context);

  await send(desktop.socket, {
    type: LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND,
    event_id: "s1",
    delegation_id: null,
    content: STOP_SPEAKING_INSTRUCTION,
  });
  const end = await desktop.closed;
  assert.equal(end.code, SOCKET_CLOSE_CODE.POLICY_VIOLATION);
  assert.equal(end.reason, UNPERMITTED_FRAME_REASON);
  // The next frame upstream is the relay's own close, never the instruction.
  assert.equal(record(await upstream.next()).type, LIVE_CLIENT_EVENT.CLOSE);
  const refused = context.log.find((entry) => entry.event === LOG_EVENT.FRAME_REFUSED);
  assert.ok(refused && refused.event === LOG_EVENT.FRAME_REFUSED);
  assert.equal(refused.type, LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND);
});

test("a beat naming the brain's own kind, or carrying a value its script does not mention, is refused with the close before it reaches anything", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  const { desktop, upstream } = await openSession(context);

  await send(desktop.socket, {
    type: VOICE_SERVICE_FRAME.SESSION_BEAT,
    kind: PROACTIVE_SPEECH_KIND.BRIEFING,
    briefing: "One agent finished.",
  });
  const end = await desktop.closed;
  assert.equal(end.code, SOCKET_CLOSE_CODE.POLICY_VIOLATION);
  assert.equal(end.reason, UNPERMITTED_FRAME_REASON);
  assert.equal(record(await upstream.next()).type, LIVE_CLIENT_EVENT.CLOSE);
  const refused = context.log.find((entry) => entry.event === LOG_EVENT.FRAME_REFUSED);
  assert.ok(refused && refused.event === LOG_EVENT.FRAME_REFUSED);
  assert.equal(refused.type, VOICE_SERVICE_FRAME.SESSION_BEAT);
});

test("the desktop's idle report, stop, and beat are read by the service and forwarded nowhere; one that is not a report is refused", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  const { desktop, upstream } = await openSession(context);

  await send(desktop.socket, { type: VOICE_SERVICE_FRAME.SESSION_ACTIVITY, idle: true });
  await send(desktop.socket, { type: VOICE_SERVICE_FRAME.SESSION_ACTIVITY, idle: false });
  await send(desktop.socket, { type: VOICE_SERVICE_FRAME.SESSION_STOP });
  // With no exchange standing, a beat is read and nobody speaks it.
  await send(desktop.socket, {
    type: VOICE_SERVICE_FRAME.SESSION_BEAT,
    kind: PROACTIVE_SPEECH_KIND.CALENDAR_ONBOARDING,
  });
  assert.equal(await upstream.arrives(), false);
  assert.equal(await desktop.arrives(), false);

  await send(desktop.socket, { type: VOICE_SERVICE_FRAME.SESSION_ACTIVITY, idle: "yes" });
  const end = await desktop.closed;
  assert.equal(end.code, SOCKET_CLOSE_CODE.POLICY_VIOLATION);
  assert.equal(end.reason, UNPERMITTED_FRAME_REASON);
  assert.equal(record(await upstream.next()).type, LIVE_CLIENT_EVENT.CLOSE);
  await sendText(
    upstream.socket,
    JSON.stringify({
      type: LIVE_SERVER_EVENT.SESSION_CLOSED,
      event_id: "e9",
      reason: LIVE_CLOSE_REASON.CLOSE_REQUESTED,
      usage: { seconds: 1 },
    }),
  );
  await upstream.closed;
  const ended = context.log.find((entry) => entry.event === LOG_EVENT.SESSION_ENDED);
  assert.ok(ended && ended.event === LOG_EVENT.SESSION_ENDED);
  assert.equal(ended.reportsRead, 4);
  assert.equal(ended.refusedUnpermitted, 1);
  assert.equal(ended.framesToUpstream, 0);
});

test("seconds are recorded once across a re-attach, whichever connection sees session.closed", async () => {
  const context = await stand({ closeTimeoutMs: 5_000 });
  onTestFinished(() => context.stop());
  const first = await openSession(context);
  first.desktop.socket.terminate();
  await first.upstream.next();
  const second = await reattach(context, first.created.sessionId);

  const closedEvent = JSON.stringify({
    type: LIVE_SERVER_EVENT.SESSION_CLOSED,
    event_id: "e9",
    reason: LIVE_CLOSE_REASON.CLOSE_REQUESTED,
    usage: { seconds: 40 },
  });
  await sendText(second.upstream.socket, closedEvent);
  assert.equal(await second.desktop.next(), closedEvent);
  await second.desktop.closed;
  await sendText(first.upstream.socket, closedEvent);
  await first.upstream.closed;

  assert.deepEqual(context.accounts.reports, [
    { userId: FAKE_USER_ID, sessionId: first.created.sessionId, seconds: 40 },
    { userId: FAKE_USER_ID, sessionId: first.created.sessionId, seconds: 40 },
  ]);
  const outcomes = context.log
    .filter((entry) => entry.event === LOG_EVENT.USAGE_RECORDED)
    .map((entry) => (entry.event === LOG_EVENT.USAGE_RECORDED ? entry.outcome : undefined));
  assert.deepEqual(outcomes, [VOICE_SECONDS_OUTCOME.RECORDED, VOICE_SECONDS_OUTCOME.REPEATED]);
});

test("an attach to a session another account created, or one never created, is refused as the bearer's own failure", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  const { created } = await openSession(context);
  await runWithoutDatabase(context.record.register({ userId: "user-2", sessionId: "live_theirs" }));

  for (const sessionId of ["live_theirs", "live_never"]) {
    const opened = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), {
      authorization: BEARER,
    });
    assert.ok("reader" in opened);
    await send(opened.reader.socket, { type: VOICE_SERVICE_FRAME.SESSION_ATTACH, sessionId });
    assert.equal(hostedError(record(await opened.reader.next())), HOSTED_API_ERROR.INVALID_TOKEN);
    assert.equal((await opened.reader.closed).code, SOCKET_CLOSE_CODE.POLICY_VIOLATION);
  }
  const stale = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), {
    authorization: "Bearer stale",
  });
  assert.ok("reader" in stale);
  await send(stale.reader.socket, {
    type: VOICE_SERVICE_FRAME.SESSION_ATTACH,
    sessionId: created.sessionId,
  });
  assert.equal(hostedError(record(await stale.reader.next())), HOSTED_API_ERROR.INVALID_TOKEN);
  assert.equal(context.openAi.attaches.length, 1);
  assert.deepEqual(context.accounts.spent, [FAKE_USER_ID]);
});

test("the introduction never re-attaches", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  const opened = await connect(context.url(VOICE_SERVICE_PATH.INTRODUCTION));
  assert.ok("reader" in opened);
  await send(opened.reader.socket, {
    type: VOICE_SERVICE_FRAME.SESSION_ATTACH,
    sessionId: "live_intro",
  });
  assert.equal(hostedError(record(await opened.reader.next())), HOSTED_API_ERROR.INVALID_REQUEST);
  assert.equal(context.openAi.attaches.length, 0);
});

const DEVICE_ID = "6f0b1d2e-3c4a-4b5c-8d6e-7f8091a2b3c4";
const PHONE_DEVICE_ID = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

/** The platform each refusal after a socket stood was counted by, in the order the refusals were written down. */
function refusedPlatforms(context: Stand): Array<DevicePlatform | undefined> {
  return context.log
    .filter((entry) => entry.event === LOG_EVENT.SESSION_REFUSED)
    .map((entry) => (entry.event === LOG_EVENT.SESSION_REFUSED ? entry.platform : undefined));
}

test("the device the handshake names is registered with the session once the account is seen to hold it", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  context.record.devices.push({
    userId: FAKE_USER_ID,
    deviceId: DEVICE_ID,
    platform: DEVICE_PLATFORM.MACOS,
  });

  const opened = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), {
    authorization: BEARER,
    [VOICE_SERVICE_HEADER.DEVICE_ID]: DEVICE_ID,
  });
  assert.ok("reader" in opened);
  await send(opened.reader.socket, createFrame());
  await context.openAi.nextAttach();
  const created = sessionCreatedFrameFromWire(record(await opened.reader.next()));
  assert.ok(created);

  assert.deepEqual(context.record.registered, [
    { userId: FAKE_USER_ID, sessionId: created.sessionId, deviceId: DEVICE_ID },
  ]);
});

test("a handshake naming a device the account does not hold is refused before a session is spent, and a device that does not exist is refused the same way", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  context.record.devices.push({
    userId: "user-2",
    deviceId: DEVICE_ID,
    platform: DEVICE_PLATFORM.MACOS,
  });
  const unknownDeviceId = "0a1b2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d";

  const refusals = [];
  for (const deviceId of [DEVICE_ID, unknownDeviceId]) {
    const opened = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), {
      authorization: BEARER,
      [VOICE_SERVICE_HEADER.DEVICE_ID]: deviceId,
    });
    assert.ok("reader" in opened);
    await send(opened.reader.socket, createFrame());
    refusals.push({
      error: hostedError(record(await opened.reader.next())),
      close: (await opened.reader.closed).code,
    });
  }

  // Another account's device and no device at all are one answer, so a
  // refusal tells the claimant nothing about which ids exist.
  assert.deepEqual(refusals, [
    { error: HOSTED_API_ERROR.INVALID_REQUEST, close: SOCKET_CLOSE_CODE.POLICY_VIOLATION },
    { error: HOSTED_API_ERROR.INVALID_REQUEST, close: SOCKET_CLOSE_CODE.POLICY_VIOLATION },
  ]);
  assert.deepEqual(context.accounts.spent, []);
  assert.equal(context.openAi.creates.length, 0);
  assert.deepEqual(context.record.registered, []);
  // No row of the account's was read, whoever claimed it, so the refusals
  // count no platform rather than the claimant's word for one.
  assert.deepEqual(refusedPlatforms(context), [undefined, undefined]);
});

test("a phone is admitted as the Mac is: its own device row is registered with the session, the account's allowance is spent once, and a frame it is refused on counts the phone", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  context.record.devices.push({
    userId: FAKE_USER_ID,
    deviceId: PHONE_DEVICE_ID,
    platform: DEVICE_PLATFORM.IOS,
  });

  const opened = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), {
    authorization: BEARER,
    [VOICE_SERVICE_HEADER.DEVICE_ID]: PHONE_DEVICE_ID,
  });
  assert.ok("reader" in opened);
  const phone = opened.reader;
  await send(phone.socket, createFrame());
  const attach = await context.openAi.nextAttach();
  // The reader stands the instant the attach lands, so the relay's own close
  // is read rather than emitted to nobody.
  const upstream = readSocket(attach.socket);
  const created = sessionCreatedFrameFromWire(record(await phone.next()));
  assert.ok(created);

  assert.deepEqual(context.record.registered, [
    { userId: FAKE_USER_ID, sessionId: created.sessionId, deviceId: PHONE_DEVICE_ID },
  ]);
  // The phone spends the account's own hosted meter, once, exactly as a Mac's
  // session does, and is answered the same quota.
  assert.deepEqual(context.accounts.spent, [FAKE_USER_ID]);
  assert.deepEqual(created.quota, FAKE_QUOTA);

  // The four frames are the same four, so what refuses a Mac refuses a phone,
  // and the line it is written down on names the platform the row gave.
  await send(phone.socket, {
    type: LIVE_CLIENT_EVENT.COMMENTARY_APPEND,
    event_id: "c1",
    delegation_id: null,
    content: "Say this for me.",
  });
  assert.equal((await phone.closed).code, SOCKET_CLOSE_CODE.POLICY_VIOLATION);
  assert.equal(record(await upstream.next()).type, LIVE_CLIENT_EVENT.CLOSE);
  const refused = context.log.find((entry) => entry.event === LOG_EVENT.FRAME_REFUSED);
  assert.ok(refused && refused.event === LOG_EVENT.FRAME_REFUSED);
  assert.deepEqual(
    { type: refused.type, platform: refused.platform },
    { type: LIVE_CLIENT_EVENT.COMMENTARY_APPEND, platform: DEVICE_PLATFORM.IOS },
  );
});

test("a phone refused for a spent allowance is counted as a phone, and one naming another account's device row is counted as nothing", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  context.record.devices.push(
    { userId: FAKE_USER_ID, deviceId: PHONE_DEVICE_ID, platform: DEVICE_PLATFORM.IOS },
    { userId: "user-2", deviceId: DEVICE_ID, platform: DEVICE_PLATFORM.MACOS },
  );
  context.accounts.spendAnswer = { allowed: false, quota: FAKE_QUOTA };

  for (const deviceId of [PHONE_DEVICE_ID, DEVICE_ID]) {
    const opened = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), {
      authorization: BEARER,
      [VOICE_SERVICE_HEADER.DEVICE_ID]: deviceId,
    });
    assert.ok("reader" in opened);
    await send(opened.reader.socket, createFrame());
    await opened.reader.closed;
  }

  // The phone's own row was read, so its refusal says which platform met the
  // ceiling; the Mac's row belongs to another account, so nothing of it was
  // read and its refusal names no platform at all.
  assert.deepEqual(refusedPlatforms(context), [DEVICE_PLATFORM.IOS, undefined]);
  assert.deepEqual(context.accounts.spent, [FAKE_USER_ID]);
  assert.equal(context.openAi.creates.length, 0);
});

test("a device header in no device id's shape is refused with 400 before any socket stands", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());

  const malformed = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), {
    authorization: BEARER,
    [VOICE_SERVICE_HEADER.DEVICE_ID]: "not-a-device",
  });
  assert.deepEqual(malformed, { status: UPGRADE_STATUS.BAD_REQUEST });
});

test("the largest seed the desktop can compose is admitted by the introduction's own bound", () => {
  const items = introductionSeedItems({
    titles: Array.from({ length: INTRODUCTION_SEED_BOUNDS.TITLES + 4 }, () =>
      "t".repeat(INTRODUCTION_SEED_BOUNDS.TITLE_CHARS * 2),
    ),
    name: "n".repeat(INTRODUCTION_SEED_BOUNDS.NAME_CHARS * 2),
  });
  assert.equal(items.length, INTRODUCTION_INPUT_BOUNDS.MESSAGES);
  assert.ok((items[0]?.content[0].text.length ?? Number.NaN) <= INTRODUCTION_INPUT_BOUNDS.CHARS);
});

const WATCH_DEVICE_ID = "7d8e9f0a-1b2c-4d3e-8f4a-5b6c7d8e9f0a";

/** The audio route's opening frame: a voice and a format, no offer and no seed. */
function audioCreateFrame(overrides: WireRecord = {}): WireRecord {
  return {
    type: VOICE_SERVICE_FRAME.SESSION_CREATE,
    voice: LIVE_VOICE.MARIN,
    format: LIVE_AUDIO_FORMAT.PCM16_16K,
    ...overrides,
  };
}

/** One append of the device's own audio, as a watch chunks its microphone: the type and the base64. */
function audioAppend(audio: string): string {
  return JSON.stringify({ type: LIVE_INPUT_AUDIO_APPEND, audio });
}

/** One delta of Luke's audio as the primary socket carries it: the type and the base64, no timing. */
function audioDelta(delta: string): string {
  return JSON.stringify({ type: LIVE_SERVER_EVENT.OUTPUT_AUDIO_DELTA, delta });
}

function caption(delta: string, eventId: string): string {
  return JSON.stringify({
    type: LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA,
    event_id: eventId,
    delta,
    start_ms: 0,
    end_ms: 300,
  });
}

function sessionClosed(seconds: number): string {
  return JSON.stringify({
    type: LIVE_SERVER_EVENT.SESSION_CLOSED,
    event_id: "closed-audio",
    reason: LIVE_CLOSE_REASON.CLOSE_REQUESTED,
    usage: { seconds },
  });
}

/** A watch through to a started session on the audio route: the created frame read, and OpenAI's end of the primary socket. */
async function openAudioSession(context: Stand) {
  context.record.devices.push({
    userId: FAKE_USER_ID,
    deviceId: WATCH_DEVICE_ID,
    platform: DEVICE_PLATFORM.WATCHOS,
  });
  const opened = await connect(context.url(VOICE_SERVICE_PATH.AUDIO), {
    authorization: BEARER,
    [VOICE_SERVICE_HEADER.DEVICE_ID]: WATCH_DEVICE_ID,
  });
  assert.ok("reader" in opened);
  const watch = opened.reader;
  await send(watch.socket, audioCreateFrame());
  const primary = await context.openAi.nextPrimary();
  const upstream = readSocket(primary.socket);
  const answer = record(await watch.next());
  const created = sessionAudioCreatedFrameFromWire(answer);
  assert.ok(created);
  return { watch, upstream, primary, created, answer };
}

test("a device on the audio route is admitted as on the sessions route, its session started over the service's own socket under the format it named, registered to its device row, and answered the id and the quota with no SDP answer", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());

  const { primary, created, answer } = await openAudioSession(context);

  assert.deepEqual(context.accounts.resolved, [BEARER]);
  assert.deepEqual(context.accounts.spent, [FAKE_USER_ID]);
  // No WebRTC session was created and no sideband attached: the one socket to OpenAI is the session.
  assert.equal(context.openAi.creates.length, 0);
  assert.equal(context.openAi.attaches.length, 0);
  assert.equal(context.openAi.primaries.length, 1);
  assert.equal(primary.authorization, `Bearer ${API_KEY}`);
  assert.deepEqual(primary.start, {
    type: LIVE_SESSION_START,
    session: livePrimarySessionConfig({
      scene: LIVE_SCENE.DESKTOP,
      voice: LIVE_VOICE.MARIN,
      format: LIVE_AUDIO_FORMAT.PCM16_16K,
    }),
  });
  const session = primary.start.session;
  assert.ok(isRecord(session));
  assert.deepEqual(session.audio, {
    format: LIVE_DEFAULT_AUDIO_FORMAT,
    output: { voice: LIVE_VOICE.MARIN },
  });
  assert.equal(Object.hasOwn(session, "client"), false);
  assert.equal(Object.hasOwn(session, "input"), false);

  assert.equal(created.sessionId, primary.sessionId);
  assert.deepEqual(created.quota, FAKE_QUOTA);
  assert.equal(Object.hasOwn(answer, "sdpAnswer"), false);
  assert.deepEqual(context.record.registered, [
    { userId: FAKE_USER_ID, sessionId: primary.sessionId, deviceId: WATCH_DEVICE_ID },
  ]);
  assert.deepEqual(
    context.log.map((entry) => entry.event),
    [LOG_EVENT.SESSION_CREATED],
  );
  assert.equal(context.log[0]?.route, VOICE_ROUTE.AUDIO);
  assert.equal(await context.sessions(), 1);
});

test("on the audio route the device's audio reaches OpenAI as the bytes it arrived as, Luke's audio and the captions reach the device, the echo of the device's audio and the exchange's events do not, the stop is read, and the hang-up ends the call with its seconds recorded", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  const { watch, upstream, primary } = await openAudioSession(context);

  const appends = [audioAppend("AAECAwQFBgc="), audioAppend("CAkKCwwNDg8=")];
  for (const frame of appends) await sendText(watch.socket, frame);
  const heard: string[] = [];
  for (let index = 0; index < appends.length; index += 1) heard.push(await upstream.next());
  assert.deepEqual(heard, appends);

  const shown = [
    audioDelta("EBESExQVFhc="),
    caption("Hi", "e2"),
    JSON.stringify({
      type: LIVE_SERVER_EVENT.USAGE_UPDATED,
      event_id: "e3",
      usage: { seconds: 5 },
    }),
  ];
  const unshown = [
    JSON.stringify({ type: LIVE_SERVER_EVENT.INPUT_AUDIO_APPEND, audio: "AAECAwQFBgc=" }),
    JSON.stringify({
      type: LIVE_SERVER_EVENT.DELEGATION_CREATED,
      event_id: "e4",
      offset_ms: 10,
      delegation: { id: "dlg_1", target: LIVE_DELEGATION_TARGET.CLIENT },
    }),
  ];
  await sendText(upstream.socket, unshown[0] ?? "");
  for (const frame of shown) await sendText(upstream.socket, frame);
  await sendText(upstream.socket, unshown[1] ?? "");
  const seen: string[] = [];
  for (let index = 0; index < shown.length; index += 1) seen.push(await watch.next());
  assert.deepEqual(seen, shown);
  assert.equal(await watch.arrives(), false);
  assert.deepEqual(context.record.usage, [{ sessionId: primary.sessionId, seconds: 5 }]);

  // The stop is the service's to read; with no exchange standing it goes nowhere.
  await send(watch.socket, { type: VOICE_SERVICE_FRAME.SESSION_STOP });
  assert.equal(await upstream.arrives(), false);

  const hangUp = JSON.stringify({ type: LIVE_CLIENT_EVENT.CLOSE, event_id: "x1" });
  await sendText(watch.socket, hangUp);
  assert.equal(await upstream.next(), hangUp);
  await sendText(upstream.socket, sessionClosed(31));
  assert.equal(record(await watch.next()).type, LIVE_SERVER_EVENT.SESSION_CLOSED);
  assert.equal((await watch.closed).code, SOCKET_CLOSE_CODE.NORMAL);
  await upstream.closed;

  assert.deepEqual(context.record.closes, [
    { sessionId: primary.sessionId, seconds: 31, reason: LIVE_CLOSE_REASON.CLOSE_REQUESTED },
  ]);
  assert.deepEqual(context.accounts.reports, [
    { userId: FAKE_USER_ID, sessionId: primary.sessionId, seconds: 31 },
  ]);
  const recorded = context.log.find((entry) => entry.event === LOG_EVENT.USAGE_RECORDED);
  assert.ok(recorded && recorded.event === LOG_EVENT.USAGE_RECORDED);
  assert.equal(recorded.route, VOICE_ROUTE.AUDIO);
  const ended = context.log.find((entry) => entry.event === LOG_EVENT.SESSION_ENDED);
  assert.ok(ended && ended.event === LOG_EVENT.SESSION_ENDED);
  assert.equal(ended.route, VOICE_ROUTE.AUDIO);
  assert.equal(ended.finalization, FINALIZATION.CONFIRMED);
  assert.equal(ended.seconds, 31);
  // Two appends and the hang-up went up; three frames and the close came down; one echo and one delegation were dropped; one report was read.
  assert.equal(ended.framesToUpstream, 3);
  assert.equal(
    ended.bytesToUpstream,
    [...appends, hangUp].reduce((total, frame) => total + Buffer.byteLength(frame), 0),
  );
  assert.equal(ended.framesToDevice, 4);
  assert.equal(ended.droppedAudio, 1);
  assert.equal(ended.droppedUnpermitted, 1);
  assert.equal(ended.reportsRead, 1);
  assert.equal(ended.refusedUnpermitted, 0);
  assert.equal(await context.sessions(), 0);
});

test("what the primary socket said beside session.started reaches the device first, once, and in order, ahead of what it said while the door still held the socket", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  const beside = [
    JSON.stringify({ type: LIVE_SERVER_EVENT.INFO, event_id: "i1", code: "noted" }),
    caption("Hello", "c1"),
  ];
  const then = [caption(" there", "c2"), caption(", Ada", "c3")];
  context.openAi.startedBeside = beside;
  context.openAi.startedThen = then;

  const { watch, upstream } = await openAudioSession(context);

  const later = caption(".", "c4");
  await sendText(upstream.socket, later);
  const seen: string[] = [];
  for (let index = 0; index < beside.length + then.length + 1; index += 1) {
    seen.push(await watch.next());
  }
  assert.deepEqual(seen, [...beside, ...then, later]);
  assert.equal(await watch.arrives(), false);
});

test("a session.attach is not a first frame the audio route admits, nor is the WebRTC create; and the audio create is not one the sessions route admits", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());

  for (const [path, frame] of [
    [VOICE_SERVICE_PATH.AUDIO, { type: VOICE_SERVICE_FRAME.SESSION_ATTACH, sessionId: "live_1" }],
    [VOICE_SERVICE_PATH.AUDIO, createFrame()],
    [
      VOICE_SERVICE_PATH.AUDIO,
      { type: VOICE_SERVICE_FRAME.SESSION_CREATE, voice: LIVE_VOICE.MARIN },
    ],
    [VOICE_SERVICE_PATH.SESSIONS, audioCreateFrame()],
  ] as const) {
    const opened = await connect(context.url(path), { authorization: BEARER });
    assert.ok("reader" in opened);
    await send(opened.reader.socket, frame);
    assert.equal(hostedError(record(await opened.reader.next())), HOSTED_API_ERROR.INVALID_REQUEST);
    const end = await opened.reader.closed;
    assert.equal(end.code, SOCKET_CLOSE_CODE.POLICY_VIOLATION);
    assert.equal(end.reason, HOSTED_API_ERROR.INVALID_REQUEST);
  }
  // Refused before the account was resolved, so nothing was spent and nothing opened at OpenAI.
  assert.equal(context.accounts.resolved.length, 0);
  assert.equal(context.openAi.primaries.length, 0);
  assert.equal(context.openAi.creates.length, 0);
  assert.equal(context.openAi.attaches.length, 0);
});

test("a beat on the audio route is refused with the close, counted as the watch, and the session still ends gracefully with its seconds recorded", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  const { watch, upstream, primary } = await openAudioSession(context);

  await send(watch.socket, {
    type: VOICE_SERVICE_FRAME.SESSION_BEAT,
    kind: PROACTIVE_SPEECH_KIND.ARRIVAL,
  });
  const end = await watch.closed;
  assert.equal(end.code, SOCKET_CLOSE_CODE.POLICY_VIOLATION);
  assert.equal(end.reason, UNPERMITTED_FRAME_REASON);
  assert.equal(record(await upstream.next()).type, LIVE_CLIENT_EVENT.CLOSE);
  await sendText(upstream.socket, sessionClosed(3));
  assert.equal((await upstream.closed).code, SOCKET_CLOSE_CODE.NORMAL);
  assert.deepEqual(context.accounts.reports, [
    { userId: FAKE_USER_ID, sessionId: primary.sessionId, seconds: 3 },
  ]);
  const refused = context.log.find((entry) => entry.event === LOG_EVENT.FRAME_REFUSED);
  assert.ok(refused && refused.event === LOG_EVENT.FRAME_REFUSED);
  assert.deepEqual(
    { route: refused.route, type: refused.type, platform: refused.platform },
    {
      route: VOICE_ROUTE.AUDIO,
      type: VOICE_SERVICE_FRAME.SESSION_BEAT,
      platform: DEVICE_PLATFORM.WATCHOS,
    },
  );
});

test("a primary socket OpenAI refuses is answered as an upstream error, one it throttles as throttled, and neither registers a session", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  const refusals: Array<string | undefined> = [];
  for (const status of [500, HTTP_STATUS.TOO_MANY_REQUESTS]) {
    context.openAi.primaryStatus = status;
    const opened = await connect(context.url(VOICE_SERVICE_PATH.AUDIO), { authorization: BEARER });
    assert.ok("reader" in opened);
    await send(opened.reader.socket, audioCreateFrame());
    refusals.push(hostedError(record(await opened.reader.next())));
    await opened.reader.closed;
  }
  assert.deepEqual(refusals, [
    HOSTED_API_ERROR.UPSTREAM_ERROR,
    HOSTED_API_ERROR.UPSTREAM_THROTTLED,
  ]);
  assert.deepEqual(context.record.registered, []);
  assert.equal(context.openAi.primaries.length, 0);
});

test("the audio route's byte budget holds PCM16 at 16 kHz as base64 in JSON for the function's whole duration, is wider than the sessions route's, and is not 24 kHz's", () => {
  const BYTES_PER_SAMPLE = 2;
  const BASE64_EXPANSION = 4 / 3;
  /** The frames a second a device chunks its microphone into at the finest grain, and the envelope each carries around its base64. */
  const FRAMES_PER_SECOND = 50;
  const ENVELOPE_BYTES = 64;
  const seconds = VOICE_FUNCTION_MAX_DURATION_SECONDS;
  const audio = LIVE_DEFAULT_AUDIO_FORMAT.rate * BYTES_PER_SAMPLE * seconds * BASE64_EXPANSION;
  const envelope = FRAMES_PER_SECOND * ENVELOPE_BYTES * seconds;
  assert.ok(SOCKET_BYTE_BUDGET.AUDIO >= Math.ceil(audio + envelope));
  assert.ok(SOCKET_BYTE_BUDGET.AUDIO > SOCKET_BYTE_BUDGET.SESSIONS);
  const wider = LIVE_AUDIO_FORMAT.PCM16_24K.rate * BYTES_PER_SAMPLE * seconds * BASE64_EXPANSION;
  assert.ok(SOCKET_BYTE_BUDGET.AUDIO < wider);
});
