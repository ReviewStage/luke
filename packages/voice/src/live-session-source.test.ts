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
  LIVE_VOICE,
  PROACTIVE_SPEECH_KIND,
} from "@sidecar/live";
import type { ParsedJsonObject } from "@sidecar/wire/testing";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { test } from "vitest";
import {
  HOSTED_REATTACH_DELAYS_MS,
  type HostedLiveSessionOptions,
  HostedLiveSessionSource,
  IntroductionLiveSessionSource,
  unavailableLiveDiagnostics,
} from "./live-session-source.js";
import { SOCKET_OPEN_FAULT } from "./live-socket.js";
import {
  type FakeLiveSocket,
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

it.live(
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
      assert.equal(report.lastOutcome, LIVE_SESSION_OUTCOME.SUCCEEDED);
      assert.deepEqual(report.quota, QUOTA);
    }),
);

it.live(
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
      yield* settled(() => read.events.length === 2, "both events to be read");
      assert.deepEqual(
        read.events.map((event) => event.type),
        [LIVE_SERVER_EVENT.SESSION_STARTED, LIVE_SERVER_EVENT.INPUT_AUDIO_MUTED],
      );

      yield* sideband.send({ type: LIVE_CLIENT_EVENT.CLOSE, event_id: "c_2" });
      assert.equal(socket.sent.length, 2);
      socket.closeFromServer({ code: 1000 });
      yield* settled(
        () => !source.diagnostics().sidebandAttached,
        "the close to detach the sideband",
      );
      assert.equal(source.diagnostics().sidebandAttached, false);
    }),
);

it.live("the hosted source refuses to open without an access token and opens no socket", () =>
  Effect.gen(function* () {
    const script = scriptedOpenSocket([answering(createdFrame())]);
    const source = hosted(script, { readAccessToken: () => Effect.succeed(undefined) });

    assert.equal(yield* source.create({ sdpOffer: SDP_OFFER, input: [] }), undefined);
    assert.equal(script.opens.length, 0);
    assert.equal(source.diagnostics().lastOutcome, LIVE_SESSION_OUTCOME.NOT_SIGNED_IN);
  }),
);

