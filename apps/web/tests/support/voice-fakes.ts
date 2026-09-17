import { randomUUID } from "node:crypto";
import http, { type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import type { DevicePlatform } from "@sidecar/hosted";
import { isRecord, unparsedWire, type WireRecord } from "@sidecar/wire";
import { Effect, Option } from "effect";
import { type RawData, WebSocket, WebSocketServer } from "ws";
import type { VoiceCloseReason } from "../../server/db/voice-vocabulary";
import type { HostedSpend, IntroductionSpend } from "../../server/hosted/quota";
import { VOICE_SECONDS_OUTCOME } from "../../server/hosted/quota";
import {
  LIVE_SERVER_EVENT,
  LIVE_SESSION_START,
  LIVE_SESSIONS_PATH,
  LIVE_TRANSPORT_TYPE,
} from "../../server/live";
import type { VoiceAccounts } from "../../server/voice/accounts";
import type { VoiceSessionRecord } from "../../server/voice/session-record";

/**
 * What the voice service talks to, stood up for a test: an OpenAI on this
 * machine that creates sessions, takes attaches, and starts a session on a
 * primary socket, handing the test the far end of every socket so it can play
 * OpenAI's part, and an in-memory account side that remembers what it was
 * asked and answers what the test told it to.
 */

const LOOPBACK = "127.0.0.1";
const HTTP_CREATED = 201;

export const FAKE_SDP_ANSWER =
  "v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const parts: Buffer[] = [];
    request.on("data", (part: Buffer) => parts.push(part));
    request.on("end", () => resolve(Buffer.concat(parts).toString("utf8")));
  });
}

function jsonRecord(text: string): WireRecord {
  const parsed = unparsedWire(JSON.parse(text));
  if (!isRecord(parsed)) throw new Error("A fake was sent a body that is not a record");
  return parsed;
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, LOOPBACK, () => {
      // SAFETY: a listening TCP server answers an AddressInfo, never a pipe path.
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
}

interface RecordedCreate {
  authorization: string | undefined;
  body: WireRecord;
}

interface RecordedAttach {
  sessionId: string;
  authorization: string | undefined;
  /** OpenAI's end of the sideband: what the test sends here, the service receives. */
  socket: WebSocket;
}

interface RecordedPrimary {
  authorization: string | undefined;
  /** The `session.start` the service sent as the socket's first message. */
  start: WireRecord;
  /** The id the fake answered `session.started` with. */
  sessionId: string;
  /** OpenAI's end of the primary socket: what the test sends here, the service receives; what the service forwards, the test reads here. */
  socket: WebSocket;
}

export interface FakeOpenAi {
  baseUrl: string;
  creates: RecordedCreate[];
  attaches: RecordedAttach[];
  /** Every primary socket the service started a session on, in order, once each was started. */
  primaries: RecordedPrimary[];
  /** The status the next create answers with; 201 unless a test says otherwise. */
  createStatus: number;
  /** The status the next primary upgrade is refused with, where one is; a socket otherwise. */
  primaryStatus: number | undefined;
  /**
   * Text frames written into the same chunk as `session.started`, behind it,
   * so they reach the door in the one tick that event does; none by default.
   */
  startedBeside: string[];
  /** Text frames sent as their own writes the instant that chunk has gone, so they arrive while the door still holds the socket paused; none by default. */
  startedThen: string[];
  /** Resolves with the next attach the service opens, or the one already waiting. */
  nextAttach(): Promise<RecordedAttach>;
  /** Resolves with the next primary socket the service started a session on, or the one already waiting. */
  nextPrimary(): Promise<RecordedPrimary>;
  close(): Promise<void>;
}

const ATTACH_PATH = new RegExp(`^/v1${LIVE_SESSIONS_PATH}/([^/]+)/attach$`);
const PRIMARY_PATH = `/v1${LIVE_SESSIONS_PATH}`;

/** One unmasked text frame as a server writes it, for a payload under the two-byte length. */
const TEXT_FRAME = {
  FIN_TEXT: 0x81,
  ONE_BYTE_LENGTH_MAX: 125,
  TWO_BYTE_LENGTH: 126,
  TWO_BYTE_LENGTH_MAX: 65_535,
} as const;

/**
 * One text frame written to the raw socket under `ws`, the way a fake OpenAI
 * puts a second frame in the chunk the first one arrives in: two `send` calls
 * are two writes, and a frame beside another in one write is what a door's
 * held frames are.
 */
export function textFrame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  if (payload.byteLength > TEXT_FRAME.TWO_BYTE_LENGTH_MAX) {
    throw new Error("A framed fake payload must fit a two-byte length");
  }
  const header =
    payload.byteLength <= TEXT_FRAME.ONE_BYTE_LENGTH_MAX
      ? Buffer.from([TEXT_FRAME.FIN_TEXT, payload.byteLength])
      : Buffer.from([
          TEXT_FRAME.FIN_TEXT,
          TEXT_FRAME.TWO_BYTE_LENGTH,
          payload.byteLength >> 8,
          payload.byteLength & 0xff,
        ]);
  return Buffer.concat([header, payload]);
}

