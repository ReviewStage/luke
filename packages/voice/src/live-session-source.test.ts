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
  liveAttachPath,
  RENDERER_CLIENT_EVENTS,
  RENDERER_SERVER_EVENTS,
} from "@sidecar/live";
import { fakeHttpClientLayer, type ParsedJsonObject } from "@sidecar/wire/testing";
import { Effect, Exit } from "effect";
import { TestClock } from "effect/testing";
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
import {
  readSideband,
  type ScriptedOpening,
  type ScriptedSocketSeam,
  scriptedOpenSocket,
} from "./testing.js";

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
    httpClient: fakeHttpClientLayer(fetchLike),
    openSocket: script.openSocket,
    now: () => NOW,
  });
  return { source, ...script };
}

it.scopedLive("the keyed source posts the live session document with the key as its bearer", () =>
  Effect.gen(function* () {
    const { requests, fetchLike } = openAi([created()]);
    const { source } = keyed(fetchLike);
    source.setVoice(LIVE_VOICE.CEDAR);

    const opened = yield* source.create({ sdpOffer: SDP_OFFER, input: INPUT });

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
  }),
);

it.scopedLive(
  "the keyed source attaches its sideband at the session's attach path under the same key",
  () =>
    Effect.gen(function* () {
      const { fetchLike } = openAi([created()]);
      const { source, opens, sockets } = keyed(fetchLike);
      const opened = yield* source.create({ sdpOffer: SDP_OFFER, input: [] });
      assert.ok(opened);

      const read = yield* readSideband(yield* opened.attach());

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
      yield* pause;
      assert.deepEqual(
        read.events.map((event) => event.type),
        [LIVE_SERVER_EVENT.SESSION_STARTED],
      );

      socket?.closeFromServer({ code: 1000 });
      yield* pause;
      assert.equal(source.diagnostics().sidebandAttached, false);
    }),
);

it.scopedLive(
  "the keyed source records a sideband that would not open and rejects the attach",
  () =>
    Effect.gen(function* () {
      const { fetchLike } = openAi([created()]);
      const script = scriptedOpenSocket([
        () => ({ fault: SOCKET_OPEN_FAULT.REFUSED, status: 403 }),
      ]);
      const source = new KeyedLiveSessionSource({
        apiKey: "sk-test",
        httpClient: fakeHttpClientLayer(fetchLike),
        openSocket: script.openSocket,
      });
      const opened = yield* source.create({ sdpOffer: SDP_OFFER, input: [] });
      assert.ok(opened);

      const attached = yield* Effect.exit(opened.attach());
      assert.equal(Exit.isFailure(attached), true);
      assert.equal(source.diagnostics().lastOutcome, LIVE_SESSION_OUTCOME.SIDEBAND_FAILED);
      assert.equal(source.diagnostics().sidebandAttached, false);
    }),
);

it.scopedLive("the keyed source names each failure class and answers nothing", () =>
  Effect.gen(function* () {
    const cases: Array<{ answer: () => Response; outcome: string }> = [
      { answer: status(401), outcome: LIVE_SESSION_OUTCOME.HTTP_ERROR },
      { answer: status(429), outcome: LIVE_SESSION_OUTCOME.HTTP_ERROR },
      {
        answer: () => new Response("<html>", { status: 200 }),
        outcome: LIVE_SESSION_OUTCOME.MALFORMED_RESPONSE,
      },
      {
        answer: () =>
          new Response(JSON.stringify({ session: { id: SESSION_ID } }), { status: 200 }),
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
      assert.equal(yield* source.create({ sdpOffer: SDP_OFFER, input: [] }), undefined);
      assert.equal(source.diagnostics().lastOutcome, outcome);
    }
  }),
);

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
    readAccessToken: () => Effect.succeed("token-1"),
    refreshAccount: () => Effect.void,
    readAccountKey: () => Effect.succeed("dev@example.test"),
    now: () => NOW,
    requestTimeoutMs: 50,
    ...options,
  });
}

it.scopedLive(
  "the hosted source opens one socket with the bearer on its handshake and sends the create frame first",
  () =>
    Effect.gen(function* () {
      const script = scriptedOpenSocket([answering(createdFrame())]);
      const source = hosted(script, { voice: LIVE_VOICE.MARIN });

      const opened = yield* source.create({ sdpOffer: SDP_OFFER, input: INPUT });

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
    }),
);

