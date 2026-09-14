import type { IncomingMessage } from "node:http";
import { readEither } from "@sidecar/wire/effect";
import { Data, Deferred, Effect, Exit, type Layer, Result, type Scope } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import { type RawData, WebSocket } from "ws";
import {
  accountCall,
  callAnswered,
  EXCESS_KEYS,
  fixedBearer,
  HTTP_METHOD,
  withoutTrailingSlash,
} from "../core.js";
import {
  LIVE_SERVER_EVENT,
  LIVE_SESSION_OUTCOME,
  LIVE_SESSIONS_PATH,
  type LiveCreateAnswer,
  type LivePrimarySessionConfig,
  type LiveSessionConfig,
  liveAttachPath,
  liveCreateAnswerSchema,
  liveCreateRequest,
  liveStartRequest,
  parseLiveServerEvent,
} from "../live.js";
import { SOCKET_CLOSE_CODE } from "./socket.js";

/**
 * How the service reaches OpenAI on Luke's project key: the one POST that
 * creates a WebRTC session from the device's offer, the one socket that
 * attaches this service's sideband to it, and the one socket that is a
 * session itself, for a device that has no WebRTC of its own and streams its
 * audio through the service instead. The key travels as the bearer on all
 * three and nowhere else; a failure is answered as an outcome name and a
 * status, never as an error whose words could carry the key.
 *
 * All three answer effects the session's own scope runs. Both sockets are
 * acquired in that scope, so a session refused after the socket stood, or a
 * fiber interrupted while the handshake was still open, leaves no socket
 * standing: the scope's close resumes it — a paused socket cannot complete its
 * close handshake — and closes it.
 */

const OPENAI_DEFAULTS = {
  BASE_URL: "https://api.openai.com/v1",
  CREATE_TIMEOUT_MS: 15_000,
  ATTACH_TIMEOUT_MS: 15_000,
  PRIMARY_TIMEOUT_MS: 15_000,
} as const;

/**
 * The name a fault of the door's own is reported by, where there is no error
 * object to take one from: the wait that ran out, which is what a call's own
 * deadline reports too, and an HTTP answer that carried no status.
 */
const PRIMARY_FAULT_NAME = {
  DEADLINE: "TimeoutError",
  NO_STATUS: "UnexpectedResponse",
} as const;

type LiveCreateResult =
  | { outcome: typeof LIVE_SESSION_OUTCOME.SUCCEEDED; answer: LiveCreateAnswer }
  | { outcome: typeof LIVE_SESSION_OUTCOME.HTTP_ERROR; status: number }
  | { outcome: typeof LIVE_SESSION_OUTCOME.NETWORK_ERROR; errorName: string | undefined }
  | { outcome: typeof LIVE_SESSION_OUTCOME.MALFORMED_RESPONSE };

/**
 * A started session whose primary socket this service holds: the id
 * `session.started` carried, which is the only place a session created this
 * way names itself and so what the record's row is written from; the socket,
 * open and paused; and the frames that arrived with the handshake's own flush
 * ahead of the caller's consumers.
 */
interface LivePrimarySession {
  sessionId: string;
  socket: WebSocket;
  /**
   * Every text frame taken from the socket other than `session.started`
   * itself, in the order it arrived. Reading that one event means resuming the
   * socket, and `ws` emits every frame of one chunk in the same tick, so a
   * frame beside it would otherwise reach nobody at all: the caller hands
   * these to its consumers before resuming and reads the rest from the socket.
   */
  held: readonly string[];
}

type LivePrimaryResult =
  | { outcome: typeof LIVE_SESSION_OUTCOME.SUCCEEDED; session: LivePrimarySession }
  | { outcome: typeof LIVE_SESSION_OUTCOME.HTTP_ERROR; status: number }
  | { outcome: typeof LIVE_SESSION_OUTCOME.NETWORK_ERROR; errorName: string | undefined }
  | { outcome: typeof LIVE_SESSION_OUTCOME.MALFORMED_RESPONSE };

/** Every way a primary open ends other than with a session standing. */
type LivePrimaryRefusal = Exclude<
  LivePrimaryResult,
  { outcome: typeof LIVE_SESSION_OUTCOME.SUCCEEDED }
>;

/** The sideband did not stand: the handshake was refused, failed, or ran past its wait. */
class SidebandNotAttached extends Data.TaggedError("SidebandNotAttached") {}

export interface LiveUpstreamOptions {
  apiKey: string;
  /** The API's `/v1` base; a test points it at a fake. Both sockets derive from the same base. */
  baseUrl?: string | undefined;
  httpClient?: Layer.Layer<HttpClient.HttpClient> | undefined;
  createTimeoutMs?: number | undefined;
  attachTimeoutMs?: number | undefined;
  primaryTimeoutMs?: number | undefined;
}

