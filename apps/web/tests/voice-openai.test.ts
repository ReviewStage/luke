import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { it } from "@effect/vitest";
import { Effect } from "effect";
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
 * handshake's own flush carries.
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
  const fake: FakePrimary = {
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
      });
      far.on("message", (data: RawData) => {
        fake.received.push(data.toString());
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

/** Gives the fibers and the sockets their turns, so what the far side said has been read. */
const pause = Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 5)));

function upstreamAt(fake: FakePrimary, primaryTimeoutMs?: number) {
  return createLiveUpstream({
    apiKey: API_KEY,
    baseUrl: fake.baseUrl,
    ...(primaryTimeoutMs === undefined ? undefined : { primaryTimeoutMs }),
  });
}

const CONFIG = livePrimarySessionConfig({ scene: LIVE_SCENE.DESKTOP });

it.live("a primary socket starts its session and answers the id `session.started` carried", () =>
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

it.live("a frame written into the handshake's own chunk is held rather than lost", () =>
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

it.live("a refused handshake is an outcome name and a status", () =>
  Effect.gen(function* () {
    const fake = yield* Effect.promise(() => startFakePrimary());
    onTestFinished(() => fake.close());
    fake.refuseStatus = 401;

    const opened = yield* upstreamAt(fake).openPrimary(CONFIG);

    assert.deepEqual(opened, { outcome: LIVE_SESSION_OUTCOME.HTTP_ERROR, status: 401 });
    assert.deepEqual(fake.received, []);
  }),
);

it.live("a session that never starts ends at the wait, leaving no socket standing", () =>
  Effect.gen(function* () {
    const fake = yield* Effect.promise(() => startFakePrimary());
    onTestFinished(() => fake.close());
    fake.answer = ANSWER.SILENCE;

    const opened = yield* upstreamAt(fake, 30).openPrimary(CONFIG);

    assert.deepEqual(opened, {
      outcome: LIVE_SESSION_OUTCOME.NETWORK_ERROR,
      errorName: "TimeoutError",
    });
    assert.deepEqual(fake.received, [JSON.stringify(liveStartRequest(CONFIG))]);
    while (fake.closes === 0) yield* pause;
    assert.equal(fake.closes, 1);
  }),
);

it.live("an error in place of a started session is refused, and the socket goes with it", () =>
  Effect.gen(function* () {
    const fake = yield* Effect.promise(() => startFakePrimary());
    onTestFinished(() => fake.close());
    fake.answer = ANSWER.ERROR;

    const opened = yield* upstreamAt(fake).openPrimary(CONFIG);

    assert.deepEqual(opened, { outcome: LIVE_SESSION_OUTCOME.MALFORMED_RESPONSE });
    while (fake.closes === 0) yield* pause;
    assert.equal(fake.closes, 1);
  }),
);

it.live("a frame beside `session.started` in one chunk is held rather than lost", () =>
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

it.live("what the session says after the handshake is the caller's to read once it resumes", () =>
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
    yield* Effect.sync(() => far.send(transcriptDelta()));
    while (read.length < 2) yield* pause;

    assert.deepEqual(
      read.map((frame) => JSON.parse(frame)),
      [JSON.parse(infoEvent()), JSON.parse(transcriptDelta())],
    );
  }),
);
