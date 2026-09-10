import assert from "node:assert/strict";
import test from "node:test";
import {
  HOSTED_API_ERROR,
  hostedErrorSchema,
  sessionAttachedFrameSchema,
  sessionCreatedFrameSchema,
  VOICE_SERVICE_FRAME,
  VOICE_SERVICE_PATH,
} from "@sidecar/hosted";
import { isRecord, isWireString, unparsedWire, type WireRecord } from "@sidecar/wire";
import { VOICE_SECONDS_OUTCOME } from "../server/hosted/quota";
import {
  greetingInstruction,
  LIVE_CLIENT_EVENT,
  LIVE_CLOSE_REASON,
  LIVE_DELEGATION_TARGET,
  LIVE_SCENE,
  LIVE_SERVER_EVENT,
  LIVE_TRANSPORT_TYPE,
  LIVE_VOICE,
  RENDERER_CLIENT_EVENTS,
  RENDERER_SERVER_EVENTS,
  SEED_CONTENT_TYPE,
  SEED_ITEM_TYPE,
  SEED_ROLE,
  sessionInstructions,
} from "../server/live";
import { INTRODUCTION_METER_LIMITS } from "../server/voice/introduction-meter";
import { LOG_EVENT, type LogEntry } from "../server/voice/log";
import { SOCKET_CLOSE_CODE, UPSTREAM_CLOSED_REASON } from "../server/voice/relay";
import {
  INTRODUCTION_INPUT_BOUNDS,
  UPGRADE_STATUS,
  VoiceService,
  type VoiceServiceOptions,
} from "../server/voice/service";
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

interface Stand {
  openAi: FakeOpenAi;
  accounts: FakeAccounts;
  record: FakeSessionRecord;
  service: VoiceService;
  log: LogEntry[];
  url(path: string): string;
  stop(): Promise<void>;
}

async function stand(overrides: Partial<VoiceServiceOptions> = {}): Promise<Stand> {
  const openAi = await startFakeOpenAi();
  const accounts = fakeAccounts();
  const record = fakeSessionRecord();
  const log: LogEntry[] = [];
  const service = new VoiceService({
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
  const port = await service.listen(0, "127.0.0.1");
  return {
    openAi,
    accounts,
    record,
    service,
    log,
    url: (path) => `ws://127.0.0.1:${port}${path}`,
    stop: async () => {
      await service.close();
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
  const attached = sessionAttachedFrameSchema.parse(record(await desktop.next()));
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
  const created = sessionCreatedFrameSchema.parse(record(await desktop.next()));
  assert.ok(created);
  return { desktop, upstream: readSocket(attach.socket), attach, created };
}

test("a /sessions upgrade without a bearer is refused with 401 before any socket stands", async (t) => {
  const context = await stand();
  t.after(() => context.stop());

  const refused = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS));
  assert.deepEqual(refused, { status: UPGRADE_STATUS.UNAUTHORIZED });
  const blank = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), {
    authorization: "Bearer  ",
  });
  assert.deepEqual(blank, { status: UPGRADE_STATUS.UNAUTHORIZED });
  assert.equal(context.accounts.resolved.length, 0);
});

test("without a project key every upgrade is refused with 503 and nothing is resolved", async (t) => {
  const context = await stand({ apiKey: "  " });
  t.after(() => context.stop());
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

test("an unknown path is refused with 404", async (t) => {
  const context = await stand();
  t.after(() => context.stop());
  assert.deepEqual(await connect(context.url("/elsewhere")), { status: UPGRADE_STATUS.NOT_FOUND });
});

test("a spent allowance closes the socket behind one hosted error frame and spends no session", async (t) => {
  const context = await stand();
  t.after(() => context.stop());
  context.accounts.spendAnswer = { allowed: false, quota: FAKE_QUOTA };

  const opened = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), { authorization: BEARER });
  assert.ok("reader" in opened);
  await send(opened.reader.socket, createFrame());

  assert.equal(
    hostedErrorSchema.parse(record(await opened.reader.next())),
    HOSTED_API_ERROR.QUOTA_EXHAUSTED,
  );
  const end = await opened.reader.closed;
  assert.equal(end.code, SOCKET_CLOSE_CODE.POLICY_VIOLATION);
  assert.equal(end.reason, HOSTED_API_ERROR.QUOTA_EXHAUSTED);
  assert.equal(context.openAi.creates.length, 0);
  assert.deepEqual(context.accounts.resolved, [BEARER]);
  assert.deepEqual(context.accounts.spent, [FAKE_USER_ID]);
});