it.scopedLive(
  "the hosted source's attach is the socket that answered, and the answer frame is not an event",
  () =>
    Effect.gen(function* () {
      const script = scriptedOpenSocket([answering(createdFrame())]);
      const source = hosted(script);
      const opened = yield* source.create({ sdpOffer: SDP_OFFER, input: [] });
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

      const sideband = yield* opened.attach();
      assert.equal(yield* opened.attach(), sideband);
      assert.equal(script.opens.length, 1);

      const read = yield* readSideband(sideband);
      socket.receive(createdFrame());
      socket.receive({
        type: LIVE_SERVER_EVENT.INPUT_AUDIO_MUTED,
        event_id: "ev_1",
        client_event_id: "c_1",
      });
      yield* pause;
      assert.deepEqual(
        read.events.map((event) => event.type),
        [LIVE_SERVER_EVENT.SESSION_STARTED, LIVE_SERVER_EVENT.INPUT_AUDIO_MUTED],
      );

      yield* sideband.send({ type: LIVE_CLIENT_EVENT.CLOSE, event_id: "c_2" });
      assert.equal(socket.sent.length, 2);
      socket.closeFromServer({ code: 1000 });
      yield* pause;
      assert.equal(source.diagnostics().sidebandAttached, false);
    }),
);

it.scopedLive("the hosted source refuses to open without an access token and opens no socket", () =>
  Effect.gen(function* () {
    const script = scriptedOpenSocket([answering(createdFrame())]);
    const source = hosted(script, { readAccessToken: () => Effect.succeed(undefined) });

    assert.equal(yield* source.create({ sdpOffer: SDP_OFFER, input: [] }), undefined);
    assert.equal(script.opens.length, 0);
    assert.equal(source.diagnostics().lastOutcome, LIVE_SESSION_OUTCOME.NOT_SIGNED_IN);
  }),
);

it.scopedLive("the hosted source names a refused handshake by its status", () =>
  Effect.gen(function* () {
    const cases: Array<{ status: number; outcome: string }> = [
      { status: 401, outcome: LIVE_SESSION_OUTCOME.NOT_SIGNED_IN },
      { status: 429, outcome: LIVE_SESSION_OUTCOME.QUOTA_EXHAUSTED },
      { status: 503, outcome: LIVE_SESSION_OUTCOME.HOSTED_UNAVAILABLE },
      { status: 500, outcome: LIVE_SESSION_OUTCOME.HTTP_ERROR },
    ];
    for (const { status: code, outcome } of cases) {
      const script = scriptedOpenSocket([
        () => ({ fault: SOCKET_OPEN_FAULT.REFUSED, status: code }),
      ]);
      const source = hosted(script);
      assert.equal(yield* source.create({ sdpOffer: SDP_OFFER, input: [] }), undefined);
      assert.equal(source.diagnostics().lastOutcome, outcome);
    }
    const script = scriptedOpenSocket([
      () => ({ fault: SOCKET_OPEN_FAULT.NETWORK, errorName: "ECONNREFUSED" }),
    ]);
    const source = hosted(script);
    assert.equal(yield* source.create({ sdpOffer: SDP_OFFER, input: [] }), undefined);
    assert.equal(source.diagnostics().lastOutcome, LIVE_SESSION_OUTCOME.NETWORK_ERROR);
  }),
);

it.scopedLive(
  "the hosted source renews a refused bearer once and retries with the renewed one",
  () =>
    Effect.gen(function* () {
      let token = "token-old";
      const script = scriptedOpenSocket([
        () => ({ fault: SOCKET_OPEN_FAULT.REFUSED, status: 401 }),
        answering(createdFrame()),
      ]);
      const source = hosted(script, {
        readAccessToken: () => Effect.succeed(token),
        refreshAccount: () =>
          Effect.sync(() => {
            token = "token-new";
          }),
      });

      const opened = yield* source.create({ sdpOffer: SDP_OFFER, input: [] });

      assert.equal(opened?.sessionId, SESSION_ID);
      assert.deepEqual(
        script.opens.map((open) => open.headers.authorization),
        ["Bearer token-old", "Bearer token-new"],
      );
    }),
);

