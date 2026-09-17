import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { it } from "@effect/vitest";
import { arrival } from "@sidecar/voice/testing";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { onTestFinished } from "vitest";
import { type RawData, type WebSocket, WebSocketServer } from "ws";
import {
  LIVE_SCENE,
  LIVE_SERVER_EVENT,
  LIVE_SESSION_OUTCOME,
  LIVE_SESSION_START,
  LIVE_SESSIONS_PATH,
  livePrimarySessionConfig,
  liveStartRequest,
} from "../server/live";
import { createLiveUpstream } from "../server/voice/openai";
import { textFrame } from "./support/voice-fakes";

/**
 * The primary-socket door against an OpenAI on this machine: the session
 * document sent as the socket's first message, the id read off
 * `session.started`, and what the door does with every other way that
 * exchange can end. One case writes both of its frames in a single write to
 * the raw socket, which is the only way to put a second frame in the chunk the
 * handshake's own flush carries. Every wait here stands on an event the fake
 * announces — `ws` delivers frames on IO ticks a fiber yield would not wait
 * for — and the one deadline under test runs on Effect's Clock, which the
 * test advances once the frame that starts it has arrived.
 */

const LOOPBACK = "127.0.0.1";
const API_KEY = "sk-test-primary";
const SESSION_ID = "live_primary_1";
const PRIMARY_PATH = `/v1${LIVE_SESSIONS_PATH}`;

/** What the far end answers the door's `session.start` with. */
const ANSWER = {
  STARTED: "started",
  /** `session.started` and an `info` event in one write, so both reach the door in one chunk. */
  STARTED_BESIDE_INFO: "started-beside-info",
  /** An `info` event written into the handshake's own chunk, before the door has sent anything. */
  INFO_IN_HANDSHAKE: "info-in-handshake",
  ERROR: "error",
  SILENCE: "silence",
} as const;

type Answer = (typeof ANSWER)[keyof typeof ANSWER];

/** What `ws` itself writes on an upgrade; a header beside these is the door's own. */
const PROTOCOL_HEADERS: ReadonlySet<string> = new Set([
  "host",
  "connection",
  "upgrade",
  "sec-websocket-key",
  "sec-websocket-version",
  "sec-websocket-extensions",
]);