/** A waiting line: the values that arrived with nobody asking, and the askers that arrived with nothing waiting. */
function waitingLine<Value>() {
  const unclaimed: Value[] = [];
  const waiting: Array<(value: Value) => void> = [];
  return {
    next: () =>
      new Promise<Value>((resolve) => {
        const ready = unclaimed.shift();
        if (ready) resolve(ready);
        else waiting.push(resolve);
      }),
    arrived: (value: Value) => {
      const waiter = waiting.shift();
      if (waiter) waiter(value);
      else unclaimed.push(value);
    },
  };
}

export async function startFakeOpenAi(): Promise<FakeOpenAi> {
  const creates: RecordedCreate[] = [];
  const attaches: RecordedAttach[] = [];
  const primaries: RecordedPrimary[] = [];
  const attachLine = waitingLine<RecordedAttach>();
  const primaryLine = waitingLine<RecordedPrimary>();
  let sessions = 0;
  const fake: FakeOpenAi = {
    baseUrl: "",
    creates,
    attaches,
    primaries,
    createStatus: HTTP_CREATED,
    primaryStatus: undefined,
    startedBeside: [],
    startedThen: [],
    nextAttach: attachLine.next,
    nextPrimary: primaryLine.next,
    close: async () => {
      for (const attach of attaches) attach.socket.terminate();
      for (const primary of primaries) primary.socket.terminate();
      sockets.close();
      await closeServer(server);
    },
  };
  const sockets = new WebSocketServer({ noServer: true });
  const server = http.createServer(async (request, response) => {
    if (request.method === "POST" && request.url === `/v1${LIVE_SESSIONS_PATH}`) {
      const body = jsonRecord(await readBody(request));
      creates.push({ authorization: request.headers.authorization, body });
      sessions += 1;
      if (fake.createStatus !== HTTP_CREATED) {
        response.writeHead(fake.createStatus).end(JSON.stringify({ error: "refused" }));
        return;
      }
      response.writeHead(HTTP_CREATED, { "content-type": "application/json" }).end(
        JSON.stringify({
          // Unique across every fake this process starts: a counter restarting per fake gave two tests'
          // sessions one id, and the real session record keeps the first row an id names.
          session: { id: `live_test_${sessions}_${randomUUID()}` },
          transport: { type: LIVE_TRANSPORT_TYPE, sdp: FAKE_SDP_ANSWER },
        }),
      );
      return;
    }
    response.writeHead(404).end();
  });
  server.on("upgrade", (request, socket, head) => {
    if (request.url === PRIMARY_PATH) {
      if (fake.primaryStatus !== undefined) {
        socket.end(`HTTP/1.1 ${fake.primaryStatus} Refused\r\nConnection: close\r\n\r\n`);
        return;
      }
      sockets.handleUpgrade(request, socket, head, (webSocket) => {
        // The session starts on the socket's first message and on nothing
        // else: `session.started` goes back, with whatever the test asked to
        // ride in the same chunk written behind it to the raw socket, since
        // two `send` calls are two writes and the door's held frames are
        // what arrives inside the one write.
        webSocket.once("message", (data: RawData) => {
          const start = jsonRecord(data.toString());
          if (start.type !== LIVE_SESSION_START) {
            webSocket.terminate();
            return;
          }
          sessions += 1;
          const sessionId = `live_primary_${sessions}_${randomUUID()}`;
          const started = JSON.stringify({
            type: LIVE_SERVER_EVENT.SESSION_STARTED,
            event_id: `started_${sessions}`,
            session: { id: sessionId },
          });
          socket.write(Buffer.concat([started, ...fake.startedBeside].map(textFrame)));
          for (const frame of fake.startedThen) webSocket.send(frame);
          const primary: RecordedPrimary = {
            authorization: request.headers.authorization,
            start,
            sessionId,
            socket: webSocket,
          };
          primaries.push(primary);
          primaryLine.arrived(primary);
        });
      });
      return;
    }
    const match = ATTACH_PATH.exec(request.url ?? "");
    if (!match?.[1]) {
      socket.destroy();
      return;
    }
    const sessionId = decodeURIComponent(match[1]);
    sockets.handleUpgrade(request, socket, head, (webSocket) => {
      const attach: RecordedAttach = {
        sessionId,
        authorization: request.headers.authorization,
        socket: webSocket,
      };
      attaches.push(attach);
      attachLine.arrived(attach);
    });
  });
  const port = await listen(server);
  fake.baseUrl = `http://${LOOPBACK}:${port}/v1`;
  return fake;
}

