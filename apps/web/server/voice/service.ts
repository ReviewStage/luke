import { randomUUID } from "node:crypto";
import http, { type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { catchAllButInterrupt } from "@sidecar/runtime/effect";
import { Effect, Exit, FiberSet, type Layer, Scope } from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import type { SqlClient } from "effect/unstable/sql";
import { type WebSocket, WebSocketServer } from "ws";
import {
  HOSTED_API_ERROR,
  type HostedApiError,
  HTTP_STATUS,
  type PlanActivityFrame,
  type PlanCodeFrame,
  type PlanDraftFrame,
  VOICE_SERVICE_FRAME,
} from "../core.js";
import {
  commentaryAppend,
  greetingCue,
  instructionsAppend,
  LIVE_CLIENT_EVENT,
  type LiveClientEvent,
  planningOpeningInstruction,
} from "../live.js";
import type { VoiceAccounts } from "./accounts.js";
import { isVoicePath } from "./frames.js";
import {
  type AttachedSession,
  EXCHANGE_ENDING,
  type ExchangeAttachment,
  type ExchangeEnding,
  type HostedLiveExchange,
} from "./live-exchange.js";
import { FINALIZATION, LOG_EVENT, type Log, standardOutputLog } from "./log.js";
import { createLiveUpstream, type LiveUpstream } from "./openai.js";
import {
  type Admission,
  type SessionEffect,
  type SessionFailure,
  type SessionOpener,
  sessionOpener,
} from "./opening.js";
import { OPENING_OUTCOME, type OpeningSettled, RELAY_DEFAULTS, relaySession } from "./relay.js";
import type { VoiceSessionRecord } from "./session-record.js";
import { SOCKET_CLOSE_CODE, voiceSocket } from "./socket.js";

/**
 * The hosted voice service: the part of Luke's own deployment that holds the
 * GPT Live project key, so it is what creates each hosted session, attaches
 * the trusted sideband, and carries events between a signed-in Mac and
 * OpenAI. It runs as one Vercel Function serving WebSockets, and keeps no
 * conversation and executes nothing: a session's transcript crosses it as
 * bytes it never reads past the `type` field, and what it writes down is
 * status codes and counts.
 *
 * One upgrade stands. `/api/voice/sessions` takes a signed-in Mac under its
 * account bearer, resolved and spent by the same account code every hosted
 * route uses, before any session exists. Every call is about one plan: a
 * call newly created is opened by the service, which sends the planning
 * opening, waits for the acknowledgment that says the model took it, and
 * cues the model to begin, so Luke speaks first.
 *
 * A connection is one function invocation, and the platform closes it at the
 * function's maximum duration. The WebRTC session between the Mac and OpenAI
 * stands on past that: a socket that closes without the Mac's own
 * `session.close` is a detach, which sends nothing upstream and leaves the
 * session standing, and a socket may also open with `session.attach`: the
 * account that created the session, proven by the `voice_sessions` row
 * creation wrote, attaches a fresh sideband to it and the pipe resumes;
 * whatever the session said between the two connections is not replayed.
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
  UNAUTHORIZED: HTTP_STATUS.UNAUTHORIZED,
  /** The handshake carried a browser `Origin`; the caller is no page — the desktop connects from its main process — so it sets none. */
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
 * later carries. The frames a Mac sends are a data channel's — the hang-up,
 * its reports, the opening frame — since the voice itself travels over
 * WebRTC and never over this socket, so a caller past the bound is sending
 * something other than a conversation. Its account is spent per session and
 * answers for what it sends.
 */
export const SOCKET_BYTE_BUDGET = 8 * 1024 * 1024;

/**
 * What the service tells a call to say first, once it starts: the planning
 * opening, since the planning role is to lead and a Live session otherwise
 * waits for the developer's first words. Only a call just created opens; one
 * re-attached opened on its first connection.
 */
function openingInstruction(session: { started: boolean }): string | undefined {
  return session.started ? undefined : planningOpeningInstruction();
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
    response.writeHead(isVoicePath(path) ? UPGRADE_REQUIRED : UPGRADE_STATUS.NOT_FOUND).end();
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

const BEARER_SCHEME = "Bearer ";

export interface VoiceServiceOptions {
  /** The server the service stands on, built where the function module is evaluated. */
  server: VoiceServer;
  /** The GPT Live project key; absent, every upgrade is refused with 503. */
  apiKey: string | undefined;
  model?: string | undefined;
  accounts: VoiceAccounts;
  /** The `voice_sessions` row of each session. */
  record: VoiceSessionRecord;
  /**
   * The hosted exchange to stand on each signed-in session, adopted over the
   * same sideband the relay pipes. The function passes one; absent, as a test
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
  firstFrameTimeoutMs?: number;
}

type UpgradeDecision = Admission | { status: number };

/**
 * The exchange standing on a session, if one was offered, and its stop: the
 * close of the scope it stands in, ending the session as the stop names, or
 * nothing where none stands.
 */
interface StandingExchange {
  readonly exchange: HostedLiveExchange | undefined;
  readonly stop: (ending: ExchangeEnding) => Effect.Effect<void>;
}

const NO_EXCHANGE: StandingExchange = { exchange: undefined, stop: () => Effect.void };

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function presentedBearer(request: IncomingMessage): string | undefined {
  const authorization = headerValue(request.headers.authorization);
  if (authorization === undefined || !authorization.startsWith(BEARER_SCHEME)) return undefined;
  return authorization.slice(BEARER_SCHEME.length).trim().length > 0 ? authorization : undefined;
}

export class VoiceService {
  readonly #options: VoiceServiceOptions;
  readonly #log: Log;
  readonly #accounts: VoiceAccounts;
  readonly #record: VoiceSessionRecord;
  readonly #upstream: LiveUpstream | undefined;
  /** What a socket's first frame opens: the account admitted and spent, the session at OpenAI, the row registered. */
  readonly #opener: SessionOpener;
  readonly #sockets: WebSocketServer;
  /** Every session under way, one fiber each, so a close can wait for each to finalize. */
  readonly #fibers: FiberSet.FiberSet<void>;
  readonly #begin: (session: Effect.Effect<void, never, SqlClient.SqlClient>) => void;

  private constructor(
    options: VoiceServiceOptions,
    upstream: LiveUpstream | undefined,
    sockets: WebSocketServer,
    fibers: FiberSet.FiberSet<void>,
    begin: (session: Effect.Effect<void, never, SqlClient.SqlClient>) => void,
  ) {
    this.#options = options;
    this.#log = options.log ?? standardOutputLog;
    this.#accounts = options.accounts;
    this.#record = options.record;
    this.#upstream = upstream;
    this.#opener = sessionOpener({
      accounts: options.accounts,
      record: options.record,
      model: options.model,
      firstFrameTimeoutMs: options.firstFrameTimeoutMs ?? SERVICE_DEFAULTS.FIRST_FRAME_TIMEOUT_MS,
    });
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
   * the claim and closing every device socket comes first, so each relay
   * detaches, leaving the call to the device's re-attach; the drain waits for
   * those fibers under their own timeouts; and only then does
   * the `ws` server close and the set interrupt whatever the drain left, which
   * is nothing a session that ended left behind.
   */
  static make(
    options: VoiceServiceOptions,
  ): Effect.Effect<VoiceService, never, Scope.Scope | SqlClient.SqlClient> {
    return Effect.gen(function* () {
      const fibers = yield* FiberSet.make<void>();
      // Each session runs over the client the service was built on, so the
      // session's own effect asks for it rather than a runner of its own.
      const fork = yield* FiberSet.runtime(fibers)<SqlClient.SqlClient>();
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
   * socket, and waits for each session's fiber to finalize under its own
   * timeouts. A call is detached rather than ended, since its WebRTC session
   * outlives this instance and the device re-attaches to it on another.
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
    const decision = this.#admit(request, isVoicePath(path));
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
   * describes in a scope of its own, and the `voice_sessions` write that could
   * fail it written down by its event alone. A failure there was an unhandled
   * rejection before this was a fiber, and it says nothing of the session but
   * that one of its own rows did not land.
   */
  #session(
    socket: WebSocket,
    admission: Admission,
  ): Effect.Effect<void, never, SqlClient.SqlClient> {
    return Effect.catch(Effect.scoped(this.#serve(socket, admission)), () =>
      Effect.sync(() => {
        this.#log({ event: LOG_EVENT.SESSION_FAILED });
      }),
    );
  }

  /**
   * A write of the session's own rows that never holds the session up: a
   * failure is written down as the line `#session` writes for the same row,
   * and an interruption is the session ending and passes.
   */
  #written<A, E, R>(write: Effect.Effect<A, E, R>): Effect.Effect<void, never, R> {
    return Effect.asVoid(
      catchAllButInterrupt(write, () =>
        Effect.sync(() => {
          this.#log({ event: LOG_EVENT.SESSION_FAILED });
        }),
      ),
    );
  }

  /** Who an upgrade admits before any socket stands, or the status it is refused with. */
  #admit(request: IncomingMessage, known: boolean): UpgradeDecision {
    if (this.#upstream === undefined) {
      return { status: UPGRADE_STATUS.SERVICE_UNAVAILABLE };
    }
    if (!known) return { status: UPGRADE_STATUS.NOT_FOUND };
    if (request.headers.origin !== undefined) return { status: UPGRADE_STATUS.FORBIDDEN };
    const bearer = presentedBearer(request);
    if (bearer === undefined) return { status: UPGRADE_STATUS.UNAUTHORIZED };
    return { bearer };
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
      const device = yield* voiceSocket(socket, { byteBudget: SOCKET_BYTE_BUDGET });
      yield* Effect.sync(() => socket.resume());
      const refuse = (reason: HostedApiError): Effect.Effect<void> =>
        Effect.gen({ self: this }, function* () {
          this.#log({ event: LOG_EVENT.SESSION_REFUSED, reason });
          if (!(yield* device.isOpen)) return;
          yield* device.send({ text: JSON.stringify({ error: reason }) });
          yield* device.close(SOCKET_CLOSE_CODE.POLICY_VIOLATION, reason);
        });

      const opened = yield* this.#opener.open(upstream, admission, device);
      // A socket opened for a device that has gone is the scope's to
      // release, which it does on the way out of this effect.
      if (!(yield* device.isOpen)) return;
      if ("refusal" in opened) {
        yield* refuse(opened.refusal);
        return;
      }
      const { sessionId, accountId, sideband } = opened;
      // The exchange stands before the device is answered, on the same socket
      // the relay is about to pipe. The socket is paused since the attach, so a
      // frame the session spoke while the exchange stood is read once both
      // consumers listen, by both, in order.
      const standing = yield* this.#attachExchange({
        accountId,
        sessionId,
        planId: opened.planId,
        started: opened.started,
        sideband,
        // The call's plan as its notetaker has it now, sent on a fiber of
        // the service's own set since the exchange reports it from inside
        // its own, so the Plans tab types it in as the call goes on; a
        // device gone by then takes it nowhere.
        onPlanDraft: (draft) => {
          const frame: PlanDraftFrame = {
            type: VOICE_SERVICE_FRAME.PLAN_DRAFT,
            planId: opened.planId,
            document: draft.document,
            ...(draft.savedAt === undefined ? undefined : { savedAt: draft.savedAt }),
          };
          this.#begin(Effect.ignore(device.send({ text: JSON.stringify(frame) })));
        },
        // What each part of Luke is doing, sent the same way, so the
        // Plans tab says the voice's state and the backend's apart.
        onActivity: (activity) => {
          const frame: PlanActivityFrame = {
            type: VOICE_SERVICE_FRAME.PLAN_ACTIVITY,
            planId: opened.planId,
            ...activity,
          };
          this.#begin(Effect.ignore(device.send({ text: JSON.stringify(frame) })));
        },
        // Code Luke is about to talk about, by place, sent the same way, so
        // the Plans tab's code pane draws it from the Mac's own folder as he
        // says it.
        onCode: (ref) => {
          const frame: PlanCodeFrame = {
            type: VOICE_SERVICE_FRAME.PLAN_CODE,
            planId: opened.planId,
            ref,
          };
          this.#begin(Effect.ignore(device.send({ text: JSON.stringify(frame) })));
        },
      });
      if ("refused" in standing) {
        yield* refuse(HOSTED_API_ERROR.UNAVAILABLE);
        return;
      }
      const { exchange, stop: stopExchange } = standing;
      // The device may have gone while the exchange stood: nothing is answered
      // to a socket that is not there, and the exchange ends here rather than
      // being left standing for the invocation. The socket is resumed first,
      // since the exchange's own graceful close waits for a `session.closed` a
      // paused socket would never deliver. A re-attach the device dropped is a
      // detach, as the relay reads one: the session is still the device's to
      // attach to again. A session created for a device that never heard its
      // answer is no one's, and is closed.
      if (!(yield* device.isOpen)) {
        yield* Effect.sync(() => sideband.resume());
        const detached = opened.started;
        yield* stopExchange(detached ? EXCHANGE_ENDING.DETACH : EXCHANGE_ENDING.CLOSE);
        if (detached) yield* this.#written(this.#record.detach({ sessionId }));
        return;
      }
      yield* device.send({ text: JSON.stringify(opened.answer) });
      this.#log({ event: opened.logEvent });

      const pipe = yield* voiceSocket(sideband);
      // Both consumers listen now: what the session spoke since the attach is read here, by both.
      yield* Effect.sync(() => sideband.resume());
      const opening = openingInstruction(opened);
      const summary = yield* relaySession<SqlClient.SqlClient>({
        device,
        upstream: pipe,
        closeTimeoutMs: this.#options.closeTimeoutMs ?? RELAY_DEFAULTS.CLOSE_TIMEOUT_MS,
        openingTimeoutMs: this.#options.greetingTimeoutMs ?? RELAY_DEFAULTS.OPENING_TIMEOUT_MS,
        onSessionStarted:
          opening === undefined
            ? undefined
            : () => {
                this.#log({ event: LOG_EVENT.GREETING_SENT });
                return instructionsAppend({
                  eventId: randomUUID(),
                  delegationId: null,
                  content: opening,
                });
              },
        onOpeningSettled:
          opening === undefined ? undefined : (settled) => this.#greetingSettled(settled),
        onUsageUpdated: (seconds) => this.#written(this.#record.noteUsage({ sessionId, seconds })),
        onSessionClosed: (closed) =>
          this.#written(
            Effect.gen({ self: this }, function* () {
              yield* this.#record.close({
                sessionId,
                seconds: closed.usage.seconds,
                reason: closed.reason,
              });
              yield* this.#recordUsage(accountId, sessionId, closed.usage.seconds);
            }),
          ),
        // The device's reports reach the exchange: its idle, which the
        // exchange decides the idle close on; and its stop, which the exchange
        // answers with the one instruction it appends itself. With no exchange
        // standing a report is read and goes nowhere.
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
                }
              },
        // A call's one close is its exchange's, the same graceful close the
        // idle decision runs, so the device's hang-up and the relay's close on
        // its behalf both ask the exchange for it.
        closeSession: exchange === undefined ? undefined : exchange.service.endSession(),
        onFrameRefused: (type) => {
          this.#log({ event: LOG_EVENT.FRAME_REFUSED, type: knownFrameType(type) });
        },
      });
      // The relay has settled and closed both transports; the exchange ends its
      // follows and its look, closes the session it holds (already gone, which
      // its sideband reports as the close it held), and waits for every record
      // write already started, so no line begun before the settle is cut. A
      // relay that settled detached left the session standing for the
      // device's re-attach, so the exchange lets go of it with nothing said,
      // and the row is stamped so the sweep ends it if no device comes back.
      const detached = summary.finalization === FINALIZATION.DETACHED;
      yield* stopExchange(detached ? EXCHANGE_ENDING.DETACH : EXCHANGE_ENDING.CLOSE);
      if (detached) yield* this.#written(this.#record.detach({ sessionId }));
      this.#log({ event: LOG_EVENT.SESSION_ENDED, ...summary });
    });
  }

  /**
   * The exchange the composition offers for the session, standing on the same
   * socket the relay pipes: none where the composition offers none, or the
   * refusal where one was offered and could not stand, since a session with an
   * exchange offered and none standing would have no one to answer its asks.
   * The attachment builds the sideband and adopts; this service hands it the
   * socket and reaches nothing of the exchange itself. The exchange stands in
   * a scope forked from the session's, so it can be stopped ahead of the
   * session's own close and is closed with the session whatever else happens;
   * one that could not stand has that scope closed here, so nothing the
   * attempt acquired outlives the refusal.
   */
  #attachExchange(
    session: AttachedSession,
  ): Effect.Effect<StandingExchange | { refused: true }, never, Scope.Scope | SqlClient.SqlClient> {
    const attachment = this.#options.exchange;
    if (attachment === undefined) return Effect.succeed(NO_EXCHANGE);
    return Effect.gen({ self: this }, function* () {
      const scope = yield* Scope.fork(yield* Effect.scope);
      const failed = Effect.sync(() => {
        this.#log({ event: LOG_EVENT.EXCHANGE_FAILED });
      });
      // A stop that fails is the service's to report and never the session's
      // to inherit: the refusal, the relay's own ending, and the session's
      // log line all follow it whatever it did.
      const close = Effect.catchCause(Scope.close(scope, Exit.void), () => failed);
      const stood = yield* Effect.exit(Scope.provide(attachment(session), scope));
      if (Exit.isFailure(stood)) {
        yield* Effect.andThen(close, failed);
        return { refused: true } as const;
      }
      const exchange = stood.value;
      if (exchange === undefined) return NO_EXCHANGE;
      this.#log({ event: LOG_EVENT.EXCHANGE_ATTACHED });
      const stop = (ending: ExchangeEnding): Effect.Effect<void> =>
        Effect.andThen(
          Effect.sync(() => exchange.endAs(ending)),
          close,
        );
      return { exchange, stop };
    });
  }

  /**
   * What follows the greeting's append, in the order the Live conversations
   * guide fixes: the acknowledgment is what licenses the cue, because the
   * greeting depends on application instructions and a cue sent ahead of
   * them would ask the model to begin a greeting it has not been given. A
   * refusal is written down by its kind alone, and a wait that runs out
   * leaves the call to the developer's own first word rather than cueing an
   * opening the session may never have taken.
   */
  #greetingSettled(settled: OpeningSettled): LiveClientEvent | undefined {
    if (settled.outcome === OPENING_OUTCOME.REFUSED) {
      this.#log({
        event: LOG_EVENT.GREETING_REFUSED,
        errorType: settled.errorType,
        errorCode: settled.errorCode,
      });
      return undefined;
    }
    if (settled.outcome === OPENING_OUTCOME.UNACKNOWLEDGED) {
      this.#log({ event: LOG_EVENT.GREETING_UNACKNOWLEDGED });
      return undefined;
    }
    this.#log({ event: LOG_EVENT.GREETING_ACKNOWLEDGED });
    this.#log({ event: LOG_EVENT.GREETING_CUED });
    return commentaryAppend({
      eventId: randomUUID(),
      delegationId: null,
      content: greetingCue(),
    });
  }

  #recordUsage(
    userId: string,
    sessionId: string,
    seconds: number,
  ): Effect.Effect<void, SessionFailure, SqlClient.SqlClient> {
    return Effect.map(this.#accounts.recordSeconds({ userId, sessionId, seconds }), (outcome) => {
      this.#log({ event: LOG_EVENT.USAGE_RECORDED, seconds, outcome });
    });
  }
}
