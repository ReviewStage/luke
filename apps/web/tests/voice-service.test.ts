import assert from "node:assert/strict";
import {
  HOSTED_API_ERROR,
  hostedErrorSchema,
  sessionAttachedFrameFromWire,
  sessionCreatedFrameFromWire,
  VOICE_SERVICE_FRAME,
  VOICE_SERVICE_PATH,
} from "@sidecar/hosted";
import type { Plan } from "@sidecar/hosted/plan-wire";
import { STOP_SPEAKING_INSTRUCTION } from "@sidecar/voice/live-session";
import { EXCESS_KEYS, isRecord, isWireString, unparsedWire, type WireRecord } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Deferred, Effect, Exit, Result, Scope } from "effect";
import { onTestFinished, test } from "vitest";
import { VOICE_SECONDS_OUTCOME } from "../server/hosted/quota";
import {
  greetingCue,
  LIVE_CLIENT_EVENT,
  LIVE_CLOSE_REASON,
  LIVE_DELEGATION_TARGET,
  LIVE_SERVER_EVENT,
  LIVE_TRANSPORT_TYPE,
  LIVE_VOICE,
  planningOpeningInstruction,
  RENDERER_CLIENT_EVENTS,
  RENDERER_SERVER_EVENTS,
  SEED_CONTENT_TYPE,
  SEED_ITEM_TYPE,
  SEED_ROLE,
  sessionInstructions,
} from "../server/live";
import { FINALIZATION, LOG_EVENT, type LogEntry } from "../server/voice/log";
import { SESSIONS_INPUT_BOUNDS } from "../server/voice/opening";
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
import { settled } from "./support/settle";
import {
  connect,
  FAKE_BEARER,
  FAKE_SDP_ANSWER,
  FAKE_USER_ID,
  type FakeAccounts,
  type FakeOpenAi,
  type FakeSessionRecord,
  fakeAccounts,
  fakeSessionRecord,
  hangUpDevice,
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

/** A plan the account holds, untouched since it was started. */
const PLAN: Plan = {
  id: "7d4f3c2a-1b0e-4f6a-9c8d-2e1f0a9b8c7d",
  name: "Teammate invitations",
  createdAt: 1_000,
  updatedAt: 1_000,
  document: { body: "# Teammate invitations", assumptions: [] },
};

/** The desktop's opening frame for a call about the plan the account holds. */
function createFrame(input: WireRecord[] = SEED): WireRecord {
  return {
    type: VOICE_SERVICE_FRAME.SESSION_CREATE,
    sdp: SDP_OFFER,
    voice: LIVE_VOICE.MARIN,
    input,
    planId: PLAN.id,
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
  record.plans.push({ userId: FAKE_USER_ID, plan: PLAN });
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
  assert.equal(context.accounts.resolved.length, 0);
});

test("an unknown path is refused with 404", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  assert.deepEqual(await connect(context.url("/elsewhere")), { status: UPGRADE_STATUS.NOT_FOUND });
});

test("a bearer no account stands behind is refused as an invalid token and counts nothing", async () => {
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

test("a session is authorized, counted, created, registered to its account, attached, and answered in that order", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());

  const { attach, created } = await openSession(context);

  assert.deepEqual(context.accounts.resolved, [BEARER]);
  assert.deepEqual(context.accounts.spent, [FAKE_USER_ID]);
  assert.deepEqual(context.record.registered, [
    { userId: FAKE_USER_ID, sessionId: created.sessionId, planId: PLAN.id },
  ]);

  assert.equal(context.openAi.creates.length, 1);
  const create = context.openAi.creates[0];
  assert.ok(create);
  assert.equal(create.authorization, `Bearer ${API_KEY}`);
  const session = create.body.session;
  assert.ok(isRecord(session));
  assert.deepEqual(create.body.transport, { type: LIVE_TRANSPORT_TYPE, sdp: SDP_OFFER });
  assert.equal(session.instructions, sessionInstructions());
  assert.deepEqual(session.delegation, { type: LIVE_DELEGATION_TARGET.CLIENT });
  assert.equal(session.store, false);
  assert.deepEqual(session.audio, { output: { voice: LIVE_VOICE.MARIN } });
  // The plan's own seed goes ahead of the desktop's input, which follows it untouched.
  assert.ok(Array.isArray(session.input));
  assert.deepEqual(session.input.slice(1), SEED);
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
  assert.equal("quota" in created, false);
  assert.equal(await context.sessions(), 1);
});