it.scopedLive("the hosted source does not carry a renewed bearer for another account", () =>
  Effect.gen(function* () {
    let token = "token-old";
    let holder = "one@example.test";
    const script = scriptedOpenSocket([
      () => ({ fault: SOCKET_OPEN_FAULT.REFUSED, status: 401 }),
      answering(createdFrame()),
    ]);
    const source = hosted(script, {
      readAccessToken: () => Effect.succeed(token),
      readAccountKey: () => Effect.succeed(holder),
      refreshAccount: () =>
        Effect.sync(() => {
          token = "token-new";
          holder = "two@example.test";
        }),
    });

    assert.equal(yield* source.create({ sdpOffer: SDP_OFFER, input: [] }), undefined);
    assert.equal(script.opens.length, 1);
    assert.equal(source.diagnostics().lastOutcome, LIVE_SESSION_OUTCOME.NOT_SIGNED_IN);
  }),
);

it.scopedLive(
  "the hosted source reads a hosted error frame as the refusal it names and closes the socket",
  () =>
    Effect.gen(function* () {
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
        {
          frame: { error: HOSTED_API_ERROR.UPSTREAM_ERROR },
          outcome: LIVE_SESSION_OUTCOME.HTTP_ERROR,
        },
      ];
      for (const { frame, outcome } of cases) {
        const script = scriptedOpenSocket([answering(frame)]);
        const source = hosted(script);
        assert.equal(yield* source.create({ sdpOffer: SDP_OFFER, input: [] }), undefined);
        assert.equal(source.diagnostics().lastOutcome, outcome);
        assert.equal(script.sockets[0]?.closedByClient, true);
      }
      const script = scriptedOpenSocket([
        answering({ error: HOSTED_API_ERROR.QUOTA_EXHAUSTED, quota: QUOTA }),
      ]);
      const source = hosted(script);
      yield* source.create({ sdpOffer: SDP_OFFER, input: [] });
      assert.deepEqual(source.diagnostics().quota, QUOTA);
    }),
);

it.scopedLive(
  "the hosted source treats a frame that is neither answer nor error as malformed",
  () =>
    Effect.gen(function* () {
      const answers = [
        answeringText("not json"),
        answering({ type: "session.started" }),
        answering(createdFrame({ sdpAnswer: "" })),
      ];
      for (const answer of answers) {
        const script = scriptedOpenSocket([answer]);
        const source = hosted(script);
        assert.equal(yield* source.create({ sdpOffer: SDP_OFFER, input: [] }), undefined);
        assert.equal(source.diagnostics().lastOutcome, LIVE_SESSION_OUTCOME.MALFORMED_RESPONSE);
        assert.equal(script.sockets[0]?.closedByClient, true);
      }
    }),
);

it.scopedLive(
  "the hosted source records a socket closed or silent before it answered as the service unavailable",
  () =>
    Effect.gen(function* () {
      const closing = scriptedOpenSocket([closingOnSend(1011)]);
      const closed = hosted(closing);
      assert.equal(yield* closed.create({ sdpOffer: SDP_OFFER, input: [] }), undefined);
      assert.equal(closed.diagnostics().lastOutcome, LIVE_SESSION_OUTCOME.HOSTED_UNAVAILABLE);

      const silent = scriptedOpenSocket([() => undefined]);
      const quiet = hosted(silent, { requestTimeoutMs: 10 });
      assert.equal(yield* quiet.create({ sdpOffer: SDP_OFFER, input: [] }), undefined);
      assert.equal(quiet.diagnostics().lastOutcome, LIVE_SESSION_OUTCOME.HOSTED_UNAVAILABLE);
      assert.equal(silent.sockets[0]?.closedByClient, true);
      // A frame or close arriving after the deadline settled the wait records nothing over its outcome.
      silent.sockets[0]?.receiveText("not a document");
      silent.sockets[0]?.closeFromServer({ code: 1000 });
      yield* pause;
      assert.equal(quiet.diagnostics().lastOutcome, LIVE_SESSION_OUTCOME.HOSTED_UNAVAILABLE);
    }),
);

