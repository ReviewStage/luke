import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  HOSTED_API_ERROR,
  VOICE_SERVICE_FRAME,
  VOICE_SERVICE_HEADER,
  VOICE_SERVICE_PATH,
} from "@sidecar/hosted";
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
import { Effect, TestClock } from "effect";
import { test } from "vitest";
import {
  HOSTED_REATTACH_DELAYS_MS,
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
    refreshAccount: () => Effect.void,
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

  assert.equal(source.diagnostics().sidebandAttached, true);
  socket.receive({
    type: LIVE_SERVER_EVENT.SESSION_STARTED,
    event_id: "ev_0",
    session: { id: SESSION_ID },
  });

  const sideband = await opened.attach();
  assert.equal(await opened.attach(), sideband);
  assert.equal(script.opens.length, 1);

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
    [LIVE_SERVER_EVENT.SESSION_STARTED, LIVE_SERVER_EVENT.INPUT_AUDIO_MUTED],
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
    refreshAccount: () =>
      Effect.sync(() => {
        token = "token-new";
      }),
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
    refreshAccount: () =>
      Effect.sync(() => {
        token = "token-new";
        holder = "two@example.test";
      }),
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
  // The hold's one listener of each kind stands for the socket's life; the wait itself left none.
  assert.deepEqual(silent.sockets[0]?.listenerCounts, { messages: 1, closes: 1 });
  // A frame or close arriving after the deadline settled the wait records nothing over its outcome.
  silent.sockets[0]?.receiveText("not a document");
  silent.sockets[0]?.closeFromServer({ code: 1000 });
  await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(quiet.diagnostics().lastOutcome, LIVE_SESSION_OUTCOME.HOSTED_UNAVAILABLE);
});

function attachedFrame(sessionId = SESSION_ID) {
  return { type: VOICE_SERVICE_FRAME.SESSION_ATTACHED, sessionId };
}