test("the desktop's hang-up and its stop are read rather than forwarded, every OpenAI frame reaches the desktop untouched, and reflected audio is dropped by type", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  const { desktop, upstream, created } = await openSession(context);

  // The stop is the service's to read; with no exchange standing it goes nowhere.
  await send(desktop.socket, { type: VOICE_SERVICE_FRAME.SESSION_STOP });
  assert.equal(await upstream.arrives(), false);
  // The hang-up is an ask for the close: with no exchange standing the relay
  // sends its own, once, and the device's frame never goes up as it was sent.
  await sendText(desktop.socket, JSON.stringify({ type: LIVE_CLIENT_EVENT.CLOSE, event_id: "x1" }));
  const closing = JSON.parse(await upstream.next());
  assert.equal(closing.type, LIVE_CLIENT_EVENT.CLOSE);
  assert.notEqual(closing.event_id, "x1");
  await send(desktop.socket, { type: VOICE_SERVICE_FRAME.SESSION_HANG_UP });
  assert.equal(await upstream.arrives(), false);

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

test("a desktop that hangs up first has its session.close carried up and its seconds still recorded", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  const { desktop, upstream, created } = await openSession(context);

  await hangUpDevice(desktop.socket, SOCKET_CLOSE_CODE.NORMAL);
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

  await hangUpDevice(desktop.socket, SOCKET_CLOSE_CODE.NORMAL);
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

test("a socket past its byte budget while its session is still being stood up is closed and creates nothing", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  // The bearer's resolution is held open, so every frame past the opening one
  // arrives while the session is being stood up, before any pipe reads it.
  const resolution = await runWithoutDatabase(Deferred.make<void>());
  const resolveUserId = context.accounts.resolveUserId;
  context.accounts.resolveUserId = (authorization) =>
    Effect.andThen(Deferred.await(resolution), resolveUserId(authorization));

  const opened = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), { authorization: BEARER });
  assert.ok("reader" in opened);
  await send(opened.reader.socket, createFrame());
  const chunk = "x".repeat(1_500_000);
  for (let spent = 0; spent <= SOCKET_BYTE_BUDGET; spent += chunk.length) {
    await sendText(opened.reader.socket, chunk);
  }

  const end = await opened.reader.closed;
  assert.equal(end.code, SOCKET_CLOSE_CODE.POLICY_VIOLATION);
  assert.equal(end.reason, BUDGET_SPENT_REASON);
  await runWithoutDatabase(Deferred.succeed(resolution, undefined));
  assert.equal(context.openAi.creates.length, 0);
});

