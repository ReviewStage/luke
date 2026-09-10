import assert from "node:assert/strict";
import test from "node:test";
import { HOSTED_API_ERROR, VOICE_SERVICE_FRAME, VOICE_SERVICE_PATH } from "@sidecar/hosted";
import {
  developerSeedItem,
  LIVE_CLIENT_EVENT,
  LIVE_DEFAULTS,
  LIVE_SERVER_EVENT,
  LIVE_SESSION_OUTCOME,
  LIVE_SESSIONS_PATH,
  LIVE_VOICE,
  type LiveServerEvent,
  liveAttachPath,
  RENDERER_CLIENT_EVENTS,
  RENDERER_SERVER_EVENTS,
} from "@sidecar/live";
import type { ParsedJsonObject } from "@sidecar/wire/testing";
import {
  type HostedLiveSessionOptions,
  HostedLiveSessionSource,
  IntroductionLiveSessionSource,
  KeyedLiveSessionSource,
  keyedLiveSessions,
  unavailableLiveDiagnostics,
} from "./live-session-source.js";
import { SOCKET_OPEN_FAULT } from "./live-socket.js";
import { type ScriptedOpening, type ScriptedSocketSeam, scriptedOpenSocket } from "./testing.js";

const NOW = 1_800_000_000_000;
const SDP_OFFER =
  "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
const SDP_ANSWER =
  "v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
const SESSION_ID = "ls_123";
const SERVICE_ORIGIN = "wss://voice.example.test";
const INPUT = [developerSeedItem("Roster: one session working.")];
const QUOTA = { used: 3, limit: 50, resetsAt: NOW + 3_600_000 };

interface RecordedRequest {
  url: string;
  init: RequestInit;
}

function openAi(answers: Array<() => Response>) {
  const requests: RecordedRequest[] = [];
  let call = 0;
  const fetchLike = async (url: string, init: RequestInit): Promise<Response> => {
    requests.push({ url, init });
    const answer = answers[Math.min(call, answers.length - 1)];
    call += 1;
    if (!answer) throw new Error("no scripted answer");
    return answer();
  };
  return { requests, fetchLike };
}

function created(body: ParsedJsonObject = {}) {
  return () =>
    new Response(
      JSON.stringify({
        session: { id: SESSION_ID, model: LIVE_DEFAULTS.MODEL },
        transport: { type: "webrtc", sdp: SDP_ANSWER },
        ...body,
      }),
      { status: 201 },
    );
}

function status(code: number) {
  return () => new Response(JSON.stringify({ error: "refused" }), { status: code });
}

function requestBody(request: RecordedRequest | undefined): ParsedJsonObject {
  // SAFETY: the test scripted the body as JSON; the assertions read its shape.
  return JSON.parse(String(request?.init.body)) as ParsedJsonObject;
}

function keyed(fetchLike: (url: string, init: RequestInit) => Promise<Response>) {
  const script = scriptedOpenSocket([() => undefined]);
  const source = new KeyedLiveSessionSource({
    apiKey: "sk-test",
    fetch: fetchLike,
    openSocket: script.openSocket,
    now: () => NOW,
  });
  return { source, ...script };
}