test("a bearer no account stands behind is refused as an invalid token and spends nothing", async (t) => {
  const context = await stand();
  t.after(() => context.stop());

  const opened = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), {
    authorization: "Bearer stale",
  });
  assert.ok("reader" in opened);
  await send(opened.reader.socket, createFrame());
  assert.equal(
    hostedErrorSchema.parse(record(await opened.reader.next())),
    HOSTED_API_ERROR.INVALID_TOKEN,
  );
  assert.equal(context.openAi.creates.length, 0);
  assert.equal(context.accounts.spent.length, 0);
});

test("a first frame that is not session.create is refused as an invalid request", async (t) => {
  const context = await stand();
  t.after(() => context.stop());

  const opened = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), { authorization: BEARER });
  assert.ok("reader" in opened);
  await send(opened.reader.socket, { type: LIVE_CLIENT_EVENT.INPUT_AUDIO_MUTE, event_id: "m1" });
  assert.equal(
    hostedErrorSchema.parse(record(await opened.reader.next())),
    HOSTED_API_ERROR.INVALID_REQUEST,
  );
  assert.equal((await opened.reader.closed).code, SOCKET_CLOSE_CODE.POLICY_VIOLATION);
  assert.equal(context.accounts.resolved.length, 0);
});

test("a session is authorized, created, registered to its account, attached, and answered in that order", async (t) => {
  const context = await stand();
  t.after(() => context.stop());

  const { attach, created } = await openSession(context);

  assert.deepEqual(context.accounts.resolved, [BEARER]);
  assert.deepEqual(context.accounts.spent, [FAKE_USER_ID]);
  assert.deepEqual(context.record.registered, [
    { userId: FAKE_USER_ID, sessionId: created.sessionId },
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
  assert.deepEqual(created.quota, FAKE_QUOTA);
  assert.equal(context.service.sessions(), 1);
});

test("frames pass through untouched in both directions, except reflected audio, which is dropped by type", async (t) => {
  const context = await stand();
  t.after(() => context.stop());
  const { desktop, upstream, created } = await openSession(context);

  const toUpstream = [
    JSON.stringify({ type: LIVE_CLIENT_EVENT.INPUT_AUDIO_UNMUTE, event_id: "u1" }),
    JSON.stringify({
      type: LIVE_CLIENT_EVENT.COMMENTARY_APPEND,
      event_id: "c1",
      delegation_id: null,
      content: "Two sessions are working.",
    }),
    JSON.stringify({ type: LIVE_CLIENT_EVENT.INPUT_AUDIO_MUTE, event_id: "m1" }),
  ];
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

test("session.closed is forwarded, its seconds reported exactly once, and both ends closed", async (t) => {
  const context = await stand();
  t.after(() => context.stop());
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
  assert.equal(context.service.sessions(), 0);
});

test("a desktop that hangs up first has session.close sent for it and its seconds still recorded", async (t) => {
  const context = await stand();
  t.after(() => context.stop());
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

test("a sideband that never answers session.close is released at the timeout with usage unconfirmed", async (t) => {
  const context = await stand();
  t.after(() => context.stop());
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

test("a sideband that closes first takes the desktop socket with it and reports nothing", async (t) => {
  const context = await stand();
  t.after(() => context.stop());
  const { desktop, upstream } = await openSession(context);

  upstream.socket.close(SOCKET_CLOSE_CODE.GOING_AWAY);
  const end = await desktop.closed;
  assert.equal(end.code, SOCKET_CLOSE_CODE.GOING_AWAY);
  assert.equal(end.reason, UPSTREAM_CLOSED_REASON);
  assert.equal(context.accounts.reports.length, 0);
  assert.deepEqual(context.record.closes, []);
});

test("a creation OpenAI refuses is answered as an upstream error and nothing is attached", async (t) => {
  const context = await stand();
  t.after(() => context.stop());
  context.openAi.createStatus = 500;

  const opened = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), { authorization: BEARER });
  assert.ok("reader" in opened);
  await send(opened.reader.socket, createFrame());
  assert.equal(
    hostedErrorSchema.parse(record(await opened.reader.next())),
    HOSTED_API_ERROR.UPSTREAM_ERROR,
  );
  await opened.reader.closed;
  assert.equal(context.openAi.attaches.length, 0);
});

test("the introduction is created without an account, greeted exactly once after session.started, and shown captions only", async (t) => {
  const context = await stand();
  t.after(() => context.stop());

  const opened = await connect(context.url(VOICE_SERVICE_PATH.INTRODUCTION));
  assert.ok("reader" in opened);
  const desktop = opened.reader;
  await send(
    desktop.socket,
    createFrame([developerMessage("Running: api on main; web on feature/login.")]),
  );
  const attach = await context.openAi.nextAttach();
  const upstream = readSocket(attach.socket);
  const created = sessionCreatedFrameSchema.parse(record(await desktop.next()));
  assert.ok(created);
  assert.equal(created.quota, undefined);
  assert.equal(context.accounts.resolved.length, 0);
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

test("an introduction seed beyond one bounded developer message is refused before any session is spent", async (t) => {
  const context = await stand();
  t.after(() => context.stop());

  const tooMany = await connect(context.url(VOICE_SERVICE_PATH.INTRODUCTION));
  assert.ok("reader" in tooMany);
  await send(tooMany.reader.socket, createFrame([developerMessage("a"), developerMessage("b")]));
  assert.equal(
    hostedErrorSchema.parse(record(await tooMany.reader.next())),
    HOSTED_API_ERROR.INVALID_REQUEST,
  );

  const tooLong = await connect(context.url(VOICE_SERVICE_PATH.INTRODUCTION));
  assert.ok("reader" in tooLong);
  await send(
    tooLong.reader.socket,
    createFrame([developerMessage("x".repeat(INTRODUCTION_INPUT_BOUNDS.CHARS + 1))]),
  );
  assert.equal(
    hostedErrorSchema.parse(record(await tooLong.reader.next())),
    HOSTED_API_ERROR.INVALID_REQUEST,
  );

  const wrongRole = await connect(context.url(VOICE_SERVICE_PATH.INTRODUCTION));
  assert.ok("reader" in wrongRole);
  await send(wrongRole.reader.socket, createFrame([SEED[1] ?? {}]));
  assert.equal(
    hostedErrorSchema.parse(record(await wrongRole.reader.next())),
    HOSTED_API_ERROR.INVALID_REQUEST,
  );

  assert.equal(context.openAi.creates.length, 0);
});

test("the introduction meter refuses a caller's ninth upgrade of the day with 429 and admits another caller", async (t) => {
  const context = await stand();
  t.after(() => context.stop());
  const caller = { "x-forwarded-for": "10.0.0.1, 203.0.113.7" };

  for (let attempt = 0; attempt < INTRODUCTION_METER_LIMITS.PER_CALLER; attempt += 1) {
    const opened = await connect(context.url(VOICE_SERVICE_PATH.INTRODUCTION), caller);
    assert.ok("reader" in opened);
    opened.reader.socket.close();
    await opened.reader.closed;
  }
  assert.deepEqual(await connect(context.url(VOICE_SERVICE_PATH.INTRODUCTION), caller), {
    status: UPGRADE_STATUS.TOO_MANY_REQUESTS,
  });
  const other = await connect(context.url(VOICE_SERVICE_PATH.INTRODUCTION), {
    "x-forwarded-for": "198.51.100.2",
  });
  assert.ok("reader" in other);
  other.reader.socket.close();
});

test("a caller cannot become another by writing an earlier X-Forwarded-For hop", async (t) => {
  const context = await stand();
  t.after(() => context.stop());

  for (let attempt = 0; attempt < INTRODUCTION_METER_LIMITS.PER_CALLER; attempt += 1) {
    const opened = await connect(context.url(VOICE_SERVICE_PATH.INTRODUCTION), {
      "x-forwarded-for": `198.51.100.${attempt}, 203.0.113.7`,
    });
    assert.ok("reader" in opened);
    opened.reader.socket.close();
    await opened.reader.closed;
  }
  assert.deepEqual(
    await connect(context.url(VOICE_SERVICE_PATH.INTRODUCTION), {
      "x-forwarded-for": "198.51.100.99, 203.0.113.7",
    }),
    { status: UPGRADE_STATUS.TOO_MANY_REQUESTS },
  );
});

test("an upgrade carrying a browser Origin is refused with 403 on both routes", async (t) => {
  const context = await stand();
  t.after(() => context.stop());

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

test("closing the service closes every desktop socket and refuses new upgrades with 503", async (t) => {
  const context = await stand();
  const { desktop, upstream } = await openSession(context);
  t.after(() => context.openAi.close());

  const closing = context.service.close();
  assert.equal(await desktop.closed.then((end) => end.code), SOCKET_CLOSE_CODE.GOING_AWAY);
  assert.equal(record(await upstream.next()).type, LIVE_CLIENT_EVENT.CLOSE);
  await closing;
});

test("a fresh connection re-attaches its account's session, answers session.attached, and pipes again without spending", async (t) => {
  const context = await stand();
  t.after(() => context.stop());
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

  const mute = JSON.stringify({ type: LIVE_CLIENT_EVENT.INPUT_AUDIO_MUTE, event_id: "m1" });
  await sendText(second.desktop.socket, mute);
  assert.equal(await second.upstream.next(), mute);
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

test("seconds are recorded once across a re-attach, whichever connection sees session.closed", async (t) => {
  const context = await stand({ closeTimeoutMs: 5_000 });
  t.after(() => context.stop());
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

test("an attach to a session another account created, or one never created, is refused as the bearer's own failure", async (t) => {
  const context = await stand();
  t.after(() => context.stop());
  const { created } = await openSession(context);
  await context.record.register({ userId: "user-2", sessionId: "live_theirs" });

  for (const sessionId of ["live_theirs", "live_never"]) {
    const opened = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), {
      authorization: BEARER,
    });
    assert.ok("reader" in opened);
    await send(opened.reader.socket, { type: VOICE_SERVICE_FRAME.SESSION_ATTACH, sessionId });
    assert.equal(
      hostedErrorSchema.parse(record(await opened.reader.next())),
      HOSTED_API_ERROR.INVALID_TOKEN,
    );
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
  assert.equal(
    hostedErrorSchema.parse(record(await stale.reader.next())),
    HOSTED_API_ERROR.INVALID_TOKEN,
  );
  assert.equal(context.openAi.attaches.length, 1);
  assert.deepEqual(context.accounts.spent, [FAKE_USER_ID]);
});

test("the introduction never re-attaches", async (t) => {
  const context = await stand();
  t.after(() => context.stop());
  const opened = await connect(context.url(VOICE_SERVICE_PATH.INTRODUCTION));
  assert.ok("reader" in opened);
  await send(opened.reader.socket, {
    type: VOICE_SERVICE_FRAME.SESSION_ATTACH,
    sessionId: "live_intro",
  });
  assert.equal(
    hostedErrorSchema.parse(record(await opened.reader.next())),
    HOSTED_API_ERROR.INVALID_REQUEST,
  );
  assert.equal(context.openAi.attaches.length, 0);
});