test("a server with no service standing on it refuses every upgrade with 503", async () => {
  const voice = voiceServer();
  const scope = await runWithoutDatabase(Scope.make());
  const port = await runWithoutDatabase(Scope.provide(listening(voice, 0, "127.0.0.1"), scope));
  onTestFinished(() => runWithoutDatabase(Scope.close(scope, Exit.void)));

  assert.deepEqual(
    await connect(`ws://127.0.0.1:${port}${VOICE_SERVICE_PATH.SESSIONS}`, {
      authorization: BEARER,
    }),
    { status: UPGRADE_STATUS.SERVICE_UNAVAILABLE },
  );
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

/** A started session, as OpenAI tells the sideband. */
function sessionStarted(sessionId: string): string {
  return JSON.stringify({
    type: LIVE_SERVER_EVENT.SESSION_STARTED,
    event_id: "started-1",
    session: { id: sessionId },
  });
}

/** A call through to its opening: the session started, and the append the service sent of its own. */
async function greetedCall(context: Stand) {
  const { desktop, upstream, created } = await openSession(context);
  await sendText(upstream.socket, sessionStarted(created.sessionId));
  const greeting = record(await upstream.next());
  assert.equal(greeting.type, LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND);
  assert.equal(greeting.content, planningOpeningInstruction());
  const eventId = greeting.event_id;
  assert.ok(isWireString(eventId));
  return { desktop, upstream, eventId, created };
}

test("the greeting's acknowledgment is what the cue follows, and the greeting and the cue go up exactly once", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  const { upstream, eventId, created } = await greetedCall(context);

  assert.equal(await upstream.arrives(), false);
  await sendText(upstream.socket, appended(eventId));
  const cue = record(await upstream.next());
  assert.equal(cue.type, LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
  assert.equal(cue.delegation_id, null);
  assert.equal(cue.content, greetingCue());
  assert.equal(isWireString(cue.event_id), true);
  assert.notEqual(cue.event_id, eventId);

  await sendText(upstream.socket, appended(eventId));
  // A second start, as a session never says, opens nothing again.
  await sendText(upstream.socket, sessionStarted(created.sessionId));
  assert.equal(await upstream.arrives(), false);
  assert.deepEqual(greetingLog(context), [
    { event: LOG_EVENT.GREETING_SENT },
    { event: LOG_EVENT.GREETING_ACKNOWLEDGED },
    { event: LOG_EVENT.GREETING_CUED },
  ]);
});

test("an acknowledgment of some other command leaves the greeting waiting", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  const { upstream, eventId } = await greetedCall(context);

  await sendText(upstream.socket, appended("some-other-command"));
  assert.equal(await upstream.arrives(), false);
  assert.deepEqual(greetingLog(context), [{ event: LOG_EVENT.GREETING_SENT }]);

  await sendText(upstream.socket, appended(eventId));
  assert.equal(record(await upstream.next()).type, LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
});

test("an error naming the greeting is written down by its kind, and nothing is cued", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  const { upstream, eventId } = await greetedCall(context);

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
    { event: LOG_EVENT.GREETING_SENT },
    {
      event: LOG_EVENT.GREETING_REFUSED,
      errorType: "invalid_request_error",
      errorCode: "unsupported_content",
    },
  ]);
});

test("an error naming the greeting only as error.event_id is a refusal, not a wait run out", async () => {
  const context = await stand({ greetingTimeoutMs: 100 });
  onTestFinished(() => context.stop());
  const { upstream, eventId } = await greetedCall(context);

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
    { event: LOG_EVENT.GREETING_SENT },
    {
      event: LOG_EVENT.GREETING_REFUSED,
      errorType: "invalid_request_error",
      errorCode: "unsupported_content",
    },
  ]);
});

test("a greeting neither acknowledged nor refused inside the wait cues nothing, then or later", async () => {
  const context = await stand({ greetingTimeoutMs: 100 });
  onTestFinished(() => context.stop());
  const { upstream, eventId } = await greetedCall(context);

  assert.equal(await upstream.arrives(400), false);
  assert.deepEqual(greetingLog(context), [
    { event: LOG_EVENT.GREETING_SENT },
    { event: LOG_EVENT.GREETING_UNACKNOWLEDGED },
  ]);

  // The wait is over, so a late acknowledgment settles nothing a second time.
  await sendText(upstream.socket, appended(eventId));
  assert.equal(await upstream.arrives(), false);
});

test("a caller who hangs up before the acknowledgment is cued nothing when it lands", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  const { desktop, upstream, eventId } = await greetedCall(context);

  await hangUpDevice(desktop.socket, SOCKET_CLOSE_CODE.NORMAL);
  // The graceful close the docs describe: the desktop's close is an ask, so
  // one `session.close` goes up for it and the socket's going asks nothing
  // more, and an acknowledgment arriving inside that window would cue a
  // session on its way out.
  assert.equal(record(await upstream.next()).type, LIVE_CLIENT_EVENT.CLOSE);
  await sendText(upstream.socket, appended(eventId));

  assert.equal(await upstream.arrives(), false);
  assert.deepEqual(greetingLog(context), [
    { event: LOG_EVENT.GREETING_SENT },
    { event: LOG_EVENT.GREETING_UNACKNOWLEDGED },
  ]);
});