it.live("the hosted source names a refused handshake by its status", () =>
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

it.live("the hosted source renews a refused bearer once and retries with the renewed one", () =>
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

it.live("the hosted source does not carry a renewed bearer for another account", () =>
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

it.live(
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

it.live("the hosted source treats a frame that is neither answer nor error as malformed", () =>
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

it.live(
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
  return settled(() => closes.length > 0, "the close to reach its listeners");
}

/**
 * Waits for what a real socket event lands on a reader to have landed, or
 * fails naming what it waited for: a fixed pause raced the event under load
 * and read before it arrived, so every assertion on observed frames waits on
 * the frames themselves.
 */
function settled(condition: () => boolean, waitedFor: string): Effect.Effect<void> {
  return Effect.promise(async () => {
    for (let waited = 0; !condition() && waited < 200; waited += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    assert.equal(condition(), true, `waited for ${waitedFor}`);
  });
}

function reattaching(script: ScriptedSocketSeam, options: Partial<HostedLiveSessionOptions> = {}) {
  return hosted(script, { reattachDelaysMs: [0, 0, 0], ...options });
}

it.live(
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
      yield* settled(() => second.sent.length >= 1, "the attach frame on the fresh connection");

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
      yield* settled(
        () => read.events.length === 1,
        "the event to be read on the fresh connection",
      );
      assert.deepEqual(
        read.events.map((event) => event.type),
        [LIVE_SERVER_EVENT.INPUT_AUDIO_MUTED],
      );
      yield* sideband.send({ type: LIVE_CLIENT_EVENT.CLOSE, event_id: "c_3" });
      assert.equal(second.sent.length, 2);
      assert.equal(first.sent.length, 1);
    }),
);

it.live("sends made during the gap are held and sent on the re-attached connection, in order", () =>
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
    const second = script.sockets[1];
    assert.ok(second);
    yield* settled(() => second.sent.length >= 3, "the held sends behind the attach frame");
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

it.live(
  "the hosted session's idle report is the service's own frame on the same socket, and rides whichever connection stands",
  () =>
    Effect.gen(function* () {
      const script = scriptedOpenSocket([answering(createdFrame()), answering(attachedFrame())]);
      const source = reattaching(script);
      const opened = yield* source.create({ sdpOffer: SDP_OFFER, input: [] });
      assert.ok(opened?.reportActivity);
      yield* opened.attach();
      opened.reportActivity(true);
      const [first] = script.sockets;
      assert.ok(first);
      assert.deepEqual(
        first.sent.map((data) => JSON.parse(data)),
        [
          {
            type: VOICE_SERVICE_FRAME.SESSION_CREATE,
            sdp: SDP_OFFER,
            voice: LIVE_DEFAULTS.VOICE,
            input: [],
          },
          { type: VOICE_SERVICE_FRAME.SESSION_ACTIVITY, idle: true },
        ],
      );
      first.closeFromServer({ code: 1001 });
      yield* openedSockets(script, 2);
      const second = script.sockets[1];
      assert.ok(second);
      yield* settled(() => second.sent.length >= 2, "the standing report behind the attach frame");
      // The report last made stands for the session, so the fresh connection
      // is told it first; a report made after rides the new connection as any
      // send does.
      opened.reportActivity(false);
      assert.deepEqual(
        second.sent.map((data) => JSON.parse(data)),
        [
          { type: VOICE_SERVICE_FRAME.SESSION_ATTACH, sessionId: SESSION_ID },
          { type: VOICE_SERVICE_FRAME.SESSION_ACTIVITY, idle: true },
          { type: VOICE_SERVICE_FRAME.SESSION_ACTIVITY, idle: false },
        ],
      );
    }),
);

it.live(
  "a peer that went idle before a re-attach is idle to the exchange that comes after it: the standing report is told to the fresh connection, and one that never reported is told nothing",
  () =>
    Effect.gen(function* () {
      const script = scriptedOpenSocket([
        answering(createdFrame()),
        answering(attachedFrame()),
        answering(attachedFrame()),
      ]);
      const source = reattaching(script);
      const opened = yield* source.create({ sdpOffer: SDP_OFFER, input: [] });
      assert.ok(opened?.reportActivity);
      const sideband = yield* opened.attach();
      // No report yet: a recycled connection is told nothing it was not told.
      // Absence is read as order: a send made in the gap is flushed behind the
      // standing frames once the fresh connection is adopted, so a standing
      // report would stand between the attach frame and the probe.
      script.sockets[0]?.closeFromServer({ code: 1001 });
      yield* openedSockets(script, 2);
      yield* sideband.send({ type: LIVE_CLIENT_EVENT.INPUT_AUDIO_MUTE, event_id: "probe" });
      yield* settled(
        () => (script.sockets[1]?.sent.length ?? 0) >= 2,
        "the probe behind the attach frame on the second connection",
      );
      assert.deepEqual(
        script.sockets[1]?.sent.map((data) => JSON.parse(data).type),
        [VOICE_SERVICE_FRAME.SESSION_ATTACH, LIVE_CLIENT_EVENT.INPUT_AUDIO_MUTE],
      );
      opened.reportActivity(true);
      script.sockets[1]?.closeFromServer({ code: 1001 });
      yield* openedSockets(script, 3);
      yield* settled(
        () => (script.sockets[2]?.sent.length ?? 0) >= 2,
        "the standing report behind the attach frame on the third connection",
      );
      assert.deepEqual(
        script.sockets[2]?.sent.map((data) => JSON.parse(data)),
        [
          { type: VOICE_SERVICE_FRAME.SESSION_ATTACH, sessionId: SESSION_ID },
          { type: VOICE_SERVICE_FRAME.SESSION_ACTIVITY, idle: true },
        ],
      );
    }),
);

it.live(
  "idle reports made during a gap are not replayed behind the standing one: a peer heard again before the fresh connection stood is told as heard, never as idle",
  () =>
    Effect.gen(function* () {
      let held: FakeLiveSocket | undefined;
      const script = scriptedOpenSocket([
        answering(createdFrame()),
        (socket) => {
          // The second connection is not answered until the test says so, so the gap is held open.
          held = socket;
          return undefined;
        },
      ]);
      const source = reattaching(script);
      const opened = yield* source.create({ sdpOffer: SDP_OFFER, input: [] });
      assert.ok(opened?.reportActivity);
      const sideband = yield* opened.attach();
      script.sockets[0]?.closeFromServer({ code: 1001 });
      yield* openedSockets(script, 2);
      // During the gap the peer goes idle, then is heard again, and hangs up nothing.
      opened.reportActivity(true);
      opened.reportActivity(false);
      yield* sideband.send({ type: LIVE_CLIENT_EVENT.INPUT_AUDIO_MUTE, event_id: "c_1" });
      assert.ok(held);
      held.receive(attachedFrame());
      yield* settled(
        () => (held?.sent.length ?? 0) >= 3,
        "the standing report and the held send behind the attach frame",
      );
      // The standing report says heard, once; the stale idle never reaches the fresh exchange, and the other held send does.
      assert.deepEqual(
        held.sent.map((data) => JSON.parse(data)),
        [
          { type: VOICE_SERVICE_FRAME.SESSION_ATTACH, sessionId: SESSION_ID },
          { type: VOICE_SERVICE_FRAME.SESSION_ACTIVITY, idle: false },
          { type: LIVE_CLIENT_EVENT.INPUT_AUDIO_MUTE, event_id: "c_1" },
        ],
      );
    }),
);

it.live(
  "the hosted session's stop is the service's own frame on the same socket, held through a gap and sent on the connection that comes after it",
  () =>
    Effect.gen(function* () {
      const script = scriptedOpenSocket([answering(createdFrame()), answering(attachedFrame())]);
      const source = reattaching(script);
      const opened = yield* source.create({ sdpOffer: SDP_OFFER, input: [] });
      assert.ok(opened?.stopSpeaking);
      yield* opened.attach();
      opened.stopSpeaking();
      const [first] = script.sockets;
      assert.ok(first);
      assert.deepEqual(
        first.sent.map((data) => JSON.parse(data)),
        [
          {
            type: VOICE_SERVICE_FRAME.SESSION_CREATE,
            sdp: SDP_OFFER,
            voice: LIVE_DEFAULTS.VOICE,
            input: [],
          },
          { type: VOICE_SERVICE_FRAME.SESSION_STOP },
        ],
      );
      first.closeFromServer({ code: 1001 });
      // The gap begins where the socket's own reader takes that close, which is the turn after it.
      yield* pause;
      // Pressed in the gap: the model is still speaking across the service's recycle, so the stop is still meant.
      opened.stopSpeaking();
      yield* openedSockets(script, 2);
      const second = script.sockets[1];
      assert.ok(second);
      yield* settled(() => second.sent.length >= 2, "the held stop behind the attach frame");
      assert.deepEqual(
        second.sent.map((data) => JSON.parse(data)),
        [
          { type: VOICE_SERVICE_FRAME.SESSION_ATTACH, sessionId: SESSION_ID },
          { type: VOICE_SERVICE_FRAME.SESSION_STOP },
        ],
      );
    }),
);

it.live(
  "a beat rides the socket as the service's own frame, and the service's spoken word is taken off the socket for the listener before the sideband reads it",
  () =>
    Effect.gen(function* () {
      const script = scriptedOpenSocket([answering(createdFrame())]);
      const source = reattaching(script);
      const opened = yield* source.create({ sdpOffer: SDP_OFFER, input: [] });
      assert.ok(opened?.speakBeat && opened.onSpoken);
      const heard: string[] = [];
      opened.onSpoken((kind) => heard.push(kind));
      const reading = yield* readSideband(yield* opened.attach());
      const beat = {
        type: VOICE_SERVICE_FRAME.SESSION_BEAT,
        kind: PROACTIVE_SPEECH_KIND.LAUNCH,
        firstName: "Ada",
      } as const;
      opened.speakBeat(beat);
      const [first] = script.sockets;
      assert.ok(first);
      assert.deepEqual(
        first.sent.map((data) => JSON.parse(data)),
        [
          {
            type: VOICE_SERVICE_FRAME.SESSION_CREATE,
            sdp: SDP_OFFER,
            voice: LIVE_DEFAULTS.VOICE,
            input: [],
          },
          beat,
        ],
      );
      first.receive({
        type: VOICE_SERVICE_FRAME.SESSION_SPOKEN,
        kind: PROACTIVE_SPEECH_KIND.LAUNCH,
      });
      first.receive({
        type: LIVE_SERVER_EVENT.SESSION_STARTED,
        event_id: "e1",
        session: { id: SESSION_ID },
      });
      // A frame that only mentions the type inside a value is a session's own and reads as one.
      first.receive({
        type: LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA,
        event_id: "e2",
        delta: "session.spoken",
        start_ms: 0,
        end_ms: 10,
      });
      yield* settled(
        () => heard.length === 1 && reading.events.length === 2,
        "the spoken word and the two session events to land",
      );
      assert.deepEqual(heard, [PROACTIVE_SPEECH_KIND.LAUNCH]);
      assert.deepEqual(
        reading.events.map((event) => event.type),
        [LIVE_SERVER_EVENT.SESSION_STARTED, LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA],
      );
    }),
);

it.live("re-attaching tries as many times as it has delays and then reports the loss", () =>
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

it.effect("reattaches on HOSTED_REATTACH_DELAYS_MS's own cadence, then gives up", () =>
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

it.effect("closing while an attach attempt waits for its answer closes the socket it opened", () =>
  Effect.gen(function* () {
    const script = scriptedOpenSocket([answering(createdFrame()), () => undefined]);
    const source = reattaching(script, { reattachDelaysMs: HOSTED_REATTACH_DELAYS_MS });
    const opened = yield* source.create({ sdpOffer: SDP_OFFER, input: [] });
    assert.ok(opened);
    const sideband = yield* opened.attach();

    script.sockets[0]?.closeFromServer({ code: 1006 });
    yield* openedSockets(script, 2);
    yield* sideband.close;
    yield* settled(
      () => script.sockets[1]?.closedByClient === true,
      "the close to reach the attempt",
    );

    assert.equal(script.sockets.length, 2);
    assert.equal(script.sockets[1]?.closedByClient, true);
  }),
);

it.effect("closing while a reattach wait stands interrupts it, opening no further attempt", () =>
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

it.live("a service that refuses the attachment ends the tries at once", () =>
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

it.live(
  "a connection closed normally, or by the host itself, is the session's end and is not re-attached",
  () =>
    Effect.gen(function* () {
      const normal = scriptedOpenSocket([answering(createdFrame())]);
      const ended = reattaching(normal);
      const first = yield* ended.create({ sdpOffer: SDP_OFFER, input: [] });
      assert.ok(first);
      const firstRead = yield* readSideband(yield* first.attach());
      normal.sockets[0]?.closeFromServer({ code: 1000 });
      yield* closesReported(firstRead.closes);
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
      yield* closesReported(secondRead.closes);
      assert.deepEqual(secondRead.closes, [{ code: 1005 }]);
      assert.equal(own.sockets.length, 1);
    }),
);

it.live("the introduction source carries no authorization and opens no sideband", () =>
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

it.live("the introduction source never reads a refusal as signed out", () =>
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

test("unavailable diagnostics name the fixture run apart from the missing account", () => {
  assert.equal(
    unavailableLiveDiagnostics({ fixtureMode: true }).lastOutcome,
    LIVE_SESSION_OUTCOME.DISABLED_BY_FIXTURE,
  );
  const missing = unavailableLiveDiagnostics({ fixtureMode: false });
  assert.equal(missing.lastOutcome, LIVE_SESSION_OUTCOME.NO_ACCOUNT);
  assert.equal(missing.sidebandAttached, false);
  assert.equal(missing.voice, LIVE_DEFAULTS.VOICE);
});

it.live(
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

it.live(
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
      yield* settled(
        () => read.events.length === 2,
        "the held frames to be read by the sideband's reader",
      );
      assert.deepEqual(
        read.events.map((event) => event.type),
        [LIVE_SERVER_EVENT.SESSION_STARTED, LIVE_SERVER_EVENT.INPUT_AUDIO_MUTED],
      );
    }),
);

it.live(
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
      yield* settled(
        () => read.events.length === 1,
        "the frame behind session.attached to be read",
      );
      assert.deepEqual(
        read.events.map((event) => event.type),
        [LIVE_SERVER_EVENT.INPUT_AUDIO_MUTED],
      );
    }),
);

it.live(
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
