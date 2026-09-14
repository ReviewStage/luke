import { randomUUID } from "node:crypto";
import http, { type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { Effect, FiberSet, type Layer, Option, type Schema, type Scope } from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import type { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { type WebSocket, WebSocketServer } from "ws";
import {
  type DevicePlatform,
  HOSTED_API_ERROR,
  type HostedApiError,
  HTTP_STATUS,
  isDeviceWireId,
  type SessionAttachedFrame,
  type SessionAttachFrame,
  type SessionAudioCreatedFrame,
  type SessionAudioCreateFrame,
  type SessionCreatedFrame,
  type SessionCreateFrame,
  type SessionSpokenFrame,
  sessionAudioCreateFrameFromWire,
  sessionOpeningFrameFromWire,
  type UnparsedWireValue,
  VOICE_SERVICE_FRAME,
  VOICE_SERVICE_HEADER,
} from "../core.js";
import {
  commentaryAppend,
  decodeLivePayload,
  greetingCue,
  greetingInstruction,
  instructionsAppend,
  LIVE_CLIENT_EVENT,
  LIVE_INPUT_AUDIO_APPEND,
  LIVE_INPUT_BOUNDS,
  LIVE_SCENE,
  LIVE_SESSION_OUTCOME,
  type LiveClientEvent,
  livePrimarySessionConfig,
  liveSessionConfig,
  RENDERER_CLIENT_EVENTS,
  RENDERER_SERVER_EVENTS,
  SEED_ROLE,
} from "../live.js";
import type { WebStoreRun } from "../runtime.js";
import type { VoiceAccounts } from "./accounts.js";
import { routeForPath, type SignedInRoute, VOICE_ROUTE, type VoiceRoute } from "./frames.js";
import type { AttachedExchange, AttachedSession, ExchangeAttachment } from "./live-exchange.js";
import { LOG_EVENT, type Log, standardOutputLog } from "./log.js";
import { createLiveUpstream, type LiveUpstream } from "./openai.js";
import { OPENING_OUTCOME, type OpeningSettled, RELAY_DEFAULTS, relaySession } from "./relay.js";
import type { VoiceSessionRecord } from "./session-record.js";
import {
  frameText,
  replayHeldFrames,
  SOCKET_CLOSE_CODE,
  type VoiceSocket,
  voiceSocket,
} from "./socket.js";

/**
 * The hosted voice service: the part of Luke's own deployment that holds the
 * GPT Live project key, so it is what creates each hosted session, attaches
 * the trusted sideband, and carries events between a signed-in device and
 * OpenAI. It runs as three Vercel Functions serving WebSockets, and keeps no
 * conversation and executes nothing: a session's transcript crosses it as
 * bytes it never reads past the `type` field, and what it writes down is
 * status codes, counts, and the platform of the device row a handshake
 * resolved.
 *
 * Three upgrades stand. `/api/voice/sessions` takes a signed-in device under
 * its account bearer, resolved and spent by the same account code every
 * hosted route uses, before any session exists. A Mac connecting from its
 * main process and a phone connecting from `URLSession` are one caller here:
 * each presents that bearer, names its own `devices` row in the same header,
 * and sends the same four frames, and which of them is calling is read from
 * the row that handshake resolved rather than from anything the caller says
 * of itself.
 *
 * `/api/voice/introduction` takes a fresh install with no account under the
 * same durable daily meter the introduction mint spends, so the ceiling is
 * the deployment's and not one function instance's, spent only for an
 * admitted opening frame, and on that route the sideband is the service's
 * alone: once the session starts it
 * sends the greeting, waits for the acknowledgment that says the model took
 * it, cues the model to begin, and shows the caller only captions and
 * status.
 *
 * `/api/voice/audio` takes a signed-in device under the same handshake as
 * `/api/voice/sessions`, for a device with no WebRTC of its own. The service
 * opens the session's primary socket to OpenAI itself, on Luke's key, and the
 * device streams its audio up that socket and hears Luke's down it, beside
 * the same events, so on this route alone the developer's voice and Luke's
 * transit the service, in both directions. The record is still kept from the
 * events alone: the sideband the exchange reads drops the audio by type
 * before the writer sees it, and the log counts the audio's frames and bytes
 * as it counts every other frame's.
 *
 * A connection is one function invocation, and the platform closes it at the
 * function's maximum duration. On the sessions route the WebRTC session
 * between the device and OpenAI stands on past that, so a socket there may
 * also open with `session.attach`: the account that created the session,
 * proven by the `voice_sessions` row creation wrote, attaches a fresh
 * sideband to it and the pipe resumes; whatever the session said between the
 * two connections is not replayed. On the audio route the service's own
 * socket is the session, so the call ends when the function does and nothing
 * re-attaches to it.
 *
 * A refusal has one of two shapes the device reads: an HTTP status on the
 * upgrade (401, 403, 503) before any socket stands, or, once one does, a
 * first frame carrying `{ error }` in the hosted vocabulary before the close.
 */

const SERVICE_DEFAULTS = {
  /** How long a fresh socket has to send its opening frame before it is refused. */
  FIRST_FRAME_TIMEOUT_MS: 10_000,
  /** The largest frame either side may send; `ws` closes the connection on a larger one. */
  MAXIMUM_FRAME_BYTES: 2 * 1024 * 1024,
} as const;

/** The statuses an upgrade is refused with, before any socket stands. */
export const UPGRADE_STATUS = {
  /** The handshake named a device in a shape no device id has; no build of this service's own callers does. */
  BAD_REQUEST: 400,
  UNAUTHORIZED: HTTP_STATUS.UNAUTHORIZED,
  /** The handshake carried a browser `Origin`; neither caller is a page — the desktop connects from its main process and the phone from `URLSession` — so neither sets one. */
  FORBIDDEN: HTTP_STATUS.FORBIDDEN,
  NOT_FOUND: HTTP_STATUS.NOT_FOUND,
  SERVICE_UNAVAILABLE: 503,
} as const;

/** A plain request to a socket path: the answer says what the path is for. */
const UPGRADE_REQUIRED = 426;

/**
 * How many bytes one device socket may send before the service closes it,
 * counted by its own reader from the first frame it takes, so what a caller
 * sends while its session is being stood up is spent as much as what the pipe
 * later carries. On the sessions and introduction routes the frames a caller
 * sends are a data channel's — mutes, appended text, the opening frame —
 * since there the voice itself travels over WebRTC and never over this
 * socket, so a caller past the bound is sending something other than a
 * conversation. The introduction's bound is the tighter one, because that
 * route answers a fresh install with no account behind it and nothing else
 * caps what it may hold: every frame the reader takes is held in the socket's
 * own mailbox until a consumer takes it, so an unbounded sender would be
 * unbounded memory on Luke's key. A signed-in device is bounded far wider,
 * since its account is spent per session and answers for what it sends.
 *
 * The audio route's bound is the one sized for a conversation, because there
 * the socket carries the developer's voice. PCM16 at 16 kHz, the route's
 * default format, is 16,000 samples a second of two bytes each, 32,000 B/s
 * raw, and it travels as base64 inside a JSON frame, four bytes for every
 * three, so 42,667 B/s of audio; the frame's own envelope, the type and the
 * key, is some 60 bytes a frame, and at the twenty to fifty frames a second a
 * device chunks its microphone into that is at most 3,000 B/s more. Over a
 * call bounded by `VOICE_FUNCTION_MAX_DURATION_SECONDS`, 800 seconds, with the
 * microphone open the whole way, that is under 36.6 MB, and 40 MiB holds it
 * with room for the hang-up and the reports beside it. It is counted on what
 * the device sends alone, as every route's is: Luke's audio going the other
 * way spends none of it. A device that named PCM16 at 24 kHz instead spends
 * the same bound in about 630 seconds of open microphone, which is the format
 * ruling's business and not this bound's.
 */
export const SOCKET_BYTE_BUDGET = {
  INTRODUCTION: 1024 * 1024,
  SESSIONS: 8 * 1024 * 1024,
  AUDIO: 40 * 1024 * 1024,
} as const;

function byteBudgetFor(route: VoiceRoute): number {
  switch (route) {
    case VOICE_ROUTE.INTRODUCTION:
      return SOCKET_BYTE_BUDGET.INTRODUCTION;
    case VOICE_ROUTE.SESSIONS:
      return SOCKET_BYTE_BUDGET.SESSIONS;
    case VOICE_ROUTE.AUDIO:
      return SOCKET_BYTE_BUDGET.AUDIO;
  }
}

/** What a server hands a service that stands on it, which is what `ws` upgrades on. */
type VoiceUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => void;

export interface VoiceServer {
  /** The server a function module exports for Vercel to upgrade into. */
  readonly server: http.Server;
  /** The one service answering this server's upgrades: none until one stands, and none again once its scope closes. */
  readonly serve: (handle: VoiceUpgrade | undefined) => void;
}

/** The names this build knows a device frame by, so the log names the frame it refused and never a string the device chose. */
const KNOWN_FRAME_TYPES: ReadonlySet<string> = new Set<string>([
  ...Object.values(LIVE_CLIENT_EVENT),
  LIVE_INPUT_AUDIO_APPEND,
  ...Object.values(VOICE_SERVICE_FRAME),
]);

function knownFrameType(type: string | undefined): string | undefined {
  return type !== undefined && KNOWN_FRAME_TYPES.has(type) ? type : undefined;
}

/** Refuses one upgrade before any socket stands, with the status the decision named. */
function refuseUpgrade(socket: Duplex, status: number): void {
  socket.end(`HTTP/1.1 ${status} Refused\r\nConnection: close\r\n\r\n`);
}

/**
 * The HTTP face of the voice service, built where a function module is
 * evaluated because that module's export is synchronous and the service
 * behind it is an effect the edge's own runtime runs. It answers plain
 * requests itself, and until a service claims it — the gap between the
 * module's evaluation and the service standing on the runtime the same module
 * builds, which closes before Vercel's bridge has a socket to hand it — every
 * upgrade is refused with the same 503 a deployment missing the project key
 * answers with. A deployment whose runtime cannot be built stands no service
 * and keeps answering it.
 */
export function voiceServer(): VoiceServer {
  let handle: VoiceUpgrade | undefined;
  const server = http.createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    response.writeHead(routeForPath(path) ? UPGRADE_REQUIRED : UPGRADE_STATUS.NOT_FOUND).end();
  });
  server.on("upgrade", (request, socket, head) => {
    socket.on("error", () => socket.destroy());
    if (handle === undefined) {
      refuseUpgrade(socket, UPGRADE_STATUS.SERVICE_UNAVAILABLE);
      return;
    }
    handle(request, socket, head);
  });
  return {
    server,
    serve: (next) => {
      handle = next;
    },
  };
}