export interface LiveUpstream {
  create(config: LiveSessionConfig, sdpOffer: string): Effect.Effect<LiveCreateResult>;
  /**
   * The sideband open and paused in the caller's scope, so nothing it speaks
   * is emitted before every consumer listens; the caller resumes it once they
   * do, and reads then what arrived meanwhile.
   */
  attach(sessionId: string): Effect.Effect<WebSocket, SidebandNotAttached, Scope.Scope>;
  /**
   * A session of the socket's own: the document sent as the socket's first
   * message and the id the service answers with read off `session.started`.
   * The socket is answered open and paused, on the same terms `attach` answers
   * one, and is the caller's to relay audio over.
   */
  openPrimary(
    config: LivePrimarySessionConfig,
  ): Effect.Effect<LivePrimaryResult, never, Scope.Scope>;
}

const WS_PROTOCOL = { SECURE: "wss:", PLAIN: "ws:", PLAIN_HTTP: "http:" } as const;

/** The `wss` address of a path under the same base a session is created at. */
function socketAddress(baseUrl: string, path: string): string {
  const url = new URL(`${withoutTrailingSlash(baseUrl)}${path}`);
  url.protocol = url.protocol === WS_PROTOCOL.PLAIN_HTTP ? WS_PROTOCOL.PLAIN : WS_PROTOCOL.SECURE;
  return url.toString();
}

/**
 * Resumed first, since a paused socket cannot complete its close handshake,
 * and only where a socket stood at all: `ws` leaves a handshake it refused
 * with no reader to resume, and reading one is how a refusal used to end in a
 * defect thrown from inside a finalizer.
 */
function leaveSocket(socket: WebSocket): void {
  if (socket.readyState === WebSocket.OPEN) socket.resume();
  socket.close(SOCKET_CLOSE_CODE.GOING_AWAY);
}

/**
 * An HTTP answer where a socket was expected, read for its status alone. A
 * status is what the client answered with, so an answer carrying none never
 * reached the API at all and is read as the fault it is.
 */
function refusedBy(response: IncomingMessage): LivePrimaryRefusal {
  return response.statusCode === undefined
    ? { outcome: LIVE_SESSION_OUTCOME.NETWORK_ERROR, errorName: PRIMARY_FAULT_NAME.NO_STATUS }
    : { outcome: LIVE_SESSION_OUTCOME.HTTP_ERROR, status: response.statusCode };
}

const DEADLINE_PASSED: LivePrimaryRefusal = {
  outcome: LIVE_SESSION_OUTCOME.NETWORK_ERROR,
  errorName: PRIMARY_FAULT_NAME.DEADLINE,
};

/** The socket answered nothing that starts a session: an `error` event, or a close before one. */
const NOTHING_STARTED: LivePrimaryRefusal = {
  outcome: LIVE_SESSION_OUTCOME.MALFORMED_RESPONSE,
};