test("a call just created speaks first, cued once its opening is acknowledged, and a re-attach to it opens nothing", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  const { upstream, created } = await openSession(context);

  await sendText(upstream.socket, sessionStarted(created.sessionId));
  const opening = record(await upstream.next());
  assert.equal(opening.type, LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND);
  assert.equal(opening.delegation_id, null);
  assert.equal(opening.content, planningOpeningInstruction());
  assert.ok(isWireString(opening.event_id));
  await sendText(upstream.socket, appended(opening.event_id));
  const cue = record(await upstream.next());
  assert.equal(cue.type, LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
  assert.equal(cue.delegation_id, null);
  assert.equal(cue.content, greetingCue());
  assert.deepEqual(greetingLog(context), [
    { event: LOG_EVENT.GREETING_SENT },
    { event: LOG_EVENT.GREETING_ACKNOWLEDGED },
    { event: LOG_EVENT.GREETING_CUED },
  ]);

  // The call already opened on its first connection, so a fresh one says nothing of its own.
  const again = await reattach(context, created.sessionId);
  await sendText(again.upstream.socket, sessionStarted(created.sessionId));
  assert.equal(await again.desktop.next(), sessionStarted(created.sessionId));
  assert.equal(await again.upstream.arrives(), false);
});

test("a caller gone before the session starts is not greeted at all", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  const { desktop, upstream, created } = await openSession(context);

  await hangUpDevice(desktop.socket, SOCKET_CLOSE_CODE.NORMAL);
  // The desktop's close is an ask: one `session.close` goes up for it and the socket's going.
  assert.equal(record(await upstream.next()).type, LIVE_CLIENT_EVENT.CLOSE);
  await sendText(upstream.socket, sessionStarted(created.sessionId));

  assert.equal(await upstream.arrives(), false);
  assert.deepEqual(greetingLog(context), []);
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

test("a signed-in seed past the startup token bound loses its oldest lines and keeps its developer notes", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());

  const roster = developerMessage("Roster: one session working.");
  // Each line is a thousand tokens at three ASCII characters to one, so ten
  // with the roster are past the 8,192 the API takes and eight are not.
  const lines = Array.from({ length: 10 }, (_, index) => ({
    type: SEED_ITEM_TYPE,
    role: SEED_ROLE.USER,
    content: [{ type: SEED_CONTENT_TYPE.INPUT_TEXT, text: `${index}`.padEnd(3_000, "x") }],
  }));
  const opened = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), { authorization: BEARER });
  assert.ok("reader" in opened);
  await send(opened.reader.socket, createFrame([roster, ...lines]));
  await context.openAi.nextAttach();
  const session = context.openAi.creates[0]?.body.session;
  assert.ok(isRecord(session));
  // The plan's seed leads, cut to the room the device's own items leave.
  assert.ok(Array.isArray(session.input));
  assert.deepEqual(session.input.slice(1), [roster, ...lines.slice(2)]);
});

test("a signed-in seed whose developer notes alone are past the startup token bound is refused", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());

  // A CJK character is a token of its own, so three full notes are past the bound.
  const note = developerMessage("計".repeat(SESSIONS_INPUT_BOUNDS.CHARS));
  const opened = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), { authorization: BEARER });
  assert.ok("reader" in opened);
  await send(opened.reader.socket, createFrame([note, note, note]));
  assert.equal(hostedError(record(await opened.reader.next())), HOSTED_API_ERROR.INVALID_REQUEST);
  assert.equal(context.openAi.creates.length, 0);
});

test("an upgrade carrying a browser Origin is refused with 403", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());

  assert.deepEqual(
    await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), {
      authorization: BEARER,
      origin: "https://evil.test",
    }),
    { status: UPGRADE_STATUS.FORBIDDEN },
  );
  assert.equal(context.accounts.resolved.length, 0);
});