test("the keyed source posts the live session document with the key as its bearer", async () => {
  const { requests, fetchLike } = openAi([created()]);
  const { source } = keyed(fetchLike);
  source.setVoice(LIVE_VOICE.CEDAR);

  const opened = await source.create({ sdpOffer: SDP_OFFER, input: INPUT });

  assert.equal(opened?.sessionId, SESSION_ID);
  assert.equal(opened?.sdpAnswer, SDP_ANSWER);
  const [request] = requests;
  assert.equal(request?.url, `https://api.openai.com/v1${LIVE_SESSIONS_PATH}`);
  assert.equal(request?.init.method, "POST");
  assert.equal(new Headers(request?.init.headers).get("authorization"), "Bearer sk-test");
  const body = requestBody(request);
  assert.deepEqual(body.transport, { type: "webrtc", sdp: SDP_OFFER });
  // SAFETY: the request body was composed by liveSessionConfig, whose session is a record.
  const session = body.session as ParsedJsonObject;
  assert.equal(session.model, LIVE_DEFAULTS.MODEL);
  assert.deepEqual(session.audio, { output: { voice: LIVE_VOICE.CEDAR } });
  assert.deepEqual(session.delegation, { type: "client" });
  assert.equal(session.store, false);
  assert.deepEqual(session.input, INPUT);
  assert.deepEqual(session.client, {
    data_channel: {
      allowed_client_events: RENDERER_CLIENT_EVENTS,
      allowed_server_events: RENDERER_SERVER_EVENTS,
    },
  });
  assert.equal("tools" in session, false);
  // SAFETY: the same document's audio field is the record asserted two lines above.
  assert.equal("format" in (session.audio as ParsedJsonObject), false);
  const report = source.diagnostics();
  assert.equal(report.lastOutcome, LIVE_SESSION_OUTCOME.SUCCEEDED);
  assert.equal(report.apiKeyConfigured, true);
  assert.equal(report.hosted, undefined);
  assert.equal(report.voice, LIVE_VOICE.CEDAR);
  assert.equal(report.sidebandAttached, false);
  assert.equal(report.lastAttemptAt, NOW);
});

test("the keyed source attaches its sideband at the session's attach path under the same key", async () => {
  const { fetchLike } = openAi([created()]);
  const { source, opens, sockets } = keyed(fetchLike);
  const opened = await source.create({ sdpOffer: SDP_OFFER, input: [] });
  assert.ok(opened);

  const sideband = await opened.attach();
  const seen: LiveServerEvent[] = [];
  sideband.onEvent((event) => seen.push(event));

  const [open] = opens;
  assert.equal(open?.url, `wss://api.openai.com/v1${liveAttachPath(SESSION_ID)}`);
  assert.deepEqual(open?.headers, { authorization: "Bearer sk-test" });
  assert.equal(source.diagnostics().sidebandAttached, true);

  const [socket] = sockets;
  socket?.receive({
    type: LIVE_SERVER_EVENT.SESSION_STARTED,
    event_id: "ev_1",
    session: { id: SESSION_ID },
  });
  socket?.receive({ type: LIVE_SERVER_EVENT.OUTPUT_AUDIO_DELTA, delta: "AAAA" });
  assert.deepEqual(
    seen.map((event) => event.type),
    [LIVE_SERVER_EVENT.SESSION_STARTED],
  );

  socket?.closeFromServer({ code: 1000 });
  assert.equal(source.diagnostics().sidebandAttached, false);
});

test("the keyed source records a sideband that would not open and rejects the attach", async () => {
  const { fetchLike } = openAi([created()]);
  const script = scriptedOpenSocket([() => ({ fault: SOCKET_OPEN_FAULT.REFUSED, status: 403 })]);
  const source = new KeyedLiveSessionSource({
    apiKey: "sk-test",
    fetch: fetchLike,
    openSocket: script.openSocket,
  });
  const opened = await source.create({ sdpOffer: SDP_OFFER, input: [] });
  assert.ok(opened);

  await assert.rejects(opened.attach());
  assert.equal(source.diagnostics().lastOutcome, LIVE_SESSION_OUTCOME.SIDEBAND_FAILED);
  assert.equal(source.diagnostics().sidebandAttached, false);
});

test("the keyed source names each failure class and answers nothing", async () => {
  const cases: Array<{ answer: () => Response; outcome: string }> = [
    { answer: status(401), outcome: LIVE_SESSION_OUTCOME.HTTP_ERROR },
    { answer: status(429), outcome: LIVE_SESSION_OUTCOME.HTTP_ERROR },
    {
      answer: () => new Response("<html>", { status: 200 }),
      outcome: LIVE_SESSION_OUTCOME.MALFORMED_RESPONSE,
    },
    {
      answer: () => new Response(JSON.stringify({ session: { id: SESSION_ID } }), { status: 200 }),
      outcome: LIVE_SESSION_OUTCOME.MALFORMED_RESPONSE,
    },
    {
      answer: () => {
        throw new TypeError("fetch failed");
      },
      outcome: LIVE_SESSION_OUTCOME.NETWORK_ERROR,
    },
  ];
  for (const { answer, outcome } of cases) {
    const { fetchLike } = openAi([answer]);
    const { source } = keyed(fetchLike);
    assert.equal(await source.create({ sdpOffer: SDP_OFFER, input: [] }), undefined);
    assert.equal(source.diagnostics().lastOutcome, outcome);
  }
});

