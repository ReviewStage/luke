import http, { type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import {
  HOSTED_SERVICE_PATH,
  VOICE_SERVICE_SECRET_HEADER,
  VOICE_USAGE_RECORD,
} from "@sidecar/hosted";
import { LIVE_SESSIONS_PATH, LIVE_TRANSPORT_TYPE } from "@sidecar/live";
import { isRecord, type UnparsedWireValue, unparsedWire, type WireRecord } from "@sidecar/wire";
import { type RawData, WebSocket, WebSocketServer } from "ws";

/**
 * The two services this one talks to, stood up on this machine for a test:
 * an OpenAI that creates sessions and takes attaches, and an account service
 * that authorizes and records usage. Each remembers what it was asked and
 * answers what the test told it to, and hands the test the far end of every
 * socket so the test can play OpenAI's part.
 */

const LOOPBACK = "127.0.0.1";
const HTTP_CREATED = 201;
const HTTP_OK = 200;

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

export interface FakeOpenAi {
  baseUrl: string;
  creates: RecordedCreate[];
  attaches: RecordedAttach[];
  /** The status the next create answers with; 201 unless a test says otherwise. */
  createStatus: number;
  /** Resolves with the next attach the service opens, or the one already waiting. */
  nextAttach(): Promise<RecordedAttach>;
  close(): Promise<void>;
}

const ATTACH_PATH = new RegExp(`^/v1${LIVE_SESSIONS_PATH}/([^/]+)/attach$`);

export async function startFakeOpenAi(): Promise<FakeOpenAi> {
  const creates: RecordedCreate[] = [];
  const attaches: RecordedAttach[] = [];
  const unclaimed: RecordedAttach[] = [];
  const waiting: Array<(attach: RecordedAttach) => void> = [];
  let sessions = 0;
  const fake: FakeOpenAi = {
    baseUrl: "",
    creates,
    attaches,
    createStatus: HTTP_CREATED,
    nextAttach: () =>
      new Promise((resolve) => {
        const ready = unclaimed.shift();
        if (ready) resolve(ready);
        else waiting.push(resolve);
      }),
    close: async () => {
      for (const attach of attaches) attach.socket.terminate();
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
          session: { id: `live_test_${sessions}` },
          transport: { type: LIVE_TRANSPORT_TYPE, sdp: FAKE_SDP_ANSWER },
        }),
      );
      return;
    }
    response.writeHead(404).end();
  });
  server.on("upgrade", (request, socket, head) => {
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
      const waiter = waiting.shift();
      if (waiter) waiter(attach);
      else unclaimed.push(attach);
    });
  });
  const port = await listen(server);
  fake.baseUrl = `http://${LOOPBACK}:${port}/v1`;
  return fake;
}

interface RecordedInternalCall {
  secret: string | undefined;
  body: WireRecord;
}

interface FakeAnswer {
  status: number;
  body: UnparsedWireValue;
}

export interface FakeAccountService {
  origin: string;
  authorizeCalls: RecordedInternalCall[];
  usageCalls: RecordedInternalCall[];
  authorizeAnswer: FakeAnswer;
  usageAnswer: FakeAnswer;
  close(): Promise<void>;
}

export const FAKE_QUOTA = { used: 3, limit: 5000, resetsAt: 1_800_000_000_000 };
export const FAKE_USER_ID = "user-1";

export async function startFakeAccountService(): Promise<FakeAccountService> {
  const authorizeCalls: RecordedInternalCall[] = [];
  const usageCalls: RecordedInternalCall[] = [];
  const fake: FakeAccountService = {
    origin: "",
    authorizeCalls,
    usageCalls,
    authorizeAnswer: { status: HTTP_OK, body: { userId: FAKE_USER_ID, quota: FAKE_QUOTA } },
    usageAnswer: { status: HTTP_OK, body: { record: VOICE_USAGE_RECORD.RECORDED } },
    close: () => closeServer(server),
  };
  const server = http.createServer(async (request, response) => {
    const call: RecordedInternalCall = {
      secret: request.headers[VOICE_SERVICE_SECRET_HEADER]?.toString(),
      body: jsonRecord(await readBody(request)),
    };
    let answer: FakeAnswer | undefined;
    if (request.url === HOSTED_SERVICE_PATH.VOICE_AUTHORIZE) {
      authorizeCalls.push(call);
      answer = fake.authorizeAnswer;
    } else if (request.url === HOSTED_SERVICE_PATH.VOICE_USAGE) {
      usageCalls.push(call);
      answer = fake.usageAnswer;
    }
    if (answer === undefined) {
      response.writeHead(404).end();
      return;
    }
    response
      .writeHead(answer.status, { "content-type": "application/json" })
      .end(JSON.stringify(answer.body));
  });
  const port = await listen(server);
  fake.origin = `http://${LOOPBACK}:${port}`;
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