test("closing the service closes every desktop socket and detaches each call, leaving its session to the re-attach", async () => {
  const context = await stand();
  const { desktop, upstream } = await openSession(context);
  onTestFinished(() => context.openAi.close());

  const closing = context.close();
  assert.equal(await desktop.closed.then((end) => end.code), SOCKET_CLOSE_CODE.GOING_AWAY);
  assert.equal((await upstream.closed).code, SOCKET_CLOSE_CODE.NORMAL);
  assert.equal(await upstream.arrives(), false);
  await closing;
  const ended = context.log.find((entry) => entry.event === LOG_EVENT.SESSION_ENDED);
  assert.ok(ended && ended.event === LOG_EVENT.SESSION_ENDED);
  assert.equal(ended.finalization, FINALIZATION.DETACHED);
  assert.deepEqual(context.record.closes, []);
});

test("a fresh connection re-attaches its account's session, answers session.attached, and pipes again without spending", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  const first = await openSession(context);
  first.desktop.socket.terminate();
  await first.upstream.closed;

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

test("a desktop socket that drops without a hang-up detaches: nothing goes up, nothing is recorded, a fresh connection resumes the session, and its later hang-up records the seconds once", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  const first = await openSession(context);

  first.desktop.socket.terminate();
  assert.equal((await first.upstream.closed).code, SOCKET_CLOSE_CODE.NORMAL);
  assert.equal(await first.upstream.arrives(), false);
  const detached = context.log.find((entry) => entry.event === LOG_EVENT.SESSION_ENDED);
  assert.ok(detached && detached.event === LOG_EVENT.SESSION_ENDED);
  assert.equal(detached.finalization, FINALIZATION.DETACHED);
  assert.equal(detached.seconds, undefined);
  assert.equal(context.record.closes.length, 0);
  assert.equal(context.accounts.reports.length, 0);

  const second = await reattach(context, first.created.sessionId);
  assert.equal(second.attach.sessionId, first.created.sessionId);
  // Stamped detached as the connection ended, and cleared as the next one attached.
  assert.deepEqual(context.record.detachments, [
    { sessionId: first.created.sessionId, detached: true },
    { sessionId: first.created.sessionId, detached: false },
  ]);
  const caption = JSON.stringify({
    type: LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA,
    event_id: "e4",
    delta: "Still here",
    start_ms: 0,
    end_ms: 300,
  });
  await sendText(second.upstream.socket, caption);
  assert.equal(await second.desktop.next(), caption);

  await hangUpDevice(second.desktop.socket, SOCKET_CLOSE_CODE.NORMAL);
  assert.equal(record(await second.upstream.next()).type, LIVE_CLIENT_EVENT.CLOSE);
  await sendText(
    second.upstream.socket,
    JSON.stringify({
      type: LIVE_SERVER_EVENT.SESSION_CLOSED,
      event_id: "e9",
      reason: LIVE_CLOSE_REASON.CLOSE_REQUESTED,
      usage: { seconds: 900 },
    }),
  );
  await second.upstream.closed;
  assert.deepEqual(context.accounts.reports, [
    { userId: FAKE_USER_ID, sessionId: first.created.sessionId, seconds: 900 },
  ]);
  assert.deepEqual(
    context.record.closes.map((closed) => [closed.sessionId, closed.seconds]),
    [[first.created.sessionId, 900]],
  );
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

test("the desktop's idle report and stop are read by the service and forwarded nowhere; one that is not a report is refused", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  const { desktop, upstream } = await openSession(context);

  await send(desktop.socket, { type: VOICE_SERVICE_FRAME.SESSION_ACTIVITY, idle: true });
  await send(desktop.socket, { type: VOICE_SERVICE_FRAME.SESSION_ACTIVITY, idle: false });
  await send(desktop.socket, { type: VOICE_SERVICE_FRAME.SESSION_STOP });
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
  assert.equal(ended.reportsRead, 3);
  assert.equal(ended.refusedUnpermitted, 1);
  assert.equal(ended.framesToUpstream, 0);
});

test("seconds are recorded once across a re-attach, whichever connection sees session.closed", async () => {
  const context = await stand({ closeTimeoutMs: 5_000 });
  onTestFinished(() => context.stop());
  const first = await openSession(context);
  // The hang-up went up and the socket dropped before its answer, so the
  // first relay still holds its sideband for the final event.
  await send(first.desktop.socket, { type: LIVE_CLIENT_EVENT.CLOSE, event_id: "x1" });
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
  await runWithoutDatabase(
    context.record.register({
      userId: "user-2",
      sessionId: "live_theirs",
      planId: PLAN.id,
      attachId: "attach-theirs",
    }),
  );

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

test("a session.create naming no plan is refused as an invalid request before the bearer is resolved or anything is spent", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());

  const { planId: _named, ...planless } = createFrame();
  const opened = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), { authorization: BEARER });
  assert.ok("reader" in opened);
  await send(opened.reader.socket, planless);
  assert.equal(hostedError(record(await opened.reader.next())), HOSTED_API_ERROR.INVALID_REQUEST);
  const end = await opened.reader.closed;
  assert.equal(end.code, SOCKET_CLOSE_CODE.POLICY_VIOLATION);
  assert.equal(end.reason, HOSTED_API_ERROR.INVALID_REQUEST);
  assert.equal(context.accounts.resolved.length, 0);
  assert.equal(context.accounts.spent.length, 0);
  assert.equal(context.openAi.creates.length, 0);
});