export function createLiveUpstream(options: LiveUpstreamOptions): LiveUpstream {
  const baseUrl = options.baseUrl ?? OPENAI_DEFAULTS.BASE_URL;
  const credential = fixedBearer(options.apiKey);
  const call = accountCall({
    baseUrl,
    credential,
    requestTimeoutMs: options.createTimeoutMs ?? OPENAI_DEFAULTS.CREATE_TIMEOUT_MS,
  });
  const client = options.httpClient ?? FetchHttpClient.layer;
  const attachTimeoutMs = options.attachTimeoutMs ?? OPENAI_DEFAULTS.ATTACH_TIMEOUT_MS;
  const primaryTimeoutMs = options.primaryTimeoutMs ?? OPENAI_DEFAULTS.PRIMARY_TIMEOUT_MS;

  /** One socket under the key, acquired in the caller's scope and closed at its close. */
  const socketTo = (address: string): Effect.Effect<WebSocket, never, Scope.Scope> =>
    Effect.gen(function* () {
      const authorization = credential.authorization && (yield* credential.authorization());
      return yield* Effect.acquireRelease(
        Effect.sync(
          () =>
            new WebSocket(address, {
              headers: authorization === undefined ? {} : { authorization },
              followRedirects: false,
            }),
        ),
        (open) => Effect.sync(() => leaveSocket(open)),
      );
    });

  return {
    create: (config, sdpOffer) =>
      Effect.gen(function* () {
        const answer = yield* call.send({
          method: HTTP_METHOD.POST,
          path: LIVE_SESSIONS_PATH,
          body: JSON.stringify(liveCreateRequest(config, sdpOffer)),
        });
        if (!callAnswered(answer)) {
          return { outcome: LIVE_SESSION_OUTCOME.NETWORK_ERROR, errorName: answer.errorName };
        }
        if (!answer.response.ok) {
          return { outcome: LIVE_SESSION_OUTCOME.HTTP_ERROR, status: answer.response.status };
        }
        const payload = yield* Effect.orElseSucceed(
          Effect.tryPromise(() => answer.response.json()),
          () => undefined,
        );
        // The provider names more of a created session than the two fields
        // this build reads, so the read drops what it does not name.
        const created = Result.getOrUndefined(
          readEither(liveCreateAnswerSchema, { excess: EXCESS_KEYS.DROP })(payload),
        );
        return created
          ? { outcome: LIVE_SESSION_OUTCOME.SUCCEEDED, answer: created }
          : { outcome: LIVE_SESSION_OUTCOME.MALFORMED_RESPONSE };
      }).pipe(Effect.provide(client)),

    attach: (sessionId) =>
      Effect.gen(function* () {
        const socket = yield* socketTo(socketAddress(baseUrl, liveAttachPath(sessionId)));
        yield* Effect.callback<void, SidebandNotAttached>((resume) => {
          socket.once("open", () => {
            // Paused here, inside the open handler, and not by the caller: the
            // bytes that followed the handshake response are re-queued on the
            // stream and flushed on the next tick, which runs before any fiber
            // continuation, so a frame in that same chunk would otherwise be
            // emitted to nobody.
            socket.pause();
            resume(Effect.void);
          });
          socket.once("error", () => resume(Effect.fail(new SidebandNotAttached())));
          socket.once("unexpected-response", () => resume(Effect.fail(new SidebandNotAttached())));
        }).pipe(
          Effect.timeoutOrElse({
            duration: attachTimeoutMs,
            orElse: () => Effect.fail(new SidebandNotAttached()),
          }),
        );
        return socket;
      }),

    openPrimary: (config) =>
      Effect.gen(function* () {
        const socket = yield* socketTo(socketAddress(baseUrl, LIVE_SESSIONS_PATH));
        const opened = yield* Effect.callback<{ open: true } | LivePrimaryRefusal>((resume) => {
          socket.once("open", () => {
            // Paused inside the open handler for the reason `attach` pauses
            // there: nothing this socket says may be emitted before something
            // is listening for it.
            socket.pause();
            resume(Effect.succeed({ open: true }));
          });
          socket.once("error", (error) =>
            resume(
              Effect.succeed({
                outcome: LIVE_SESSION_OUTCOME.NETWORK_ERROR,
                errorName: error.name,
              }),
            ),
          );
          socket.once("unexpected-response", (_request, response) =>
            resume(Effect.succeed(refusedBy(response))),
          );
        }).pipe(
          Effect.timeoutOrElse({
            duration: primaryTimeoutMs,
            orElse: () => Effect.succeed(DEADLINE_PASSED),
          }),
        );
        if (!("open" in opened)) return yield* refuse(socket, opened);

        const held: string[] = [];
        const started = yield* Deferred.make<{ sessionId: string } | LivePrimaryRefusal>();
        let answered = false;
        // The reader stands while the socket is paused, so nothing can have
        // been emitted before it, and it stays for the socket's life: `ws`
        // emits every frame of one chunk in one tick, so the frames behind
        // `session.started` in that chunk arrive after the pause below and
        // before any fiber runs. It holds what it takes while the socket is
        // paused and takes nothing once the caller has resumed it.
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            const onMessage = (data: RawData, isBinary: boolean) => {
              // The API speaks JSON text on this socket; audio is base64
              // inside it, so a binary frame is nothing this session said.
              if (isBinary) return;
              const text = data.toString();
              if (answered) {
                if (socket.isPaused) held.push(text);
                return;
              }
              const event = parseLiveServerEvent(text);
              if (event?.type === LIVE_SERVER_EVENT.SESSION_STARTED) {
                answered = true;
                socket.pause();
                Deferred.doneUnsafe(started, Exit.succeed({ sessionId: event.session.id }));
                return;
              }
              if (event?.type === LIVE_SERVER_EVENT.ERROR) {
                answered = true;
                Deferred.doneUnsafe(started, Exit.succeed(NOTHING_STARTED));
                return;
              }
              held.push(text);
            };
            const onClose = () => {
              answered = true;
              Deferred.doneUnsafe(started, Exit.succeed(NOTHING_STARTED));
            };
            socket.on("message", onMessage);
            socket.once("close", onClose);
            return { onMessage, onClose };
          }),
          ({ onMessage, onClose }) =>
            Effect.sync(() => {
              socket.off("message", onMessage);
              socket.off("close", onClose);
            }),
        );

        yield* Effect.sync(() => {
          socket.send(JSON.stringify(liveStartRequest(config)));
          socket.resume();
        });
        const answer = yield* Deferred.await(started).pipe(
          Effect.timeoutOrElse({
            duration: primaryTimeoutMs,
            orElse: () => Effect.succeed(DEADLINE_PASSED),
          }),
        );
        // `Deferred.doneUnsafe` can resume this fiber on the very stack the
        // frame it settled on was emitted from, and the frames behind
        // `session.started` in that chunk are emitted after it: the handover
        // waits for that stack to unwind, so what the reader held is whole.
        yield* Effect.yieldNow;
        if (!("sessionId" in answer)) return yield* refuse(socket, answer);
        return {
          outcome: LIVE_SESSION_OUTCOME.SUCCEEDED,
          session: { sessionId: answer.sessionId, socket, held },
        };
      }),
  };
}

/**
 * A primary open that did not stand leaves nothing of itself: the socket goes
 * here rather than at the caller's scope close, since a socket standing on
 * Luke's key past the refusal that decided nothing would be a session's cost
 * with no session. The scope's own close finds it closed and takes that as
 * nothing.
 */
function refuse(socket: WebSocket, refusal: LivePrimaryRefusal): Effect.Effect<LivePrimaryResult> {
  return Effect.sync(() => {
    leaveSocket(socket);
    return refusal;
  });
}