test("the keyed source falls back to its configured voice when a setting is cleared or unknown", () => {
  const { fetchLike } = openAi([created()]);
  const { source } = keyed(fetchLike);
  assert.equal(source.diagnostics().voice, LIVE_DEFAULTS.VOICE);
  source.setVoice(LIVE_VOICE.ASH);
  assert.equal(source.diagnostics().voice, LIVE_VOICE.ASH);
  source.setVoice("not-a-voice");
  assert.equal(source.diagnostics().voice, LIVE_DEFAULTS.VOICE);
  source.setVoice(undefined);
  assert.equal(source.diagnostics().voice, LIVE_DEFAULTS.VOICE);
});

test("a keyed source is built only from a key", () => {
  const { openSocket } = scriptedOpenSocket([]);
  assert.equal(keyedLiveSessions(undefined, { openSocket }), undefined);
  assert.equal(keyedLiveSessions("  ", { openSocket }), undefined);
  assert.equal(keyedLiveSessions("sk-test", { openSocket })?.model, LIVE_DEFAULTS.MODEL);
  assert.equal(
    keyedLiveSessions("sk-test", { openSocket, model: "gpt-live-next" })?.model,
    "gpt-live-next",
  );
});

function createdFrame(overrides: ParsedJsonObject = {}) {
  return {
    type: VOICE_SERVICE_FRAME.SESSION_CREATED,
    sessionId: SESSION_ID,
    sdpAnswer: SDP_ANSWER,
    quota: QUOTA,
    ...overrides,
  };
}

function answering(frame: ParsedJsonObject): ScriptedOpening {
  return (socket) => {
    socket.onSent(() => queueMicrotask(() => socket.receive(frame)));
    return undefined;
  };
}

function answeringText(data: string): ScriptedOpening {
  return (socket) => {
    socket.onSent(() => queueMicrotask(() => socket.receiveText(data)));
    return undefined;
  };
}

function closingOnSend(code: number): ScriptedOpening {
  return (socket) => {
    socket.onSent(() => queueMicrotask(() => socket.closeFromServer({ code })));
    return undefined;
  };
}

function hosted(script: ScriptedSocketSeam, options: Partial<HostedLiveSessionOptions> = {}) {
  return new HostedLiveSessionSource({
    serviceOrigin: SERVICE_ORIGIN,
    openSocket: script.openSocket,
    readAccessToken: async () => "token-1",
    refreshAccount: async () => undefined,
    readAccountKey: async () => "dev@example.test",
    now: () => NOW,
    requestTimeoutMs: 50,
    ...options,
  });
}

test("the hosted source opens one socket with the bearer on its handshake and sends the create frame first", async () => {
  const script = scriptedOpenSocket([answering(createdFrame())]);
  const source = hosted(script, { voice: LIVE_VOICE.MARIN });

  const opened = await source.create({ sdpOffer: SDP_OFFER, input: INPUT });

  assert.equal(opened?.sessionId, SESSION_ID);
  assert.equal(opened?.sdpAnswer, SDP_ANSWER);
  assert.equal(script.opens.length, 1);
  assert.equal(script.opens[0]?.url, `${SERVICE_ORIGIN}${VOICE_SERVICE_PATH.SESSIONS}`);
  assert.deepEqual(script.opens[0]?.headers, { authorization: "Bearer token-1" });
  const [socket] = script.sockets;
  assert.equal(socket?.sent.length, 1);
  assert.deepEqual(JSON.parse(socket?.sent[0] ?? ""), {
    type: VOICE_SERVICE_FRAME.SESSION_CREATE,
    sdp: SDP_OFFER,
    voice: LIVE_VOICE.MARIN,
    input: INPUT,
  });
  const report = source.diagnostics();
  assert.equal(report.hosted, true);
  assert.equal(report.apiKeyConfigured, false);
  assert.equal(report.lastOutcome, LIVE_SESSION_OUTCOME.SUCCEEDED);
  assert.deepEqual(report.quota, QUOTA);
});