test("an attach to the account's own session whose row names no plan is refused as an invalid request, and nothing is attached", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  // A row written before every call was about a plan: the account's own, bound to none.
  const owned = context.record.owned;
  context.record.owned = (input) =>
    input.sessionId === "live_planless" ? Effect.succeed({ planId: undefined }) : owned(input);

  const opened = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), { authorization: BEARER });
  assert.ok("reader" in opened);
  await send(opened.reader.socket, {
    type: VOICE_SERVICE_FRAME.SESSION_ATTACH,
    sessionId: "live_planless",
  });
  assert.equal(hostedError(record(await opened.reader.next())), HOSTED_API_ERROR.INVALID_REQUEST);
  assert.equal((await opened.reader.closed).code, SOCKET_CLOSE_CODE.POLICY_VIOLATION);
  assert.deepEqual(context.accounts.resolved, [BEARER]);
  assert.equal(context.openAi.attaches.length, 0);
  assert.deepEqual(context.record.detachments, []);
});

/** The row the session's writes left, as the sweep reads it: open and stamped is a session it ends. */
const LEFT_TO_SWEEP = { closed: false, detached: true } as const;

/** Waits until the service has written the session's end down: the line it logs after every write of its own. */
function sessionEnded(context: Stand): Promise<void> {
  return runWithoutDatabase(
    settled(
      () => context.log.some((entry) => entry.event === LOG_EVENT.SESSION_ENDED),
      "the session to be reported ended",
    ),
  );
}

/**
 * A desktop that sends its opening frame and goes while the service stands
 * its session up: the bearer's resolution is held until the socket's close
 * handshake is done, so the service reads the frame from an open socket and
 * finds it gone only once the session exists. Answers OpenAI's end of the
 * sideband the service attached, once the service has released it.
 */
async function goneWhileOpening(context: Stand, frame: WireRecord) {
  const entered = await runWithoutDatabase(Deferred.make<void>());
  const resolution = await runWithoutDatabase(Deferred.make<void>());
  const resolveUserId = context.accounts.resolveUserId;
  context.accounts.resolveUserId = (authorization) =>
    Effect.andThen(
      Deferred.succeed(entered, undefined),
      Effect.andThen(Deferred.await(resolution), resolveUserId(authorization)),
    );
  const opened = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), { authorization: BEARER });
  assert.ok("reader" in opened);
  await send(opened.reader.socket, frame);
  await runWithoutDatabase(Deferred.await(entered));
  opened.reader.socket.close(SOCKET_CLOSE_CODE.NORMAL);
  await opened.reader.closed;
  await runWithoutDatabase(Deferred.succeed(resolution, undefined));
  const attach = await context.openAi.nextAttach();
  await readSocket(attach.socket).closed;
  context.accounts.resolveUserId = resolveUserId;
  return attach;
}