/**
 * Listens for the scope's life and answers the port the operating system
 * gave. The deployment never calls it — Vercel's bridge listens on the server
 * the function exported — so this is what a test stands one on, and the
 * scope's close is the listener's. A test acquires it before the service, so
 * the reverse order that closes the scope drains the sessions first and the
 * listener waits on no connection the drain has yet to end.
 */
export function listening(
  voice: VoiceServer,
  port: number,
  host: string,
): Effect.Effect<number, never, Scope.Scope> {
  return Effect.acquireRelease(
    Effect.callback<number>((resume) => {
      const failed = (error: Error) => resume(Effect.die(error));
      voice.server.once("error", failed);
      voice.server.listen(port, host, () => {
        voice.server.off("error", failed);
        // SAFETY: a TCP server that is listening answers an AddressInfo, never a pipe path.
        const address = voice.server.address() as AddressInfo;
        resume(Effect.succeed(address.port));
      });
    }),
    () =>
      Effect.callback<void>((resume) => {
        voice.server.close(() => resume(Effect.void));
      }),
  );
}

/**
 * What an accountless introduction may put into a session running on Luke's
 * key: one developer message naming the detected sessions, bounded well
 * under what the takeover composes (at most eight titles of eighty
 * characters), because this is client text entering a prompt with no account
 * to answer for it.
 */