export const FAKE_QUOTA = { used: 3, limit: 5000, resetsAt: 1_800_000_000_000 };
export const FAKE_USER_ID = "user-1";
export const FAKE_BEARER = "Bearer account-token-1";

interface RecordedSeconds {
  userId: string;
  sessionId: string;
  seconds: number;
}

export interface FakeAccounts extends VoiceAccounts {
  /** Every bearer resolved, in order, whatever it resolved to. */
  resolved: string[];
  /** Every account whose allowance was spent, in order. */
  spent: string[];
  /** Every seconds report taken, repeated ones included. */
  reports: RecordedSeconds[];
  /** What the next spend answers; open by default. */
  spendAnswer: HostedSpend;
  /** What the next introduction spend answers; open by default. */
  introductionAnswer: IntroductionSpend;
  /** How many introductions were spent, refused ones included. */
  introductions: number;
  /** The one bearer that resolves to `FAKE_USER_ID`; every other resolves to nobody. */
  knownBearer: string;
}

/** An account side that behaves as the ledger does: seconds landing once per session. */
export function fakeAccounts(): FakeAccounts {
  const landed = new Set<string>();
  const fake: FakeAccounts = {
    resolved: [],
    spent: [],
    reports: [],
    spendAnswer: { allowed: true, quota: FAKE_QUOTA },
    introductionAnswer: { allowed: true },
    introductions: 0,
    knownBearer: FAKE_BEARER,
    resolveUserId(authorization) {
      return Effect.sync(() => {
        fake.resolved.push(authorization);
        return authorization === fake.knownBearer ? Option.some(FAKE_USER_ID) : Option.none();
      });
    },
    spend(userId) {
      return Effect.sync(() => {
        fake.spent.push(userId);
        return fake.spendAnswer;
      });
    },
    spendIntroduction() {
      return Effect.sync(() => {
        fake.introductions += 1;
        return fake.introductionAnswer;
      });
    },
    recordSeconds(input) {
      return Effect.sync(() => {
        fake.reports.push(input);
        if (landed.has(input.sessionId)) return VOICE_SECONDS_OUTCOME.REPEATED;
        landed.add(input.sessionId);
        return VOICE_SECONDS_OUTCOME.RECORDED;
      });
    },
  };
  return fake;
}

interface RecordedClose {
  sessionId: string;
  seconds: number;
  reason: VoiceCloseReason;
}