/** Waits for the scripted seam to have opened the given number of sockets, or fails. */
async function openedSockets(script: ScriptedSocketSeam, count: number): Promise<void> {
  for (let waited = 0; script.sockets.length < count && waited < 200; waited += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.equal(script.sockets.length, count);
}

function reattaching(script: ScriptedSocketSeam, options: Partial<HostedLiveSessionOptions> = {}) {
  return hosted(script, { reattachDelaysMs: [0, 0, 0], ...options });
}

test("a hosted connection lost mid-session re-attaches with session.attach and the pipe resumes", async () => {
  const script = scriptedOpenSocket([answering(createdFrame()), answering(attachedFrame())]);
  const source = reattaching(script, { readAccessToken: async () => "token-2" });
  const opened = await source.create({ sdpOffer: SDP_OFFER, input: [] });
  assert.ok(opened);
  const sideband = await opened.attach();
  const seen: LiveServerEvent[] = [];
  const closes: unknown[] = [];
  sideband.onEvent((event) => seen.push(event));
  sideband.onClose((close) => closes.push(close));
  const [first] = script.sockets;
  assert.ok(first);

  first.closeFromServer({ code: 1006 });
  await openedSockets(script, 2);
  const [, second] = script.sockets;
  assert.ok(second);
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.deepEqual(script.opens[1], {
    url: `${SERVICE_ORIGIN}${VOICE_SERVICE_PATH.SESSIONS}`,
    headers: { authorization: "Bearer token-2" },
  });
  assert.deepEqual(JSON.parse(second.sent[0] ?? ""), {
    type: VOICE_SERVICE_FRAME.SESSION_ATTACH,
    sessionId: SESSION_ID,
  });
  assert.deepEqual(closes, []);
  assert.equal(source.diagnostics().sidebandAttached, true);

  second.receive({
    type: LIVE_SERVER_EVENT.INPUT_AUDIO_MUTED,
    event_id: "ev_2",
    client_event_id: "c_2",
  });
  assert.deepEqual(
    seen.map((event) => event.type),
    [LIVE_SERVER_EVENT.INPUT_AUDIO_MUTED],
  );
  sideband.send({ type: LIVE_CLIENT_EVENT.CLOSE, event_id: "c_3" });
  assert.equal(second.sent.length, 2);
  assert.equal(first.sent.length, 1);
});

test("sends made during the gap are held and sent on the re-attached connection, in order", async () => {
  const script = scriptedOpenSocket([answering(createdFrame()), answering(attachedFrame())]);
  const source = reattaching(script);
  const opened = await source.create({ sdpOffer: SDP_OFFER, input: [] });
  assert.ok(opened);
  const sideband = await opened.attach();
  script.sockets[0]?.closeFromServer({ code: 1001 });
  sideband.send({ type: LIVE_CLIENT_EVENT.INPUT_AUDIO_MUTE, event_id: "c_1" });
  sideband.send({ type: LIVE_CLIENT_EVENT.INPUT_AUDIO_UNMUTE, event_id: "c_2" });
  await openedSockets(script, 2);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = script.sockets[1];
  assert.ok(second);
  assert.deepEqual(
    second.sent.map((data) => JSON.parse(data).type),
    [
      VOICE_SERVICE_FRAME.SESSION_ATTACH,
      LIVE_CLIENT_EVENT.INPUT_AUDIO_MUTE,
      LIVE_CLIENT_EVENT.INPUT_AUDIO_UNMUTE,
    ],
  );
});

test("re-attaching tries as many times as it has delays and then reports the loss", async () => {
  const script = scriptedOpenSocket([answering(createdFrame()), closingOnSend(1011)]);
  const source = reattaching(script);
  const opened = await source.create({ sdpOffer: SDP_OFFER, input: [] });
  assert.ok(opened);
  const sideband = await opened.attach();
  const closes: Array<{ code?: number }> = [];
  sideband.onClose((close) => closes.push(close));

  script.sockets[0]?.closeFromServer({ code: 1006 });
  await openedSockets(script, 4);
  for (let waited = 0; closes.length === 0 && waited < 200; waited += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.deepEqual(closes, [{ code: 1006 }]);
  assert.equal(script.sockets.length, 4);
  assert.equal(source.diagnostics().sidebandAttached, false);
  for (const socket of script.sockets.slice(1)) assert.equal(socket.closedByClient, true);
});

it.effect("reattaches on HOSTED_REATTACH_DELAYS_MS's own cadence, then gives up", () =>
  Effect.gen(function* () {
    const runtime = yield* Effect.runtime<never>();
    const script = scriptedOpenSocket([answering(createdFrame()), closingOnSend(1011)]);
    const source = reattaching(script, { reattachDelaysMs: HOSTED_REATTACH_DELAYS_MS, runtime });
    const opened = yield* Effect.promise(() => source.create({ sdpOffer: SDP_OFFER, input: [] }));
    assert.ok(opened);
    const sideband = yield* Effect.promise(() => opened.attach());
    const closes: Array<{ code?: number }> = [];
    sideband.onClose((close) => closes.push(close));

    script.sockets[0]?.closeFromServer({ code: 1006 });
    yield* Effect.promise(() => openedSockets(script, 2));
    assert.deepEqual(closes, []);

    yield* TestClock.adjust("3 seconds");
    yield* Effect.promise(() => openedSockets(script, 3));
    assert.deepEqual(closes, []);

    yield* TestClock.adjust("7 seconds");
    yield* Effect.promise(() => openedSockets(script, 4));
    assert.deepEqual(closes, [{ code: 1006 }]);
    assert.equal(script.sockets.length, 4);
  }),
);

it.effect("closing while a reattach wait stands interrupts it, opening no further attempt", () =>
  Effect.gen(function* () {
    const runtime = yield* Effect.runtime<never>();
    const script = scriptedOpenSocket([answering(createdFrame()), closingOnSend(1011)]);
    const source = reattaching(script, { reattachDelaysMs: HOSTED_REATTACH_DELAYS_MS, runtime });
    const opened = yield* Effect.promise(() => source.create({ sdpOffer: SDP_OFFER, input: [] }));
    assert.ok(opened);
    const sideband = yield* Effect.promise(() => opened.attach());

    script.sockets[0]?.closeFromServer({ code: 1006 });
    yield* Effect.promise(() => openedSockets(script, 2));
    sideband.close();
    yield* TestClock.adjust("1 minute");
    yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 5)));
    assert.equal(script.sockets.length, 2);
  }),
);