test("the hosted source's attach is the socket that answered, and the answer frame is not an event", async () => {
  const script = scriptedOpenSocket([answering(createdFrame())]);
  const source = hosted(script);
  const opened = await source.create({ sdpOffer: SDP_OFFER, input: [] });
  assert.ok(opened);
  const [socket] = script.sockets;
  assert.ok(socket);
  assert.equal(socket.closedByClient, false);

  const sideband = await opened.attach();
  assert.equal(await opened.attach(), sideband);
  assert.equal(script.opens.length, 1);
  assert.equal(source.diagnostics().sidebandAttached, true);

  const seen: LiveServerEvent[] = [];
  sideband.onEvent((event) => seen.push(event));
  socket.receive(createdFrame());
  socket.receive({
    type: LIVE_SERVER_EVENT.INPUT_AUDIO_MUTED,
    event_id: "ev_1",
    client_event_id: "c_1",
  });
  assert.deepEqual(
    seen.map((event) => event.type),
    [LIVE_SERVER_EVENT.INPUT_AUDIO_MUTED],
  );

  sideband.send({ type: LIVE_CLIENT_EVENT.CLOSE, event_id: "c_2" });
  assert.equal(socket.sent.length, 2);
  socket.closeFromServer({ code: 1000 });
  assert.equal(source.diagnostics().sidebandAttached, false);
});

test("the hosted source refuses to open without an access token and opens no socket", async () => {
  const script = scriptedOpenSocket([answering(createdFrame())]);
  const source = hosted(script, { readAccessToken: async () => undefined });

  assert.equal(await source.create({ sdpOffer: SDP_OFFER, input: [] }), undefined);
  assert.equal(script.opens.length, 0);
  assert.equal(source.diagnostics().lastOutcome, LIVE_SESSION_OUTCOME.NOT_SIGNED_IN);
});

test("the hosted source names a refused handshake by its status", async () => {
  const cases: Array<{ status: number; outcome: string }> = [
    { status: 401, outcome: LIVE_SESSION_OUTCOME.NOT_SIGNED_IN },
    { status: 429, outcome: LIVE_SESSION_OUTCOME.QUOTA_EXHAUSTED },
    { status: 503, outcome: LIVE_SESSION_OUTCOME.HOSTED_UNAVAILABLE },
    { status: 500, outcome: LIVE_SESSION_OUTCOME.HTTP_ERROR },
  ];
  for (const { status: code, outcome } of cases) {
    const script = scriptedOpenSocket([() => ({ fault: SOCKET_OPEN_FAULT.REFUSED, status: code })]);
    const source = hosted(script);
    assert.equal(await source.create({ sdpOffer: SDP_OFFER, input: [] }), undefined);
    assert.equal(source.diagnostics().lastOutcome, outcome);
  }
  const script = scriptedOpenSocket([
    () => ({ fault: SOCKET_OPEN_FAULT.NETWORK, errorName: "ECONNREFUSED" }),
  ]);
  const source = hosted(script);
  assert.equal(await source.create({ sdpOffer: SDP_OFFER, input: [] }), undefined);
  assert.equal(source.diagnostics().lastOutcome, LIVE_SESSION_OUTCOME.NETWORK_ERROR);
});