export interface FakeSessionRecord extends VoiceSessionRecord {
  registered: Array<{ userId: string; sessionId: string; deviceId?: string | undefined }>;
  /** The store id the fake minted for each live session's row, by live session id, as `register` answered it. */
  voiceSessionIds: Map<string, string>;
  /** The device rows the fake holds, by the account that holds each and the platform each names. */
  devices: Array<{ userId: string; deviceId: string; platform: DevicePlatform }>;
  /** Every usage snapshot, in order. */
  usage: Array<{ sessionId: string; seconds: number }>;
  closes: RecordedClose[];
}

/**
 * A session record that keeps one owner per live session, as the unique column
 * does, and answers the same effects the real one does, so a test's service
 * composes it exactly as the function's does and nothing here reaches a
 * database.
 */
export function fakeSessionRecord(): FakeSessionRecord {
  const owners = new Map<string, string>();
  const fake: FakeSessionRecord = {
    registered: [],
    voiceSessionIds: new Map(),
    devices: [],
    usage: [],
    closes: [],
    register: (input) =>
      Effect.sync(() => {
        fake.registered.push(input);
        if (!owners.has(input.sessionId)) {
          owners.set(input.sessionId, input.userId);
          fake.voiceSessionIds.set(input.sessionId, randomUUID());
        }
        return owners.get(input.sessionId) === input.userId
          ? fake.voiceSessionIds.get(input.sessionId)
          : undefined;
      }),
    heldDevice: (input) =>
      Effect.sync(() => {
        const held = fake.devices.find(
          (device) => device.userId === input.userId && device.deviceId === input.deviceId,
        );
        return held === undefined ? undefined : { platform: held.platform };
      }),
    owned: (input) => Effect.sync(() => owners.get(input.sessionId) === input.userId),
    noteUsage: (input) =>
      Effect.sync(() => {
        fake.usage.push(input);
      }),
    close: (input) =>
      Effect.sync(() => {
        fake.closes.push(input);
      }),
  };
  return fake;
}

/** A socket's inbound frames as text, taken one at a time, and its close as a promise. */
export interface SocketReader {
  socket: WebSocket;
  next(timeoutMs?: number): Promise<string>;
  /** Whether a frame arrives within the wait; false is the assertion that none did. */
  arrives(timeoutMs?: number): Promise<boolean>;
  closed: Promise<{ code: number; reason: string }>;
}

const READ_TIMEOUT_MS = 2_000;
const QUIET_MS = 150;

export function readSocket(socket: WebSocket): SocketReader {
  const frames: string[] = [];
  const waiting: Array<(frame: string) => void> = [];
  socket.on("message", (data: RawData) => {
    const text = data.toString();
    const waiter = waiting.shift();
    if (waiter) waiter(text);
    else frames.push(text);
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    socket.once("close", (code, reason) => resolve({ code, reason: reason.toString() }));
  });
  const next = (timeoutMs = READ_TIMEOUT_MS): Promise<string> => {
    const queued = frames.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiting.splice(waiting.indexOf(resolve), 1);
        reject(new Error("No frame arrived within the wait"));
      }, timeoutMs);
      waiting.push((frame) => {
        clearTimeout(timer);
        resolve(frame);
      });
    });
  };
  return {
    socket,
    next,
    arrives: (timeoutMs = QUIET_MS) =>
      next(timeoutMs).then(
        () => true,
        () => false,
      ),
    closed,
  };
}

/** Opens a socket to the service and resolves once the handshake completed, or with the refused status. */
export function connect(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ reader: SocketReader } | { status: number }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers });
    const reader = readSocket(socket);
    socket.once("open", () => resolve({ reader }));
    socket.once("unexpected-response", (_request, response) => {
      socket.terminate();
      resolve({ status: response.statusCode ?? 0 });
    });
    socket.once("error", reject);
  });
}

/** Sends one JSON frame and waits for the write to leave. */
export function send(socket: WebSocket, frame: WireRecord): Promise<void> {
  return sendText(socket, JSON.stringify(frame));
}

export function sendText(socket: WebSocket, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.send(text, (error) => (error ? reject(error) : resolve()));
  });
}