test("a service that refuses the attachment ends the tries at once", async () => {
  const script = scriptedOpenSocket([
    answering(createdFrame()),
    answering({ error: HOSTED_API_ERROR.UPSTREAM_ERROR }),
  ]);
  const source = reattaching(script);
  const opened = await source.create({ sdpOffer: SDP_OFFER, input: [] });
  assert.ok(opened);
  const sideband = await opened.attach();
  const closes: Array<{ code?: number }> = [];
  sideband.onClose((close) => closes.push(close));

  script.sockets[0]?.closeFromServer({ code: 1001 });
  for (let waited = 0; closes.length === 0 && waited < 200; waited += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.deepEqual(closes, [{ code: 1001 }]);
  assert.equal(script.sockets.length, 2);
  assert.equal(script.sockets[1]?.closedByClient, true);
});

test("a connection closed normally, or by the host itself, is the session's end and is not re-attached", async () => {
  const normal = scriptedOpenSocket([answering(createdFrame())]);
  const ended = reattaching(normal);
  const first = await ended.create({ sdpOffer: SDP_OFFER, input: [] });
  assert.ok(first);
  const firstCloses: unknown[] = [];
  (await first.attach()).onClose((close) => firstCloses.push(close));
  normal.sockets[0]?.closeFromServer({ code: 1000 });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(firstCloses, [{ code: 1000 }]);
  assert.equal(normal.sockets.length, 1);

  const own = scriptedOpenSocket([answering(createdFrame())]);
  const hungUp = reattaching(own);
  const second = await hungUp.create({ sdpOffer: SDP_OFFER, input: [] });
  assert.ok(second);
  const sideband = await second.attach();
  const secondCloses: unknown[] = [];
  sideband.onClose((close) => secondCloses.push(close));
  sideband.close();
  assert.equal(own.sockets[0]?.closedByClient, true);
  own.sockets[0]?.closeFromServer({ code: 1005 });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(secondCloses, [{ code: 1005 }]);
  assert.equal(own.sockets.length, 1);
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

  assert.equal(opened?.sessionId, SESSION_ID);
  assert.equal(opened?.sdpAnswer, SDP_ANSWER);
  assert.equal("attach" in (opened ?? {}), false);
  assert.equal(script.opens[0]?.url, `${SERVICE_ORIGIN}${VOICE_SERVICE_PATH.INTRODUCTION}`);
  assert.deepEqual(script.opens[0]?.headers, {});
  // SAFETY: the source sent the frame it composed as JSON; the assertions read its shape.
  const frame = JSON.parse(script.sockets[0]?.sent[0] ?? "") as ParsedJsonObject;
  assert.equal(frame.type, VOICE_SERVICE_FRAME.SESSION_CREATE);
  assert.equal(frame.voice, LIVE_DEFAULTS.VOICE);
  assert.deepEqual(frame.input, INPUT);
  // The service reads the connection's close as the hang-up, so the socket
  // stands until the caller closes it.
  assert.equal(script.sockets[0]?.closedByClient, false);
  opened?.close();
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

test("the hosted source names this installation's device on the create handshake alone, and none while no device is registered", async () => {
  const deviceId = "6f0b1d2e-3c4a-4b5c-8d6e-7f8091a2b3c4";
  const script = scriptedOpenSocket([answering(createdFrame()), answering(attachedFrame())]);
  let registered: string | undefined = deviceId;
  const source = reattaching(script, { deviceId: () => registered });

  const opened = await source.create({ sdpOffer: SDP_OFFER, input: [] });
  assert.ok(opened);
  await opened.attach();
  const [first] = script.sockets;
  assert.ok(first);
  first.closeFromServer({ code: 1006 });
  await openedSockets(script, 2);

  assert.deepEqual(script.opens[0]?.headers, {
    authorization: "Bearer token-1",
    [VOICE_SERVICE_HEADER.DEVICE_ID]: deviceId,
  });
  assert.deepEqual(script.opens[1]?.headers, { authorization: "Bearer token-1" });

  registered = undefined;
  const unregistered = scriptedOpenSocket([answering(createdFrame())]);
  assert.ok(
    await hosted(unregistered, { deviceId: () => registered }).create({
      sdpOffer: SDP_OFFER,
      input: [],
    }),
  );
  assert.deepEqual(unregistered.opens[0]?.headers, { authorization: "Bearer token-1" });
});

/** An opening whose far side answers the first frame and speaks again in the same tick, before any continuation runs. */
function answeringThenSpeaking(
  answer: ParsedJsonObject,
  spoken: ParsedJsonObject[],
): ScriptedOpening {
  return (socket) => {
    socket.onSent(() =>
      queueMicrotask(() => {
        socket.receive(answer);
        for (const frame of spoken) socket.receive(frame);
      }),
    );
    return undefined;
  };
}

test("a frame the service sends right behind session.created, before the sideband subscribes, reaches the sideband in order", async () => {
  const script = scriptedOpenSocket([
    answeringThenSpeaking(createdFrame(), [
      { type: LIVE_SERVER_EVENT.SESSION_STARTED, event_id: "ev_1", session: { id: SESSION_ID } },
      { type: LIVE_SERVER_EVENT.INPUT_AUDIO_MUTED, event_id: "ev_2", client_event_id: "c_1" },
    ]),
  ]);
  const source = hosted(script);
  const opened = await source.create({ sdpOffer: SDP_OFFER, input: [] });
  assert.ok(opened);
  const sideband = await opened.attach();
  const seen: LiveServerEvent[] = [];
  sideband.onEvent((event) => seen.push(event));
  assert.deepEqual(
    seen.map((event) => event.type),
    [LIVE_SERVER_EVENT.SESSION_STARTED, LIVE_SERVER_EVENT.INPUT_AUDIO_MUTED],
  );
});

test("a frame the service sends right behind session.attached, before the recovering socket adopts the connection, reaches the sideband", async () => {
  const script = scriptedOpenSocket([
    answering(createdFrame()),
    answeringThenSpeaking(attachedFrame(), [
      { type: LIVE_SERVER_EVENT.INPUT_AUDIO_MUTED, event_id: "ev_2", client_event_id: "c_2" },
    ]),
  ]);
  const source = reattaching(script, { readAccessToken: async () => "token-2" });
  const opened = await source.create({ sdpOffer: SDP_OFFER, input: [] });
  assert.ok(opened);
  const sideband = await opened.attach();
  const seen: LiveServerEvent[] = [];
  sideband.onEvent((event) => seen.push(event));
  const [first] = script.sockets;
  assert.ok(first);
  first.closeFromServer({ code: 1006 });
  await openedSockets(script, 2);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(
    seen.map((event) => event.type),
    [LIVE_SERVER_EVENT.INPUT_AUDIO_MUTED],
  );
});

test("a close that lands in the keyed attach's open gap reaches the sideband that subscribes after the attached flag, and the flag reads false", async () => {
  const { fetchLike } = openAi([created()]);
  const script = scriptedOpenSocket([
    (socket) => {
      queueMicrotask(() => socket.closeFromServer({ code: 1006 }));
      return undefined;
    },
  ]);
  const source = new KeyedLiveSessionSource({
    apiKey: "sk-test",
    fetch: fetchLike,
    openSocket: script.openSocket,
    now: () => NOW,
  });
  const opened = await source.create({ sdpOffer: SDP_OFFER, input: [] });
  assert.ok(opened);
  const sideband = await opened.attach();
  const closes: (number | undefined)[] = [];
  sideband.onClose((close) => closes.push(close.code));
  assert.deepEqual(closes, [1006]);
  assert.equal(source.diagnostics().sidebandAttached, false);
});

test("a normal close right behind session.created ends the recovering socket, and the sideband that subscribes afterwards is told", async () => {
  const script = scriptedOpenSocket([
    (socket) => {
      socket.onSent(() =>
        queueMicrotask(() => {
          socket.receive(createdFrame());
          socket.closeFromServer({ code: 1000 });
        }),
      );
      return undefined;
    },
  ]);
  const source = hosted(script);
  const opened = await source.create({ sdpOffer: SDP_OFFER, input: [] });
  assert.ok(opened);
  const sideband = await opened.attach();
  const closes: (number | undefined)[] = [];
  sideband.onClose((close) => closes.push(close.code));
  assert.deepEqual(closes, [1000]);
  assert.equal(script.sockets.length, 1);
});