export const INTRODUCTION_INPUT_BOUNDS = {
  MESSAGES: 1,
  CHARS: 1_024,
} as const;

/**
 * What a signed-in device may put into its session's `input`: the API's own
 * message bound, and a per-part bound wide enough for the roster summary a
 * session opens with and the Conversation lines beside it, each of which the
 * device composes under bounds of its own. It is admitted by shape rather
 * than trusted by route: an account behind a request says who is asking, not
 * how much of a prompt this service will pay OpenAI to read.
 */
export const SESSIONS_INPUT_BOUNDS = {
  MESSAGES: LIVE_INPUT_BOUNDS.MESSAGES,
  CHARS: 4_096,
} as const;

const BEARER_SCHEME = "Bearer ";

export interface VoiceServiceOptions {
  /** The server the service stands on, built where the function module is evaluated. */
  server: VoiceServer;
  /** The GPT Live project key; absent, every upgrade is refused with 503. */
  apiKey: string | undefined;
  model?: string | undefined;
  accounts: VoiceAccounts;
  /** The `voice_sessions` row of each signed-in session, the device it named among its columns; the introduction, with no account, writes none. */
  record: VoiceSessionRecord;
  /** The edge's own runner, which every session's one effect is run on; a test hands the runner over its own test database. */
  run: WebStoreRun;
  /**
   * The hosted exchange to stand on each signed-in session, adopted over the
   * same sideband the relay pipes. The route passes one; absent, as a test
   * may leave it, the service only pipes and nobody answers a spoken ask.
   */
  exchange?: ExchangeAttachment;
  /** The OpenAI `/v1` base; a test points it at a fake. */
  openAiBaseUrl?: string;
  httpClient?: Layer.Layer<HttpClient.HttpClient>;
  log?: Log;
  closeTimeoutMs?: number;
  /** How long the greeting's acknowledgment is waited on before the cue is abandoned. */
  greetingTimeoutMs?: number;
  attachTimeoutMs?: number;
  createTimeoutMs?: number;
  /** How long the audio route's primary socket is given to open and start its session. */
  primaryTimeoutMs?: number;
  firstFrameTimeoutMs?: number;
}

/**
 * Who an upgrade admitted: a signed-in device, on either of its two routes,
 * with the `Authorization` value it presented and the device row it claimed
 * to be, or an introduction with nothing. The claim is a well-formed id and
 * no more until the account is resolved; whether that account holds the row,
 * and which platform that row names, is asked then.
 */
type Admission =
  | { route: SignedInRoute; bearer: string; deviceId: string | undefined }
  | { route: typeof VOICE_ROUTE.INTRODUCTION };

type SignedInAdmission = Extract<Admission, { route: SignedInRoute }>;

/** The account a device's handshake resolved to, its device claim admitted and a session spent, or the reason it is refused. */
type AdmittedAccount =
  | {
      accountId: string;
      deviceId: string | undefined;
      platform: DevicePlatform | undefined;
      quota: SessionCreatedFrame["quota"];
    }
  | { refusal: HostedApiError; platform: DevicePlatform | undefined };

type UpgradeDecision = Admission | { status: number };

/** A session standing behind a socket, with the frame that says so, or the reason it is not. */
type Opened =
  | {
      sessionId: string;
      /** The account the session is billed to; none for the introduction. */
      accountId: string | undefined;
      /** The device the handshake named and the account was shown to hold; none for the introduction, for a device that sent none, and on a re-attach, which checks the session's owner and not a device. */
      deviceId: string | undefined;
      /** The platform that device row named, which is what the log counts this caller by; none wherever no row was resolved. */
      platform: DevicePlatform | undefined;
      /**
       * Whether the session is already running: false for one just created
       * from a WebRTC offer, whose peer has yet to connect; true for one
       * re-attached, which spoke its start to an earlier connection, and for
       * one the audio route opened, whose start the door read itself.
       */
      started: boolean;
      /** The service's socket to OpenAI, open and paused: the sideband it attached, or the primary socket that is the session. */
      sideband: WebSocket;
      /**
       * The frames the door took off that socket before any consumer stood,
       * in order: what a primary socket said beside `session.started`, and
       * nothing on the routes whose socket the service resumes untouched.
       * They reach both consumers ahead of the resume, through the socket's
       * own event, so a frame that arrived with the handshake is heard once.
       */
      held: readonly string[];
      answer: SessionCreatedFrame | SessionAttachedFrame | SessionAudioCreatedFrame;
      logEvent: typeof LOG_EVENT.SESSION_CREATED | typeof LOG_EVENT.SESSION_ATTACHED;
    }
  | { refusal: HostedApiError; platform: DevicePlatform | undefined };

/**
 * A refusal as both `Opened` and `AdmittedAccount` state one: the reason, and
 * the platform where a device row had been resolved by the time it was
 * reached — nothing everywhere else, which is every refusal ahead of that row.
 */