test("the hosted source renews a refused bearer once and retries with the renewed one", async () => {
  let token = "token-old";
  const script = scriptedOpenSocket([
    () => ({ fault: SOCKET_OPEN_FAULT.REFUSED, status: 401 }),
    answering(createdFrame()),
  ]);
  const source = hosted(script, {
    readAccessToken: async () => token,
    refreshAccount: async () => {
      token = "token-new";
    },
  });

  const opened = await source.create({ sdpOffer: SDP_OFFER, input: [] });

  assert.equal(opened?.sessionId, SESSION_ID);
  assert.deepEqual(
    script.opens.map((open) => open.headers.authorization),
    ["Bearer token-old", "Bearer token-new"],
  );
});

test("the hosted source does not carry a renewed bearer for another account", async () => {
  let token = "token-old";
  let holder = "one@example.test";
  const script = scriptedOpenSocket([
    () => ({ fault: SOCKET_OPEN_FAULT.REFUSED, status: 401 }),
    answering(createdFrame()),
  ]);
  const source = hosted(script, {
    readAccessToken: async () => token,
    readAccountKey: async () => holder,
    refreshAccount: async () => {
      token = "token-new";
      holder = "two@example.test";
    },
  });

  assert.equal(await source.create({ sdpOffer: SDP_OFFER, input: [] }), undefined);
  assert.equal(script.opens.length, 1);
  assert.equal(source.diagnostics().lastOutcome, LIVE_SESSION_OUTCOME.NOT_SIGNED_IN);
});

test("the hosted source reads a hosted error frame as the refusal it names and closes the socket", async () => {
  const cases: Array<{ frame: ParsedJsonObject; outcome: string }> = [
    {
      frame: { error: HOSTED_API_ERROR.INVALID_TOKEN },
      outcome: LIVE_SESSION_OUTCOME.NOT_SIGNED_IN,
    },
    {
      frame: { error: HOSTED_API_ERROR.QUOTA_EXHAUSTED, quota: QUOTA },
      outcome: LIVE_SESSION_OUTCOME.QUOTA_EXHAUSTED,
    },
    {
      frame: { error: HOSTED_API_ERROR.UNAVAILABLE },
      outcome: LIVE_SESSION_OUTCOME.HOSTED_UNAVAILABLE,
    },
    { frame: { error: HOSTED_API_ERROR.UPSTREAM_ERROR }, outcome: LIVE_SESSION_OUTCOME.HTTP_ERROR },
  ];
  for (const { frame, outcome } of cases) {
    const script = scriptedOpenSocket([answering(frame)]);
    const source = hosted(script);
    assert.equal(await source.create({ sdpOffer: SDP_OFFER, input: [] }), undefined);
    assert.equal(source.diagnostics().lastOutcome, outcome);
    assert.equal(script.sockets[0]?.closedByClient, true);
  }
  const script = scriptedOpenSocket([
    answering({ error: HOSTED_API_ERROR.QUOTA_EXHAUSTED, quota: QUOTA }),
  ]);
  const source = hosted(script);
  await source.create({ sdpOffer: SDP_OFFER, input: [] });
  assert.deepEqual(source.diagnostics().quota, QUOTA);
});

test("the hosted source treats a frame that is neither answer nor error as malformed", async () => {
  const answers = [
    answeringText("not json"),
    answering({ type: "session.started" }),
    answering(createdFrame({ sdpAnswer: "" })),
  ];
  for (const answer of answers) {
    const script = scriptedOpenSocket([answer]);
    const source = hosted(script);
    assert.equal(await source.create({ sdpOffer: SDP_OFFER, input: [] }), undefined);
    assert.equal(source.diagnostics().lastOutcome, LIVE_SESSION_OUTCOME.MALFORMED_RESPONSE);
    assert.equal(script.sockets[0]?.closedByClient, true);
  }
});