/** Tells whoever is waiting that the fake moved, so a wait stands on the event rather than on time. */
function notifier() {
  const listeners = new Set<() => void>();
  return {
    notify: (): void => {
      for (const listener of [...listeners]) listener();
    },
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function startedEvent(): string {
  return JSON.stringify({
    type: LIVE_SERVER_EVENT.SESSION_STARTED,
    event_id: "ev_started",
    session: { id: SESSION_ID },
  });
}

function infoEvent(): string {
  return JSON.stringify({ type: LIVE_SERVER_EVENT.INFO, event_id: "ev_info", code: "noted" });
}

function transcriptDelta(): string {
  return JSON.stringify({
    type: LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA,
    event_id: "ev_delta",
    delta: "Hello",
    start_ms: 0,
    end_ms: 1,
  });
}

function errorEvent(): string {
  return JSON.stringify({
    type: LIVE_SERVER_EVENT.ERROR,
    event_id: "ev_error",
    error: { code: "refused" },
  });
}

interface FakePrimary {
  baseUrl: string;
  /** The path every upgrade arrived on, in order. */
  paths: string[];
  /** The authorization header every upgrade presented, in order. */
  authorizations: (string | undefined)[];
  /** The headers the last upgrade carried beyond the protocol's own, sorted. */
  ownHeaders: string[];
  /** Every text frame the door sent, in order. */
  received: string[];
  /** How many of the door's sockets the far end has seen close. */
  closes: number;
  /** Hears every move of the fake: a frame received, a socket closed. */
  onMove(listener: () => void): () => void;
  /** What the next `session.start` is answered with. */
  answer: Answer;
  /** The status an upgrade is refused with, where one is; a socket otherwise. */
  refuseStatus: number | undefined;
  /** The far end of the door's socket, once it stands. */
  far(): Promise<WebSocket>;
  close(): Promise<void>;
}

async function startFakePrimary(): Promise<FakePrimary> {
  const waiting: Array<(far: WebSocket) => void> = [];
  let standing: WebSocket | undefined;
  const moved = notifier();
  const fake: FakePrimary = {
    onMove: moved.subscribe,
    baseUrl: "",
    paths: [],
    authorizations: [],
    ownHeaders: [],
    received: [],
    closes: 0,
    answer: ANSWER.STARTED,
    refuseStatus: undefined,
    far: () =>
      new Promise((resolve) => {
        if (standing) resolve(standing);
        else waiting.push(resolve);
      }),
    close: async () => {
      for (const socket of sockets.clients) socket.terminate();
      sockets.close();
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    },
  };
  const sockets = new WebSocketServer({ noServer: true });
  const server = http.createServer((_request, response) => {
    response.writeHead(404).end();
  });
  server.on("upgrade", (request, raw, head) => {
    fake.paths.push(request.url ?? "");
    fake.authorizations.push(request.headers.authorization);
    fake.ownHeaders = Object.keys(request.headers)
      .filter((name) => !PROTOCOL_HEADERS.has(name))
      .sort();
    if (request.url !== PRIMARY_PATH || fake.refuseStatus !== undefined) {
      raw.end(`HTTP/1.1 ${fake.refuseStatus ?? 404} Refused\r\nConnection: close\r\n\r\n`);
      return;
    }
    // Corked across the upgrade, so the answer `ws` writes and the frame
    // written behind it leave as one chunk: that is the whole of the window a
    // consumer attached after the handshake loses a frame in.
    if (fake.answer === ANSWER.INFO_IN_HANDSHAKE) raw.cork();
    sockets.handleUpgrade(request, raw, head, (far) => {
      standing = far;
      for (const waiter of waiting.splice(0)) waiter(far);
      if (fake.answer === ANSWER.INFO_IN_HANDSHAKE) {
        raw.write(textFrame(infoEvent()));
        raw.uncork();
      }
      far.on("close", () => {
        fake.closes += 1;
        moved.notify();
      });
      far.on("message", (data: RawData) => {
        fake.received.push(data.toString());
        moved.notify();
        switch (fake.answer) {
          case ANSWER.STARTED:
            far.send(startedEvent());
            return;
          case ANSWER.STARTED_BESIDE_INFO:
            // Written to the socket under `ws` rather than through it: two
            // `send` calls are two writes, and the invariant under test is a
            // second frame inside the chunk the first one arrives in.
            raw.write(Buffer.concat([textFrame(startedEvent()), textFrame(infoEvent())]));
            return;
          case ANSWER.INFO_IN_HANDSHAKE:
            far.send(startedEvent());
            return;
          case ANSWER.ERROR:
            far.send(errorEvent());
            return;
          default:
            return;
        }
      });
    });
  });
  server.listen(0, LOOPBACK);
  await once(server, "listening");
  // SAFETY: a listening TCP server answers its bound address as AddressInfo, never a pipe path.
  const { port } = server.address() as AddressInfo;
  fake.baseUrl = `http://${LOOPBACK}:${port}/v1`;
  return fake;
}

function upstreamAt(fake: FakePrimary, primaryTimeoutMs?: number) {
  return createLiveUpstream({
    apiKey: API_KEY,
    baseUrl: fake.baseUrl,
    ...(primaryTimeoutMs === undefined ? undefined : { primaryTimeoutMs }),
  });
}

/** The deadline the silence case ends at, moved by the test's own clock. */
const PRIMARY_TIMEOUT_MS = 30;

const CONFIG = livePrimarySessionConfig({ scene: LIVE_SCENE.DESKTOP });

it.effect("a primary socket starts its session and answers the id `session.started` carried", () =>
  Effect.gen(function* () {
    const fake = yield* Effect.promise(() => startFakePrimary());
    onTestFinished(() => fake.close());

    const opened = yield* upstreamAt(fake).openPrimary(CONFIG);

    assert.ok(opened.outcome === LIVE_SESSION_OUTCOME.SUCCEEDED);
    assert.equal(opened.session.sessionId, SESSION_ID);
    assert.deepEqual(opened.session.held, []);
    // Paused as `attach` answers one: the caller's consumers stand, then resume.
    assert.equal(opened.session.socket.isPaused, true);
    assert.deepEqual(fake.paths, [PRIMARY_PATH]);
    assert.deepEqual(fake.authorizations, [`Bearer ${API_KEY}`]);
    assert.deepEqual(fake.ownHeaders, ["authorization"]);
    assert.deepEqual(
      fake.received.map((frame) => JSON.parse(frame)),
      [{ type: LIVE_SESSION_START, session: CONFIG }],
    );
  }),
);

it.effect("a frame written into the handshake's own chunk is held rather than lost", () =>
  Effect.gen(function* () {
    const fake = yield* Effect.promise(() => startFakePrimary());
    onTestFinished(() => fake.close());
    fake.answer = ANSWER.INFO_IN_HANDSHAKE;

    const opened = yield* upstreamAt(fake).openPrimary(CONFIG);

    // Spoken while the socket was paused inside its own open handler, which is
    // what keeps a frame from being flushed to nobody before the door reads.
    assert.ok(opened.outcome === LIVE_SESSION_OUTCOME.SUCCEEDED);
    assert.equal(opened.session.sessionId, SESSION_ID);
    assert.deepEqual(
      [...opened.session.held].map((frame) => JSON.parse(frame)),
      [JSON.parse(infoEvent())],
    );
  }),
);

it.effect("a refused handshake is an outcome name and a status", () =>
  Effect.gen(function* () {
    const fake = yield* Effect.promise(() => startFakePrimary());
    onTestFinished(() => fake.close());
    fake.refuseStatus = 401;

    const opened = yield* upstreamAt(fake).openPrimary(CONFIG);

    assert.deepEqual(opened, { outcome: LIVE_SESSION_OUTCOME.HTTP_ERROR, status: 401 });
    assert.deepEqual(fake.received, []);
  }),
);

it.effect("a session that never starts ends at the wait, leaving no socket standing", () =>
  Effect.gen(function* () {
    const fake = yield* Effect.promise(() => startFakePrimary());
    onTestFinished(() => fake.close());
    fake.answer = ANSWER.SILENCE;

    // The wait the door ends at runs on Effect's Clock: it is started by the
    // start frame arriving at a far end that answers nothing, so the clock
    // moves past it only once the fake has that frame.
    const opening = yield* Effect.forkScoped(
      upstreamAt(fake, PRIMARY_TIMEOUT_MS).openPrimary(CONFIG),
    );
    yield* arrival(fake.onMove, () => fake.received.length === 1, "the start frame sent");
    yield* TestClock.adjust(`${PRIMARY_TIMEOUT_MS} millis`);
    const opened = yield* Fiber.join(opening);

    assert.deepEqual(opened, {
      outcome: LIVE_SESSION_OUTCOME.NETWORK_ERROR,
      errorName: "TimeoutError",
    });
    assert.deepEqual(fake.received, [JSON.stringify(liveStartRequest(CONFIG))]);
    yield* arrival(fake.onMove, () => fake.closes === 1, "the door's socket closed");
    assert.equal(fake.closes, 1);
  }),
);

it.effect("an error in place of a started session is refused, and the socket goes with it", () =>
  Effect.gen(function* () {
    const fake = yield* Effect.promise(() => startFakePrimary());
    onTestFinished(() => fake.close());
    fake.answer = ANSWER.ERROR;

    const opened = yield* upstreamAt(fake).openPrimary(CONFIG);

    assert.deepEqual(opened, { outcome: LIVE_SESSION_OUTCOME.MALFORMED_RESPONSE });
    yield* arrival(fake.onMove, () => fake.closes === 1, "the door's socket closed");
    assert.equal(fake.closes, 1);
  }),
);

it.effect("a frame beside `session.started` in one chunk is held rather than lost", () =>
  Effect.gen(function* () {
    const fake = yield* Effect.promise(() => startFakePrimary());
    onTestFinished(() => fake.close());
    fake.answer = ANSWER.STARTED_BESIDE_INFO;

    const opened = yield* upstreamAt(fake).openPrimary(CONFIG);

    assert.ok(opened.outcome === LIVE_SESSION_OUTCOME.SUCCEEDED);
    assert.equal(opened.session.sessionId, SESSION_ID);
    // The `info` event rode in with `session.started`, which the door had to
    // resume the socket to read: held rather than emitted to nobody.
    assert.deepEqual(
      [...opened.session.held].map((frame) => JSON.parse(frame)),
      [JSON.parse(infoEvent())],
    );
    assert.equal(opened.session.socket.isPaused, true);
  }),
);

it.effect("what the session says after the handshake is the caller's to read once it resumes", () =>
  Effect.gen(function* () {
    const fake = yield* Effect.promise(() => startFakePrimary());
    onTestFinished(() => fake.close());
    fake.answer = ANSWER.STARTED_BESIDE_INFO;

    const opened = yield* upstreamAt(fake).openPrimary(CONFIG);
    assert.ok(opened.outcome === LIVE_SESSION_OUTCOME.SUCCEEDED);
    const socket = opened.session.socket;

    // What a consumer of the caller's reads: the frames it is handed, then
    // everything the socket carries from the resume on, each exactly once.
    const read: string[] = [...opened.session.held];
    yield* Effect.sync(() => {
      socket.on("message", (data: RawData) => read.push(data.toString()));
      socket.resume();
    });
    const far = yield* Effect.promise(() => fake.far());
    const readTwice = notifier();
    yield* Effect.sync(() => {
      socket.on("message", () => readTwice.notify());
      far.send(transcriptDelta());
    });
    yield* arrival(readTwice.subscribe, () => read.length >= 2, "the delta read off the socket");

    assert.deepEqual(
      read.map((frame) => JSON.parse(frame)),
      [JSON.parse(infoEvent()), JSON.parse(transcriptDelta())],
    );
  }),
);