test("a desktop gone while its session was created or re-attached leaves the session stamped for the sweep", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());

  const created = await goneWhileOpening(context, createFrame());
  assert.deepEqual(context.record.rows.get(created.sessionId), LEFT_TO_SWEEP);

  // The re-attach clears the stamp as it attaches; the desktop it was for has gone.
  const reattached = await goneWhileOpening(context, {
    type: VOICE_SERVICE_FRAME.SESSION_ATTACH,
    sessionId: created.sessionId,
  });
  assert.equal(reattached.sessionId, created.sessionId);
  assert.deepEqual(context.record.rows.get(created.sessionId), LEFT_TO_SWEEP);
  assert.deepEqual(context.record.closes, []);
});

test("a detach the replaced connection writes after the desktop re-attached leaves the call the new connection holds unstamped", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  // The first connection's detach is held until the re-attach has landed, as
  // a function instance slower to wind down than the Mac's retry writes it.
  const gate = await runWithoutDatabase(Deferred.make<void>());
  const written = await runWithoutDatabase(Deferred.make<void>());
  const detach = context.record.detach;
  context.record.detach = (input) =>
    Effect.andThen(
      Deferred.await(gate),
      Effect.andThen(detach(input), Deferred.succeed(written, undefined)),
    );
  const first = await openSession(context);
  const sessionId = first.created.sessionId;

  first.desktop.socket.terminate();
  await first.upstream.closed;
  const second = await reattach(context, sessionId);
  await runWithoutDatabase(Deferred.succeed(gate, undefined));
  await runWithoutDatabase(Deferred.await(written));

  assert.deepEqual(context.record.rows.get(sessionId), { closed: false, detached: false });
  const caption = JSON.stringify({
    type: LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA,
    event_id: "e4",
    delta: "Still here",
    start_ms: 0,
    end_ms: 300,
  });
  await sendText(second.upstream.socket, caption);
  assert.equal(await second.desktop.next(), caption);
});

test("a hang-up OpenAI never confirms with session.closed leaves the session stamped for the sweep", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  const { desktop, upstream, created } = await openSession(context);

  await hangUpDevice(desktop.socket, SOCKET_CLOSE_CODE.NORMAL);
  assert.equal(record(await upstream.next()).type, LIVE_CLIENT_EVENT.CLOSE);
  await upstream.closed;
  await sessionEnded(context);
  assert.deepEqual(context.record.rows.get(created.sessionId), LEFT_TO_SWEEP);
});

test("a sideband that drops before session.closed leaves the session stamped for the sweep", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  const { desktop, upstream, created } = await openSession(context);

  upstream.socket.close(SOCKET_CLOSE_CODE.GOING_AWAY);
  await desktop.closed;
  await sessionEnded(context);
  assert.deepEqual(context.record.rows.get(created.sessionId), LEFT_TO_SWEEP);
});

test("a confirmed close leaves the session closed and unstamped", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  const { desktop, upstream, created } = await openSession(context);

  await sendText(
    upstream.socket,
    JSON.stringify({
      type: LIVE_SERVER_EVENT.SESSION_CLOSED,
      event_id: "e9",
      reason: LIVE_CLOSE_REASON.CLOSE_REQUESTED,
      usage: { seconds: 5 },
    }),
  );
  await desktop.closed;
  await sessionEnded(context);
  assert.deepEqual(context.record.rows.get(created.sessionId), { closed: true, detached: false });
});

test("a created session whose sideband OpenAI refuses is refused to the desktop and left stamped for the sweep", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  context.openAi.attachStatus = 500;

  const opened = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), { authorization: BEARER });
  assert.ok("reader" in opened);
  await send(opened.reader.socket, createFrame());
  assert.equal(hostedError(record(await opened.reader.next())), HOSTED_API_ERROR.UPSTREAM_ERROR);
  const [registered] = context.record.registered;
  assert.ok(registered);
  assert.deepEqual(context.record.rows.get(registered.sessionId), LEFT_TO_SWEEP);
});