test("the hosted source records a socket closed or silent before it answered as the service unavailable", async () => {
  const closing = scriptedOpenSocket([closingOnSend(1011)]);
  const closed = hosted(closing);
  assert.equal(await closed.create({ sdpOffer: SDP_OFFER, input: [] }), undefined);
  assert.equal(closed.diagnostics().lastOutcome, LIVE_SESSION_OUTCOME.HOSTED_UNAVAILABLE);

  const silent = scriptedOpenSocket([() => undefined]);
  const quiet = hosted(silent, { requestTimeoutMs: 10 });
  assert.equal(await quiet.create({ sdpOffer: SDP_OFFER, input: [] }), undefined);
  assert.equal(quiet.diagnostics().lastOutcome, LIVE_SESSION_OUTCOME.HOSTED_UNAVAILABLE);
  assert.equal(silent.sockets[0]?.closedByClient, true);
  assert.deepEqual(silent.sockets[0]?.listenerCounts, { messages: 0, closes: 0 });
});

test("the introduction source carries no authorization and opens no sideband", async () => {
  const { quota: _quota, ...unmetered } = createdFrame();
  const script = scriptedOpenSocket([answering(unmetered)]);
  const source = new IntroductionLiveSessionSource({
    serviceOrigin: SERVICE_ORIGIN,
    openSocket: script.openSocket,
    now: () => NOW,
    requestTimeoutMs: 50,
  });

  const opened = await source.create({ sdpOffer: SDP_OFFER, input: INPUT });

  assert.deepEqual(opened, { sessionId: SESSION_ID, sdpAnswer: SDP_ANSWER });
  assert.equal("attach" in (opened ?? {}), false);
  assert.equal(script.opens[0]?.url, `${SERVICE_ORIGIN}${VOICE_SERVICE_PATH.INTRODUCTION}`);
  assert.deepEqual(script.opens[0]?.headers, {});
  // SAFETY: the source sent the frame it composed as JSON; the assertions read its shape.
  const frame = JSON.parse(script.sockets[0]?.sent[0] ?? "") as ParsedJsonObject;
  assert.equal(frame.type, VOICE_SERVICE_FRAME.SESSION_CREATE);
  assert.equal(frame.voice, LIVE_DEFAULTS.VOICE);
  assert.deepEqual(frame.input, INPUT);
  assert.equal(script.sockets[0]?.closedByClient, true);
  const report = source.diagnostics();
  assert.equal(report.lastOutcome, LIVE_SESSION_OUTCOME.SUCCEEDED);
  assert.equal(report.sidebandAttached, false);
  assert.equal(report.quota, undefined);
});

test("the introduction source never reads a refusal as signed out", async () => {
  const refused = scriptedOpenSocket([() => ({ fault: SOCKET_OPEN_FAULT.REFUSED, status: 401 })]);
  const source = new IntroductionLiveSessionSource({
    serviceOrigin: SERVICE_ORIGIN,
    openSocket: refused.openSocket,
  });
  assert.equal(await source.create({ sdpOffer: SDP_OFFER, input: [] }), undefined);
  assert.equal(source.diagnostics().lastOutcome, LIVE_SESSION_OUTCOME.HTTP_ERROR);

  const metered = scriptedOpenSocket([() => ({ fault: SOCKET_OPEN_FAULT.REFUSED, status: 429 })]);
  const capped = new IntroductionLiveSessionSource({
    serviceOrigin: SERVICE_ORIGIN,
    openSocket: metered.openSocket,
  });
  assert.equal(await capped.create({ sdpOffer: SDP_OFFER, input: [] }), undefined);
  assert.equal(capped.diagnostics().lastOutcome, LIVE_SESSION_OUTCOME.QUOTA_EXHAUSTED);
});

test("unavailable diagnostics name the fixture run apart from the missing key", () => {
  assert.equal(
    unavailableLiveDiagnostics({ fixtureMode: true, apiKeyConfigured: false }).lastOutcome,
    LIVE_SESSION_OUTCOME.DISABLED_BY_FIXTURE,
  );
  const missing = unavailableLiveDiagnostics({ fixtureMode: false, apiKeyConfigured: false });
  assert.equal(missing.lastOutcome, LIVE_SESSION_OUTCOME.NO_API_KEY);
  assert.equal(missing.sidebandAttached, false);
  assert.equal(missing.voice, LIVE_DEFAULTS.VOICE);
});