function refused(reason: HostedApiError, platform?: DevicePlatform) {
  return { refusal: reason, platform };
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function presentedBearer(request: IncomingMessage): string | undefined {
  const authorization = headerValue(request.headers.authorization);
  if (authorization === undefined || !authorization.startsWith(BEARER_SCHEME)) return undefined;
  return authorization.slice(BEARER_SCHEME.length).trim().length > 0 ? authorization : undefined;
}

function introductionInputAdmitted(frame: SessionCreateFrame): boolean {
  return (
    frame.input.length <= INTRODUCTION_INPUT_BOUNDS.MESSAGES &&
    frame.input.every(
      (item) =>
        item.role === SEED_ROLE.DEVELOPER &&
        item.content.every((part) => part.text.length <= INTRODUCTION_INPUT_BOUNDS.CHARS),
    )
  );
}

function sessionsInputAdmitted(frame: SessionCreateFrame): boolean {
  return (
    frame.input.length <= SESSIONS_INPUT_BOUNDS.MESSAGES &&
    frame.input.every((item) =>
      item.content.every((part) => part.text.length <= SESSIONS_INPUT_BOUNDS.CHARS),
    )
  );
}

/**
 * What one session's own effect may fail with: the `voice_sessions` writes
 * the service makes on the session's behalf, and nothing else — every other
 * refusal is a frame the device is answered with.
 */
type SessionFailure = SqlError | Schema.SchemaError;

type SessionEffect<A> = Effect.Effect<A, SessionFailure, SqlClient.SqlClient | Scope.Scope>;

export class VoiceService {
  readonly #options: VoiceServiceOptions;
  readonly #log: Log;
  readonly #accounts: VoiceAccounts;
  readonly #record: VoiceSessionRecord;
  readonly #run: WebStoreRun;
  readonly #upstream: LiveUpstream | undefined;
  readonly #sockets: WebSocketServer;
  /** Every session under way, one fiber each, so a close can wait for each to finalize. */
  readonly #fibers: FiberSet.FiberSet<void>;
  readonly #begin: (session: Effect.Effect<void>) => void;

  private constructor(
    options: VoiceServiceOptions,
    upstream: LiveUpstream | undefined,
    sockets: WebSocketServer,
    fibers: FiberSet.FiberSet<void>,
    begin: (session: Effect.Effect<void>) => void,
  ) {
    this.#options = options;
    this.#log = options.log ?? standardOutputLog;
    this.#accounts = options.accounts;
    this.#record = options.record;
    this.#run = options.run;
    this.#upstream = upstream;
    this.#sockets = sockets;
    this.#fibers = fibers;
    this.#begin = begin;
  }

  /**
   * The service for one function instance, standing for the scope it is built
   * in. That scope owns everything the service's own life is made of: the `ws`
   * server the upgrades are handled on, the set each session's fiber joins,
   * and the claim on the server the function exported. There is no `close`
   * beside it, because the close is the scope's own finalizer rather than a
   * verb a caller chooses: a deployment holds this scope for the instance's
   * life and is given no shutdown hook to end it with, so the one caller that
   * ever ends a service is a test ending the scope it stood one in.
   *
   * The finalizers run in the order the session's own ending needs. Giving up
   * the claim and closing every device socket comes first, so each relay runs
   * its graceful close upstream and the seconds it owes are recorded; the
   * drain waits for those fibers under their own timeouts; and only then does
   * the `ws` server close and the set interrupt whatever the drain left, which
   * is nothing a session that ended left behind.
   */
  static make(options: VoiceServiceOptions): Effect.Effect<VoiceService, never, Scope.Scope> {
    return Effect.gen(function* () {
      const fibers = yield* FiberSet.make<void>();
      const fork = yield* FiberSet.runtime(fibers)<never>();
      const sockets = yield* Effect.acquireRelease(
        Effect.sync(
          () =>
            new WebSocketServer({
              noServer: true,
              maxPayload: SERVICE_DEFAULTS.MAXIMUM_FRAME_BYTES,
            }),
        ),
        (server) =>
          Effect.callback<void>((resume) => {
            server.close(() => resume(Effect.void));
          }),
      );
      const apiKey = options.apiKey?.trim();
      const service = new VoiceService(
        options,
        apiKey
          ? createLiveUpstream({
              apiKey,
              baseUrl: options.openAiBaseUrl,
              httpClient: options.httpClient,
              createTimeoutMs: options.createTimeoutMs,
              attachTimeoutMs: options.attachTimeoutMs,
              primaryTimeoutMs: options.primaryTimeoutMs,
            })
          : undefined,
        sockets,
        fibers,
        (session) => {
          // Begun on a fiber of the set, and begun by the scheduler rather
          // than on the stack of whoever asked. v4's `runForkWith`, which
          // `FiberSet.runtime` forks through, evaluates the effect where it
          // is called, so a session's word to the device reported from
          // inside the exchange's own reading fiber would be written to the
          // socket in the middle of that read, ahead of the very frame the
          // relay's reader is queued to forward and that the report is about.
          // The yield is what puts this fiber's first step behind the wakes
          // already queued, which is the order the device is owed: every
          // server frame as it arrived, and then the service's own word about
          // the last of them.
          fork(Effect.andThen(Effect.yieldNow, session));
        },
      );
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          options.server.serve((request, socket, head) => {
            service.#upgrade(request, socket, head);
          }),
        ),
        () => service.#drain,
      );
      return service;
    });
  }

  /** How many sessions are under way, each a fiber of the service's own set. */
  get sessions(): Effect.Effect<number> {
    return FiberSet.size(this.#fibers);
  }

  /**
   * Refuses new upgrades by giving up the server's claim, closes every device
   * socket so each relay runs its graceful close upstream, and waits for those
   * fibers to finalize under their own timeouts.
   */
  get #drain(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      this.#options.server.serve(undefined);
      for (const socket of this.#sockets.clients) {
        socket.close(SOCKET_CLOSE_CODE.GOING_AWAY);
      }
      yield* FiberSet.awaitEmpty(this.#fibers);
    });
  }

  #upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    const decision = this.#admit(request, routeForPath(path));
    if ("status" in decision) {
      this.#log({ event: LOG_EVENT.UPGRADE_REFUSED, route: path, status: decision.status });
      refuseUpgrade(socket, decision.status);
      return;
    }
    this.#sockets.handleUpgrade(request, socket, head, (webSocket) => {
      // Paused before the fiber that reads it stands: `ws` emits a frame to
      // whoever listens at that instant, and the session's own reader is a
      // fiber away. `#serve` resumes it once that reader is registered.
      webSocket.pause();
      this.#begin(this.#session(webSocket, decision));
    });
  }

  /**
   * One session as a fiber of the service's set: the effect `#serve`
   * describes, run on the edge's own runner, and the `voice_sessions` write
   * that could fail it written down by its route alone. A failure there was an
   * unhandled rejection before this was a fiber, and it says nothing of the
   * session but that one of its own rows did not land.
   */
  #session(socket: WebSocket, admission: Admission): Effect.Effect<void> {
    return Effect.catch(
      Effect.tryPromise(() => this.#run(Effect.scoped(this.#serve(socket, admission)))),
      () =>
        Effect.sync(() => {
          this.#log({ event: LOG_EVENT.SESSION_FAILED, route: admission.route });
        }),
    );
  }

  /** Who an upgrade admits before any socket stands, or the status it is refused with. */
  #admit(request: IncomingMessage, route: VoiceRoute | undefined): UpgradeDecision {
    if (this.#upstream === undefined) {
      return { status: UPGRADE_STATUS.SERVICE_UNAVAILABLE };
    }
    if (route === undefined) return { status: UPGRADE_STATUS.NOT_FOUND };
    if (request.headers.origin !== undefined) return { status: UPGRADE_STATUS.FORBIDDEN };
    if (route !== VOICE_ROUTE.INTRODUCTION) {
      const bearer = presentedBearer(request);
      if (bearer === undefined) return { status: UPGRADE_STATUS.UNAUTHORIZED };
      const deviceId = headerValue(request.headers[VOICE_SERVICE_HEADER.DEVICE_ID]);
      if (deviceId !== undefined && !isDeviceWireId(deviceId)) {
        return { status: UPGRADE_STATUS.BAD_REQUEST };
      }
      return { route, bearer, deviceId };
    }
    return { route };
  }

  /**
   * One socket, one session, one scope: the opening frame, the creation or
   * attachment, the pipe. Everything the session acquires — both sockets, the
   * fibers that read them, and the waits the relay arms — belongs to the scope
   * this effect runs in, so a session that ends, however it ends, leaves
   * nothing of itself behind.
   */
  #serve(socket: WebSocket, admission: Admission): SessionEffect<void> {
    return Effect.gen({ self: this }, function* () {
      const upstream = this.#upstream;
      if (upstream === undefined) return;
      const { route } = admission;
      const device = yield* voiceSocket(socket, { byteBudget: byteBudgetFor(route) });
      yield* Effect.sync(() => socket.resume());
      // The platform is the opening's to name, since it is read from the
      // device row that opening resolved: a refusal reached before any row
      // was read counts none.
      const refuse = (
        reason: HostedApiError,
        platform: DevicePlatform | undefined,
      ): Effect.Effect<void> =>
        Effect.gen({ self: this }, function* () {
          this.#log({ event: LOG_EVENT.SESSION_REFUSED, route, reason, platform });
          if (!(yield* device.isOpen)) return;
          yield* device.send({ text: JSON.stringify({ error: reason }) });
          yield* device.close(SOCKET_CLOSE_CODE.POLICY_VIOLATION, reason);
        });

      const opened = yield* this.#open(upstream, admission, device);
      // A socket opened for a device that has gone is the scope's to
      // release, which it does on the way out of this effect.
      if (!(yield* device.isOpen)) return;
      if ("refusal" in opened) {
        yield* refuse(opened.refusal, opened.platform);
        return;
      }
      const { sessionId, accountId, platform, sideband } = opened;
      // The exchange stands before the device is answered, on the same socket
      // the relay is about to pipe. The socket is paused since the attach, so a
      // frame the session spoke while the exchange stood is read once both
      // consumers listen, by both, in order.
      const standing =
        accountId === undefined
          ? { exchange: undefined }
          : yield* this.#attachExchange({
              route,
              accountId,
              sessionId,
              deviceId: opened.deviceId,
              platform,
              started: opened.started,
              sideband,
              // The service's one frame to the device after the handshake, sent
              // on a fiber of the service's own set since the exchange reports
              // it from inside its own; a device gone by then takes it nowhere.
              onSpoken: (kind) => {
                const frame: SessionSpokenFrame = {
                  type: VOICE_SERVICE_FRAME.SESSION_SPOKEN,
                  kind,
                };
                this.#begin(Effect.ignore(device.send({ text: JSON.stringify(frame) })));
              },
            });
      if ("refused" in standing) {
        yield* refuse(HOSTED_API_ERROR.UNAVAILABLE, platform);
        return;
      }
      const { exchange } = standing;
      // The device may have gone while the exchange stood: nothing is answered
      // to a socket that is not there, and the exchange ends here rather than
      // being left standing for the invocation. The socket is handed what the
      // door held and resumed first, since the exchange's own graceful close
      // waits for a `session.closed` a paused socket would never deliver.
      if (!(yield* device.isOpen)) {
        yield* Effect.sync(() => {
          replayHeldFrames(sideband, opened.held);
          sideband.resume();
        });
        if (exchange !== undefined) yield* this.#stopExchange(route, exchange, platform);
        return;
      }
      yield* device.send({ text: JSON.stringify(opened.answer) });
      this.#log({ event: opened.logEvent, route });

      const pipe = yield* voiceSocket(sideband);
      // Both consumers listen now: what the door held for them first, then
      // what the session spoke since, read here, by both, in order.
      yield* Effect.sync(() => {
        replayHeldFrames(sideband, opened.held);
        sideband.resume();
      });
      const summary = yield* relaySession<SqlClient.SqlClient>({
        route,
        device,
        upstream: pipe,
        closeTimeoutMs: this.#options.closeTimeoutMs ?? RELAY_DEFAULTS.CLOSE_TIMEOUT_MS,
        openingTimeoutMs: this.#options.greetingTimeoutMs ?? RELAY_DEFAULTS.OPENING_TIMEOUT_MS,
        onSessionStarted:
          route === VOICE_ROUTE.INTRODUCTION
            ? () => {
                this.#log({ event: LOG_EVENT.GREETING_SENT, route });
                return instructionsAppend({
                  eventId: randomUUID(),
                  delegationId: null,
                  content: greetingInstruction(),
                });
              }
            : undefined,
        onOpeningSettled:
          route === VOICE_ROUTE.INTRODUCTION
            ? (settled) => this.#greetingSettled(route, settled)
            : undefined,
        onUsageUpdated:
          accountId === undefined
            ? undefined
            : (seconds) => Effect.ignore(this.#record.noteUsage({ sessionId, seconds })),
        onSessionClosed:
          accountId === undefined
            ? undefined
            : (closed) =>
                Effect.ignore(
                  Effect.gen({ self: this }, function* () {
                    yield* this.#record.close({
                      sessionId,
                      seconds: closed.usage.seconds,
                      reason: closed.reason,
                    });
                    yield* this.#recordUsage(route, accountId, sessionId, closed.usage.seconds);
                  }),
                ),
        // The device's reports reach the exchange: its idle, which the
        // exchange decides the idle close on; its stop, which the exchange
        // answers with the one instruction it appends itself; and a beat it
        // decided is owed, which the exchange speaks from the build's script.
        // With no exchange standing a report is read and goes nowhere.
        onDeviceReport:
          exchange === undefined
            ? undefined
            : (report) => {
                switch (report.type) {
                  case VOICE_SERVICE_FRAME.SESSION_ACTIVITY:
                    exchange.service.reportActivity(report.idle);
                    return;
                  case VOICE_SERVICE_FRAME.SESSION_STOP:
                    exchange.service.stopSpeaking();
                    return;
                  case VOICE_SERVICE_FRAME.SESSION_BEAT:
                    exchange.speakBeat(report);
                    return;
                  default:
                    return;
                }
              },
        onFrameRefused: (type) => {
          this.#log({
            event: LOG_EVENT.FRAME_REFUSED,
            route,
            type: knownFrameType(type),
            platform,
          });
        },
      });
      // The relay has settled and closed both transports; the exchange ends its
      // follows and its look, closes the session it holds (already gone, which
      // its sideband reports as the close it held), and waits for every record
      // write already started, so no line begun before the settle is cut.
      if (exchange !== undefined) yield* this.#stopExchange(route, exchange, platform);
      this.#log({ event: LOG_EVENT.SESSION_ENDED, route, ...summary });
    });
  }

  /**
   * The exchange the composition offers for the session, standing on the same
   * socket the relay pipes: none where the composition offers none, or the
   * refusal where one was offered and could not stand, since a session with an
   * exchange offered and none standing would have no one to answer its asks.
   * The attachment builds the sideband and adopts; this service hands it the
   * socket and reaches nothing of the exchange itself.
   */
  #attachExchange(
    session: AttachedSession,
  ): Effect.Effect<{ exchange: AttachedExchange | undefined } | { refused: true }> {
    const attachment = this.#options.exchange;
    if (attachment === undefined) return Effect.succeed({ exchange: undefined });
    return Effect.tryPromise(() => attachment(session)).pipe(
      Effect.map((exchange) => {
        if (exchange === undefined) return { exchange: undefined };
        this.#log({ event: LOG_EVENT.EXCHANGE_ATTACHED, route: session.route });
        return { exchange };
      }),
      Effect.catch(() =>
        Effect.sync(() => {
          this.#log({
            event: LOG_EVENT.EXCHANGE_FAILED,
            route: session.route,
            platform: session.platform,
          });
          return { refused: true } as const;
        }),
      ),
    );
  }

  /** The exchange's stop, whose failure is the service's to report and never the relay's to inherit. */
  #stopExchange(
    route: VoiceRoute,
    exchange: AttachedExchange,
    platform: DevicePlatform | undefined,
  ): Effect.Effect<void> {
    return Effect.catch(
      Effect.tryPromise(() => exchange.stop()),
      () =>
        Effect.sync(() => {
          this.#log({ event: LOG_EVENT.EXCHANGE_FAILED, route, platform });
        }),
    );
  }

  /**
   * The session behind a socket's first frame, by the route the socket
   * opened on: the WebRTC routes take a `session.create` carrying an offer or,
   * on the sessions route, a `session.attach`; the audio route takes the
   * `session.create` that names a format and nothing else, so a
   * `session.attach` there is a first frame the route does not admit and is
   * refused as one, since a primary socket has no attach to offer. A frame
   * that was late, unreadable, or neither shape is the same refusal; a device
   * gone by the time its frame was read is refused the same way and answered
   * nothing, since nothing is spent on a caller who is not there.
   */
  #open(upstream: LiveUpstream, admission: Admission, device: VoiceSocket): SessionEffect<Opened> {
    return Effect.gen({ self: this }, function* () {
      if (admission.route === VOICE_ROUTE.AUDIO) {
        const frame = yield* this.#firstFrame(device, sessionAudioCreateFrameFromWire);
        if (frame === undefined || !(yield* device.isOpen)) {
          return refused(HOSTED_API_ERROR.INVALID_REQUEST);
        }
        return yield* this.#openAudio(upstream, admission, frame);
      }
      const frame = yield* this.#firstFrame(device, sessionOpeningFrameFromWire);
      if (frame === undefined || !(yield* device.isOpen)) {
        return refused(HOSTED_API_ERROR.INVALID_REQUEST);
      }
      return frame.type === VOICE_SERVICE_FRAME.SESSION_ATTACH
        ? yield* this.#openAttached(upstream, admission, frame)
        : yield* this.#openCreated(upstream, admission, frame);
    });
  }

  /**
   * What follows the greeting's append, in the order the Live conversations
   * guide fixes: the acknowledgment is what licenses the cue, because the
   * greeting depends on application instructions and a cue sent ahead of
   * them would ask the model to begin a greeting it has not been given. A
   * refusal is written down by its kind alone, and a wait that runs out
   * leaves the introduction to the caller's own first word rather than
   * cueing a greeting the session may never have taken.
   */
  #greetingSettled(route: VoiceRoute, settled: OpeningSettled): LiveClientEvent | undefined {
    if (settled.outcome === OPENING_OUTCOME.REFUSED) {
      this.#log({
        event: LOG_EVENT.GREETING_REFUSED,
        route,
        errorType: settled.errorType,
        errorCode: settled.errorCode,
      });
      return undefined;
    }
    if (settled.outcome === OPENING_OUTCOME.UNACKNOWLEDGED) {
      this.#log({ event: LOG_EVENT.GREETING_UNACKNOWLEDGED, route });
      return undefined;
    }
    this.#log({ event: LOG_EVENT.GREETING_ACKNOWLEDGED, route });
    this.#log({ event: LOG_EVENT.GREETING_CUED, route });
    return commentaryAppend({
      eventId: randomUUID(),
      delegationId: null,
      content: greetingCue(),
    });
  }

  /**
   * A new session: authorized and spent, created at OpenAI, registered to its
   * account, and attached. The introduction spends the deployment's shared
   * daily ceiling only once its frame has been admitted, as the mint spends
   * only after reading a valid body, so an empty or malformed handshake costs
   * the ceiling nothing.
   */
  #openCreated(
    upstream: LiveUpstream,
    admission: Admission,
    frame: SessionCreateFrame,
  ): SessionEffect<Opened> {
    return Effect.gen({ self: this }, function* () {
      const { route } = admission;
      // The introduction holds no account and names no device, so every
      // refusal on it counts no platform, here and below.
      if (route === VOICE_ROUTE.INTRODUCTION) {
        if (!introductionInputAdmitted(frame)) return refused(HOSTED_API_ERROR.INVALID_REQUEST);
        const introduction = yield* this.#accounts.spendIntroduction();
        if (!introduction.allowed) return refused(HOSTED_API_ERROR.QUOTA_EXHAUSTED);
      } else if (!sessionsInputAdmitted(frame)) {
        return refused(HOSTED_API_ERROR.INVALID_REQUEST);
      }
      const account =
        admission.route === VOICE_ROUTE.INTRODUCTION
          ? undefined
          : yield* this.#admitAccount(admission);
      if (account && "refusal" in account) return account;
      const answer: SessionCreatedFrame = {
        type: VOICE_SERVICE_FRAME.SESSION_CREATED,
        sessionId: "",
        sdpAnswer: "",
        ...(account?.quota === undefined ? undefined : { quota: account.quota }),
      };

      const config = liveSessionConfig({
        scene: route === VOICE_ROUTE.SESSIONS ? LIVE_SCENE.DESKTOP : LIVE_SCENE.INTRODUCTION,
        model: this.#options.model,
        voice: frame.voice,
        input: frame.input,
        clientEvents: RENDERER_CLIENT_EVENTS,
        serverEvents: RENDERER_SERVER_EVENTS,
      });
      const created = yield* upstream.create(config, frame.sdp);
      if (created.outcome !== LIVE_SESSION_OUTCOME.SUCCEEDED) {
        return refused(
          created.outcome === LIVE_SESSION_OUTCOME.HTTP_ERROR &&
            created.status === HTTP_STATUS.TOO_MANY_REQUESTS
            ? HOSTED_API_ERROR.UPSTREAM_THROTTLED
            : HOSTED_API_ERROR.UPSTREAM_ERROR,
          account?.platform,
        );
      }
      answer.sessionId = created.answer.session.id;
      answer.sdpAnswer = created.answer.transport.sdp;
      if (account) {
        yield* this.#record.register({
          userId: account.accountId,
          sessionId: answer.sessionId,
          deviceId: account.deviceId,
        });
      }
      const sideband = yield* this.#attach(upstream, answer.sessionId);
      if (sideband === undefined) {
        return refused(HOSTED_API_ERROR.UPSTREAM_ERROR, account?.platform);
      }
      return {
        sessionId: answer.sessionId,
        accountId: account?.accountId,
        deviceId: account?.deviceId,
        platform: account?.platform,
        started: false,
        sideband,
        held: [],
        answer,
        logEvent: LOG_EVENT.SESSION_CREATED,
      };
    });
  }

  /**
   * A session of the service's own socket, for a device that streams its
   * audio through the service: authorized and spent as a WebRTC session is,
   * then started at OpenAI over a primary socket under the format the device
   * named, and registered to its account under the id `session.started`
   * carried, which is the only place such a session names itself. The door
   * consumes that event, so the session is handed on as started, and what the
   * socket said beside it is handed on with the socket for the consumers to
   * hear first. Nothing is seeded, as the phone seeds nothing.
   */
  #openAudio(
    upstream: LiveUpstream,
    admission: SignedInAdmission,
    frame: SessionAudioCreateFrame,
  ): SessionEffect<Opened> {
    return Effect.gen({ self: this }, function* () {
      const account = yield* this.#admitAccount(admission);
      if ("refusal" in account) return account;
      const opened = yield* upstream.openPrimary(
        livePrimarySessionConfig({
          scene: LIVE_SCENE.DESKTOP,
          model: this.#options.model,
          voice: frame.voice,
          format: frame.format,
        }),
      );
      if (opened.outcome !== LIVE_SESSION_OUTCOME.SUCCEEDED) {
        return refused(
          opened.outcome === LIVE_SESSION_OUTCOME.HTTP_ERROR &&
            opened.status === HTTP_STATUS.TOO_MANY_REQUESTS
            ? HOSTED_API_ERROR.UPSTREAM_THROTTLED
            : HOSTED_API_ERROR.UPSTREAM_ERROR,
          account.platform,
        );
      }
      const { sessionId, socket, held } = opened.session;
      yield* this.#record.register({
        userId: account.accountId,
        sessionId,
        deviceId: account.deviceId,
      });
      const answer: SessionAudioCreatedFrame = {
        type: VOICE_SERVICE_FRAME.SESSION_CREATED,
        sessionId,
        ...(account.quota === undefined ? undefined : { quota: account.quota }),
      };
      return {
        sessionId,
        accountId: account.accountId,
        deviceId: account.deviceId,
        platform: account.platform,
        started: true,
        sideband: socket,
        held,
        answer,
        logEvent: LOG_EVENT.SESSION_CREATED,
      };
    });
  }

  /**
   * A device's handshake as an account, in the order the refusals are
   * cheapest: the bearer resolved, the device it claimed to be read from the
   * rows the account holds, and only then a session spent. A device the
   * account does not hold is refused before the spend, so a claim on someone
   * else's device — a phone naming a Mac's row, or either naming a row of an
   * account that is not its own — costs the claimant nothing and creates
   * nothing; the record's own write checks the same fact again, so a row gone
   * between here and there names no device. The row that was found is also
   * where the platform the log counts this caller by comes from: a claim
   * refused read no row of the account's, so it counts none.
   */
  #admitAccount(
    admission: SignedInAdmission,
  ): Effect.Effect<AdmittedAccount, SessionFailure, SqlClient.SqlClient> {
    return Effect.gen({ self: this }, function* () {
      const accountId = yield* this.#accounts.resolveUserId(admission.bearer);
      if (accountId === undefined) return refused(HOSTED_API_ERROR.INVALID_TOKEN);
      const claimed =
        admission.deviceId === undefined
          ? undefined
          : yield* this.#record.heldDevice({ userId: accountId, deviceId: admission.deviceId });
      if (admission.deviceId !== undefined && claimed === undefined) {
        return refused(HOSTED_API_ERROR.INVALID_REQUEST);
      }
      const platform = claimed?.platform;
      const spend = yield* this.#accounts.spend(accountId);
      if (!spend.allowed) return refused(HOSTED_API_ERROR.QUOTA_EXHAUSTED, platform);
      return { accountId, deviceId: admission.deviceId, platform, quota: spend.quota };
    });
  }

  /**
   * A fresh connection to a session that stands: the bearer's account, and
   * only when the session named was created for that very account. A session
   * this deployment never created, or another account's, is refused as the
   * bearer's own failure rather than as a hint that the id exists. The
   * introduction never re-attaches. What is proven here is the session's
   * owner rather than a device, so no device row is read and nothing this
   * connection logs counts a platform, exactly as its `deviceId` names none.
   */
  #openAttached(
    upstream: LiveUpstream,
    admission: Admission,
    frame: SessionAttachFrame,
  ): SessionEffect<Opened> {
    return Effect.gen({ self: this }, function* () {
      if (admission.route !== VOICE_ROUTE.SESSIONS)
        return refused(HOSTED_API_ERROR.INVALID_REQUEST);
      const accountId = yield* this.#accounts.resolveUserId(admission.bearer);
      if (
        accountId === undefined ||
        !(yield* this.#record.owned({ userId: accountId, sessionId: frame.sessionId }))
      ) {
        return refused(HOSTED_API_ERROR.INVALID_TOKEN);
      }
      const sideband = yield* this.#attach(upstream, frame.sessionId);
      if (sideband === undefined) return refused(HOSTED_API_ERROR.UPSTREAM_ERROR);
      const answer: SessionAttachedFrame = {
        type: VOICE_SERVICE_FRAME.SESSION_ATTACHED,
        sessionId: frame.sessionId,
      };
      return {
        sessionId: frame.sessionId,
        accountId,
        deviceId: undefined,
        platform: undefined,
        started: true,
        sideband,
        held: [],
        answer,
        logEvent: LOG_EVENT.SESSION_ATTACHED,
      };
    });
  }

  /**
   * The sideband as the upstream hands it over: open and paused, since no
   * consumer listens yet and a frame the session speaks before the relay and
   * the exchange register would otherwise be emitted to nobody. `#serve`
   * resumes it once every listener stands, and what arrived meanwhile is read
   * then, in order.
   */
  #attach(
    upstream: LiveUpstream,
    sessionId: string,
  ): Effect.Effect<WebSocket | undefined, never, Scope.Scope> {
    return Effect.catch(upstream.attach(sessionId), () => Effect.succeed(undefined));
  }

  #recordUsage(
    route: VoiceRoute,
    userId: string,
    sessionId: string,
    seconds: number,
  ): Effect.Effect<void, SessionFailure, SqlClient.SqlClient> {
    return Effect.map(this.#accounts.recordSeconds({ userId, sessionId, seconds }), (outcome) => {
      this.#log({ event: LOG_EVENT.USAGE_RECORDED, route, seconds, outcome });
    });
  }

  /** The socket's first frame as the route's reader admits it, or nothing when it was late, closed, or not that shape. */
  #firstFrame<Frame>(
    device: VoiceSocket,
    read: (payload: UnparsedWireValue) => Frame | undefined,
  ): Effect.Effect<Frame | undefined> {
    const timeoutMs = this.#options.firstFrameTimeoutMs ?? SERVICE_DEFAULTS.FIRST_FRAME_TIMEOUT_MS;
    return device.next.pipe(
      Effect.map((frame) => {
        const text = Option.flatMapNullishOr(frame, frameText);
        if (Option.isNone(text)) return undefined;
        const payload = decodeLivePayload(text.value);
        return payload === undefined ? undefined : read(payload);
      }),
      Effect.timeoutOrElse({
        duration: timeoutMs,
        orElse: () => Effect.succeed(undefined),
      }),
    );
  }
}