function attachedFrame(sessionId = SESSION_ID) {
  return { type: VOICE_SERVICE_FRAME.SESSION_ATTACHED, sessionId };
}

/**
 * Wall time, whatever clock the test keeps: what the recovering socket does
 * off the test's own fiber happens in real milliseconds, and a test driving
 * the `TestClock` waits for it the same way.
 */
const pause = Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 5)));

/** Waits for the scripted seam to have opened the given number of sockets, or fails. */
function openedSockets(script: ScriptedSocketSeam, count: number): Effect.Effect<void> {
  return Effect.promise(async () => {
    for (let waited = 0; script.sockets.length < count && waited < 200; waited += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    assert.equal(script.sockets.length, count);
  });
}

/** Waits for the socket's close to have reached its listeners, or fails. */
function closesReported(closes: readonly unknown[]): Effect.Effect<void> {
  return Effect.promise(async () => {
    for (let waited = 0; closes.length === 0 && waited < 200; waited += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    assert.equal(closes.length > 0, true);
  });
}

function reattaching(script: ScriptedSocketSeam, options: Partial<HostedLiveSessionOptions> = {}) {
  return hosted(script, { reattachDelaysMs: [0, 0, 0], ...options });
}

it.scopedLive(
  "a hosted connection lost mid-session re-attaches with session.attach and the pipe resumes",
  () =>
    Effect.gen(function* () {
      const script = scriptedOpenSocket([answering(createdFrame()), answering(attachedFrame())]);
      const source = reattaching(script, { readAccessToken: () => Effect.succeed("token-2") });
      const opened = yield* source.create({ sdpOffer: SDP_OFFER, input: [] });
      assert.ok(opened);
      const sideband = yield* opened.attach();
      const read = yield* readSideband(sideband);
      const [first] = script.sockets;
      assert.ok(first);

      first.closeFromServer({ code: 1006 });
      yield* openedSockets(script, 2);
      const [, second] = script.sockets;
      assert.ok(second);
      yield* pause;

      assert.deepEqual(script.opens[1], {
        url: `${SERVICE_ORIGIN}${VOICE_SERVICE_PATH.SESSIONS}`,
        headers: { authorization: "Bearer token-2" },
      });
      assert.deepEqual(JSON.parse(second.sent[0] ?? ""), {
        type: VOICE_SERVICE_FRAME.SESSION_ATTACH,
        sessionId: SESSION_ID,
      });
      assert.deepEqual(read.closes, []);
      assert.equal(source.diagnostics().sidebandAttached, true);

      second.receive({
        type: LIVE_SERVER_EVENT.INPUT_AUDIO_MUTED,
        event_id: "ev_2",
        client_event_id: "c_2",
      });
      yield* pause;
      assert.deepEqual(
        read.events.map((event) => event.type),
        [LIVE_SERVER_EVENT.INPUT_AUDIO_MUTED],
      );
      yield* sideband.send({ type: LIVE_CLIENT_EVENT.CLOSE, event_id: "c_3" });
      assert.equal(second.sent.length, 2);
      assert.equal(first.sent.length, 1);
    }),
);

it.scopedLive(
  "sends made during the gap are held and sent on the re-attached connection, in order",
  () =>
    Effect.gen(function* () {
      const script = scriptedOpenSocket([answering(createdFrame()), answering(attachedFrame())]);
      const source = reattaching(script);
      const opened = yield* source.create({ sdpOffer: SDP_OFFER, input: [] });
      assert.ok(opened);
      const sideband = yield* opened.attach();
      script.sockets[0]?.closeFromServer({ code: 1001 });
      // The gap begins where the socket's own reader takes that close, which is the turn after it.
      yield* pause;
      yield* sideband.send({ type: LIVE_CLIENT_EVENT.INPUT_AUDIO_MUTE, event_id: "c_1" });
      yield* sideband.send({ type: LIVE_CLIENT_EVENT.INPUT_AUDIO_UNMUTE, event_id: "c_2" });
      yield* openedSockets(script, 2);
      yield* pause;
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
    }),
);

it.scopedLive("re-attaching tries as many times as it has delays and then reports the loss", () =>
  Effect.gen(function* () {
    const script = scriptedOpenSocket([answering(createdFrame()), closingOnSend(1011)]);
    const source = reattaching(script);
    const opened = yield* source.create({ sdpOffer: SDP_OFFER, input: [] });
    assert.ok(opened);
    const read = yield* readSideband(yield* opened.attach());

    script.sockets[0]?.closeFromServer({ code: 1006 });
    yield* openedSockets(script, 4);
    yield* closesReported(read.closes);
    assert.deepEqual(read.closes, [{ code: 1006 }]);
    assert.equal(script.sockets.length, 4);
    assert.equal(source.diagnostics().sidebandAttached, false);
    for (const socket of script.sockets.slice(1)) assert.equal(socket.closedByClient, true);
  }),
);

it.scoped("reattaches on HOSTED_REATTACH_DELAYS_MS's own cadence, then gives up", () =>
  Effect.gen(function* () {
    const script = scriptedOpenSocket([answering(createdFrame()), closingOnSend(1011)]);
    const source = reattaching(script, { reattachDelaysMs: HOSTED_REATTACH_DELAYS_MS });
    const opened = yield* source.create({ sdpOffer: SDP_OFFER, input: [] });
    assert.ok(opened);
    const read = yield* readSideband(yield* opened.attach());

    script.sockets[0]?.closeFromServer({ code: 1006 });
    yield* openedSockets(script, 2);
    assert.deepEqual(read.closes, []);

    yield* TestClock.adjust("3 seconds");
    yield* openedSockets(script, 3);
    assert.deepEqual(read.closes, []);

    yield* TestClock.adjust("7 seconds");
    yield* openedSockets(script, 4);
    yield* closesReported(read.closes);
    assert.deepEqual(read.closes, [{ code: 1006 }]);
    assert.equal(script.sockets.length, 4);
  }),
);

it.scoped("closing while an attach attempt waits for its answer closes the socket it opened", () =>
  Effect.gen(function* () {
    const script = scriptedOpenSocket([answering(createdFrame()), () => undefined]);
    const source = reattaching(script, { reattachDelaysMs: HOSTED_REATTACH_DELAYS_MS });
    const opened = yield* source.create({ sdpOffer: SDP_OFFER, input: [] });
    assert.ok(opened);
    const sideband = yield* opened.attach();

    script.sockets[0]?.closeFromServer({ code: 1006 });
    yield* openedSockets(script, 2);
    yield* sideband.close;
    yield* pause;

    assert.equal(script.sockets.length, 2);
    assert.equal(script.sockets[1]?.closedByClient, true);
  }),
);

it.scoped("closing while a reattach wait stands interrupts it, opening no further attempt", () =>
  Effect.gen(function* () {
    const script = scriptedOpenSocket([answering(createdFrame()), closingOnSend(1011)]);
    const source = reattaching(script, { reattachDelaysMs: HOSTED_REATTACH_DELAYS_MS });
    const opened = yield* source.create({ sdpOffer: SDP_OFFER, input: [] });
    assert.ok(opened);
    const sideband = yield* opened.attach();

    script.sockets[0]?.closeFromServer({ code: 1006 });
    yield* openedSockets(script, 2);
    yield* sideband.close;
    yield* TestClock.adjust("1 minute");
    yield* pause;
    assert.equal(script.sockets.length, 2);
  }),
);

it.scopedLive("a service that refuses the attachment ends the tries at once", () =>
  Effect.gen(function* () {
    const script = scriptedOpenSocket([
      answering(createdFrame()),
      answering({ error: HOSTED_API_ERROR.UPSTREAM_ERROR }),
    ]);
    const source = reattaching(script);
    const opened = yield* source.create({ sdpOffer: SDP_OFFER, input: [] });
    assert.ok(opened);
    const read = yield* readSideband(yield* opened.attach());

    script.sockets[0]?.closeFromServer({ code: 1001 });
    yield* closesReported(read.closes);
    assert.deepEqual(read.closes, [{ code: 1001 }]);
    assert.equal(script.sockets.length, 2);
    assert.equal(script.sockets[1]?.closedByClient, true);
  }),
);

it.scopedLive(
  "a connection closed normally, or by the host itself, is the session's end and is not re-attached",
  () =>
    Effect.gen(function* () {
      const normal = scriptedOpenSocket([answering(createdFrame())]);
      const ended = reattaching(normal);
      const first = yield* ended.create({ sdpOffer: SDP_OFFER, input: [] });
      assert.ok(first);
      const firstRead = yield* readSideband(yield* first.attach());
      normal.sockets[0]?.closeFromServer({ code: 1000 });
      yield* pause;
      assert.deepEqual(firstRead.closes, [{ code: 1000 }]);
      assert.equal(normal.sockets.length, 1);

      const own = scriptedOpenSocket([answering(createdFrame())]);
      const hungUp = reattaching(own);
      const second = yield* hungUp.create({ sdpOffer: SDP_OFFER, input: [] });
      assert.ok(second);
      const sideband = yield* second.attach();
      const secondRead = yield* readSideband(sideband);
      yield* sideband.close;
      assert.equal(own.sockets[0]?.closedByClient, true);
      own.sockets[0]?.closeFromServer({ code: 1005 });
      yield* pause;
      assert.deepEqual(secondRead.closes, [{ code: 1005 }]);
      assert.equal(own.sockets.length, 1);
    }),
);

it.scopedLive("the introduction source carries no authorization and opens no sideband", () =>
  Effect.gen(function* () {
    const { quota: _quota, ...unmetered } = createdFrame();
    const script = scriptedOpenSocket([answering(unmetered)]);
    const source = new IntroductionLiveSessionSource({
      serviceOrigin: SERVICE_ORIGIN,
      openSocket: script.openSocket,
      now: () => NOW,
      requestTimeoutMs: 50,
    });

    const opened = yield* source.create({ sdpOffer: SDP_OFFER, input: INPUT });

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
  }),
);

it.scopedLive("the introduction source never reads a refusal as signed out", () =>
  Effect.gen(function* () {
    const refused = scriptedOpenSocket([() => ({ fault: SOCKET_OPEN_FAULT.REFUSED, status: 401 })]);
    const source = new IntroductionLiveSessionSource({
      serviceOrigin: SERVICE_ORIGIN,
      openSocket: refused.openSocket,
    });
    assert.equal(yield* source.create({ sdpOffer: SDP_OFFER, input: [] }), undefined);
    assert.equal(source.diagnostics().lastOutcome, LIVE_SESSION_OUTCOME.HTTP_ERROR);

    const metered = scriptedOpenSocket([() => ({ fault: SOCKET_OPEN_FAULT.REFUSED, status: 429 })]);
    const capped = new IntroductionLiveSessionSource({
      serviceOrigin: SERVICE_ORIGIN,
      openSocket: metered.openSocket,
    });
    assert.equal(yield* capped.create({ sdpOffer: SDP_OFFER, input: [] }), undefined);
    assert.equal(capped.diagnostics().lastOutcome, LIVE_SESSION_OUTCOME.QUOTA_EXHAUSTED);
  }),
);

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

it.scopedLive(
  "the hosted source names this installation's device on the create handshake alone, and none while no device is registered",
  () =>
    Effect.gen(function* () {
      const deviceId = "6f0b1d2e-3c4a-4b5c-8d6e-7f8091a2b3c4";
      const script = scriptedOpenSocket([answering(createdFrame()), answering(attachedFrame())]);
      let registered: string | undefined = deviceId;
      const source = reattaching(script, { deviceId: () => registered });

      const opened = yield* source.create({ sdpOffer: SDP_OFFER, input: [] });
      assert.ok(opened);
      yield* opened.attach();
      const [first] = script.sockets;
      assert.ok(first);
      first.closeFromServer({ code: 1006 });
      yield* openedSockets(script, 2);

      assert.deepEqual(script.opens[0]?.headers, {
        authorization: "Bearer token-1",
        [VOICE_SERVICE_HEADER.DEVICE_ID]: deviceId,
      });
      assert.deepEqual(script.opens[1]?.headers, { authorization: "Bearer token-1" });

      registered = undefined;
      const unregistered = scriptedOpenSocket([answering(createdFrame())]);
      assert.ok(
        yield* hosted(unregistered, { deviceId: () => registered }).create({
          sdpOffer: SDP_OFFER,
          input: [],
        }),
      );
      assert.deepEqual(unregistered.opens[0]?.headers, { authorization: "Bearer token-1" });
    }),
);

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

it.scopedLive(
  "a frame the service sends right behind session.created, before the sideband subscribes, reaches the sideband in order",
  () =>
    Effect.gen(function* () {
      const script = scriptedOpenSocket([
        answeringThenSpeaking(createdFrame(), [
          {
            type: LIVE_SERVER_EVENT.SESSION_STARTED,
            event_id: "ev_1",
            session: { id: SESSION_ID },
          },
          { type: LIVE_SERVER_EVENT.INPUT_AUDIO_MUTED, event_id: "ev_2", client_event_id: "c_1" },
        ]),
      ]);
      const source = hosted(script);
      const opened = yield* source.create({ sdpOffer: SDP_OFFER, input: [] });
      assert.ok(opened);
      const sideband = yield* opened.attach();
      // What the service spoke behind the answer is held by the socket until the sideband's own
      // reader takes it, and nothing reads it in this pause.
      yield* pause;
      const read = yield* readSideband(sideband);
      yield* pause;
      assert.deepEqual(
        read.events.map((event) => event.type),
        [LIVE_SERVER_EVENT.SESSION_STARTED, LIVE_SERVER_EVENT.INPUT_AUDIO_MUTED],
      );
    }),
);

it.scopedLive(
  "a frame the service sends right behind session.attached, before the recovering socket adopts the connection, reaches the sideband",
  () =>
    Effect.gen(function* () {
      const script = scriptedOpenSocket([
        answering(createdFrame()),
        answeringThenSpeaking(attachedFrame(), [
          { type: LIVE_SERVER_EVENT.INPUT_AUDIO_MUTED, event_id: "ev_2", client_event_id: "c_2" },
        ]),
      ]);
      const source = reattaching(script, { readAccessToken: () => Effect.succeed("token-2") });
      const opened = yield* source.create({ sdpOffer: SDP_OFFER, input: [] });
      assert.ok(opened);
      const read = yield* readSideband(yield* opened.attach());
      const [first] = script.sockets;
      assert.ok(first);
      first.closeFromServer({ code: 1006 });
      yield* openedSockets(script, 2);
      yield* pause;
      assert.deepEqual(
        read.events.map((event) => event.type),
        [LIVE_SERVER_EVENT.INPUT_AUDIO_MUTED],
      );
    }),
);

it.scopedLive(
  "a close that lands in the keyed attach's open gap reaches the sideband that subscribes after the attached flag, and the flag reads false",
  () =>
    Effect.gen(function* () {
      const { fetchLike } = openAi([created()]);
      const script = scriptedOpenSocket([
        (socket) => {
          queueMicrotask(() => socket.closeFromServer({ code: 1006 }));
          return undefined;
        },
      ]);
      const source = new KeyedLiveSessionSource({
        apiKey: "sk-test",
        httpClient: fakeHttpClientLayer(fetchLike),
        openSocket: script.openSocket,
        now: () => NOW,
      });
      const opened = yield* source.create({ sdpOffer: SDP_OFFER, input: [] });
      assert.ok(opened);
      const sideband = yield* opened.attach();
      // The close was queued behind the handshake, and the attach is an effect
      // that answers without waiting for it; this pause is the gap it lands in,
      // before the sideband's reader stands.
      yield* pause;
      const read = yield* readSideband(sideband);
      yield* pause;
      assert.deepEqual(
        read.closes.map((close) => close.code),
        [1006],
      );
      assert.equal(source.diagnostics().sidebandAttached, false);
    }),
);

it.scopedLive(
  "a normal close right behind session.created ends the recovering socket, and the sideband that subscribes afterwards is told",
  () =>
    Effect.gen(function* () {
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
      const opened = yield* source.create({ sdpOffer: SDP_OFFER, input: [] });
      assert.ok(opened);
      const sideband = yield* opened.attach();
      // The close was queued behind the answer; this pause is the recovering socket's turn on it,
      // before the sideband's reader stands.
      yield* pause;
      const read = yield* readSideband(sideband);
      yield* pause;
      assert.deepEqual(
        read.closes.map((close) => close.code),
        [1000],
      );
      assert.equal(script.sockets.length, 1);
    }),
);
