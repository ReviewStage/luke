/**
 * live-socket.ts -- the host's live polls sent over one WebSocket to the service rather than one held request each: an `HttpClient` that asks each live read's GET over the socket and answers it as the response its poll would have had, and passes everything else on.
 *
 * Every composer reads the service through the ambient `HttpClient`, and a
 * live read is one GET under `LIVE_SOCKET.READ_PREFIX`, so the socket stands
 * under that client rather than beside the reads: an ask is the GET's own
 * path and query, and its answer is the status and body the service's
 * procedure answered (`@repo/features/live-wire`'s `LIVE_SOCKET`), built
 * back into a response, so nothing above here knows which way a poll went.
 * A write, and any other request, goes over HTTP unchanged.
 *
 * The socket is opened on the first ask, under the account's credential as
 * the terminals open theirs (`relay-credential.ts`). It takes new asks for
 * `ROTATE_AFTER`, then the next ask opens another, and the old one is closed
 * `DRAIN` later, once the asks it holds have been answered, all inside the
 * service function's 800 s bound, so a rotation fails no poll. Where no
 * socket answers, the polls go over HTTP:
 *
 * - an open refused, reaching nothing, or not done within `OPEN_WITHIN`
 *   sends every ask over HTTP for `HTTP_AFTER_FAILED_OPEN`, as a deployment
 *   serving no socket, such as the local server, does always;
 * - an ask unanswered within `ANSWER_WITHIN` takes its socket as stalled
 *   and closes it, and fails, as does every ask a socket held when it ended,
 *   which the read answers as any poll that failed in transport;
 * - a 401 closes the socket, whose credential may be one since renewed or
 *   another account's, and asks again over HTTP, where the account call
 *   renews the credential as it does for any request.
 */

import { type CallCredential, readServiceAnswer, webSocketOrigin } from "@repo/features";
import {
  LIVE_SOCKET,
  type LiveSocketAnswer,
  type LiveSocketAsk,
  liveSocketAnswerSchema,
} from "@repo/features/live-wire";
import { unparsedWire } from "@repo/wire";
import {
  Clock,
  Deferred,
  Duration,
  Effect,
  Exit,
  Result,
  Schema,
  Scope,
  Semaphore,
  Stream,
} from "effect";
import {
  HttpClient,
  HttpClientError,
  type HttpClientRequest,
  HttpClientResponse,
} from "effect/http";
import type { OpenTerminalSocket, TerminalSocket } from "./compose-terminals.js";
import { openedUnderCredential } from "./relay-credential.js";

/** How long each socket and each ask is given, by what bounds it. */
const LIVE_SOCKET_BOUNDS = {
  /** How long a socket takes new asks; with `DRAIN` after it, inside the service function's 800 s bound. */
  ROTATE_AFTER: Duration.minutes(12),
  /** How long a socket no longer taking asks stays open for the ones it holds: past the service's 25 s hold. */
  DRAIN: Duration.seconds(40),
  /** How long an open may take before it is taken as reaching nothing, so a handshake that hangs holds no read for long. */
  OPEN_WITHIN: Duration.seconds(10),
  /** How long asks go over HTTP after an open was refused or reached nothing. */
  HTTP_AFTER_FAILED_OPEN: Duration.seconds(30),
  /** How long an ask waits for its answer before its socket is taken as stalled: past the service's 25 s hold. */
  ANSWER_WITHIN: Duration.seconds(30),
} as const;

const UNAUTHORIZED = 401;

const JSON_HEADERS = { "content-type": "application/json" } as const;

const readAnswer = readServiceAnswer(Schema.fromJsonString(liveSocketAnswerSchema));

/** One socket as it stands: what it was opened at, the asks it holds by id, and whether it ended. */
interface StandingSocket {
  readonly socket: TerminalSocket;
  readonly scope: Scope.Closeable;
  readonly openedAt: number;
  readonly waiting: Map<number, Deferred.Deferred<LiveSocketAnswer, SocketEnded>>;
  ended: boolean;
}

/** Why an ask was never answered: its socket ended, or stalled, first. */
class SocketEnded {
  readonly _tag = "SocketEnded";
}

/** What the wrapper is handed: the client it passes everything else to, how sockets open, and the account and service they open on. */
export interface LiveSocketOptions {
  readonly http: HttpClient.HttpClient;
  readonly openSocket: OpenTerminalSocket;
  readonly credential: CallCredential;
  readonly serviceBaseUrl: string;
}

/** Whether a request is a live read's GET to the service, which is what a socket asks. */
function isLiveRead(
  request: HttpClientRequest.HttpClientRequest,
  url: URL,
  serviceOrigin: string,
): boolean {
  return (
    request.method === "GET" &&
    url.origin === serviceOrigin &&
    url.pathname.startsWith(LIVE_SOCKET.READ_PREFIX)
  );
}

/** A poll's answer as the response its HTTP poll would have been: its status, and its JSON body where it has one. */
function responseOf(
  request: HttpClientRequest.HttpClientRequest,
  answer: LiveSocketAnswer,
): HttpClientResponse.HttpClientResponse {
  const response =
    answer.body === ""
      ? new Response(null, { status: answer.status })
      : new Response(answer.body, { status: answer.status, headers: JSON_HEADERS });
  return HttpClientResponse.fromWeb(request, response);
}

/** An ask its socket never answered, as the transport failure a request that reached nothing is. */
function unanswered(request: HttpClientRequest.HttpClientRequest): HttpClientError.HttpClientError {
  return new HttpClientError.HttpClientError({
    reason: new HttpClientError.TransportError({
      request,
      description: "the live socket ended before it answered",
    }),
  });
}

/**
 * The client every composer reads the service through, with each live read
 * asked over one socket at a time (`live-socket.ts`'s header), standing for
 * the scope it is built in: its close closes every socket.
 */
export function liveSocketClient(
  options: LiveSocketOptions,
): Effect.Effect<HttpClient.HttpClient, never, Scope.Scope> {
  return Effect.gen(function* () {
    const { http } = options;
    const socketOrigin = webSocketOrigin(options.serviceBaseUrl);
    if (socketOrigin === undefined) return http;
    const serviceOrigin = new URL(options.serviceBaseUrl).origin;
    const address = `${socketOrigin}${LIVE_SOCKET.PATH}`;
    const scope = yield* Effect.scope;
    const opening = yield* Semaphore.make(1);
    let current: StandingSocket | undefined;
    let httpUntil = 0;
    let nextId = 0;

    /** The socket ended: every ask it holds failed, and it closed. */
    const end = (standing: StandingSocket) =>
      Effect.gen(function* () {
        if (standing.ended) return;
        standing.ended = true;
        if (current === standing) current = undefined;
        for (const waiting of standing.waiting.values()) {
          yield* Deferred.fail(waiting, new SocketEnded());
        }
        standing.waiting.clear();
        yield* Scope.close(standing.scope, Exit.void);
      });

    /** Each answer the socket carries handed to the ask it names, until the socket ends. */
    const read = (standing: StandingSocket) =>
      Stream.runForEach(standing.socket.arrivals, (arrival) => {
        if (!("text" in arrival)) return Effect.void;
        const answer = readAnswer(unparsedWire(arrival.text));
        if (Result.isFailure(answer)) return Effect.void;
        const waiting = standing.waiting.get(answer.success.id);
        standing.waiting.delete(answer.success.id);
        return waiting === undefined ? Effect.void : Deferred.succeed(waiting, answer.success);
      }).pipe(Effect.ensuring(end(standing)));

    /** A socket opened now, with its reader standing; none where the open was refused or reached nothing. */
    const open = (now: number) =>
      Effect.gen(function* () {
        const socketScope = yield* Scope.fork(scope);
        const opened = yield* Scope.provide(
          openedUnderCredential(options.credential, options.openSocket, address).pipe(
            Effect.timeoutOrElse({
              duration: LIVE_SOCKET_BOUNDS.OPEN_WITHIN,
              orElse: () => Effect.succeed({ unreachable: true } as const),
            }),
          ),
          socketScope,
        );
        if (!("socket" in opened)) {
          yield* Scope.close(socketScope, Exit.void);
          return undefined;
        }
        const standing: StandingSocket = {
          socket: opened.socket,
          scope: socketScope,
          openedAt: now,
          waiting: new Map(),
          ended: false,
        };
        yield* Effect.forkIn(read(standing), scope);
        return standing;
      });

    /**
     * The socket an ask goes over: the current one while it takes asks,
     * otherwise a new one, the old one closed once it has drained; none
     * while asks go over HTTP.
     */
    const socketFor = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      if (now < httpUntil) return undefined;
      const standing = current;
      if (standing !== undefined) {
        if (now - standing.openedAt < Duration.toMillis(LIVE_SOCKET_BOUNDS.ROTATE_AFTER)) {
          return standing;
        }
        current = undefined;
        yield* Effect.forkIn(Effect.delay(end(standing), LIVE_SOCKET_BOUNDS.DRAIN), scope);
      }
      const opened = yield* open(now);
      if (opened === undefined) {
        httpUntil = now + Duration.toMillis(LIVE_SOCKET_BOUNDS.HTTP_AFTER_FAILED_OPEN);
      }
      current = opened;
      return opened;
    });

    /** One ask over the socket, answered, or failed where the socket ended or stalled first. */
    const ask = (standing: StandingSocket, path: string) =>
      Effect.gen(function* () {
        const id = nextId++;
        const answered = yield* Deferred.make<LiveSocketAnswer, SocketEnded>();
        if (standing.ended) return yield* Effect.fail(new SocketEnded());
        standing.waiting.set(id, answered);
        const asked: LiveSocketAsk = { id, path };
        yield* standing.socket.send({ text: JSON.stringify(asked) });
        return yield* Deferred.await(answered).pipe(
          Effect.timeoutOrElse({
            duration: LIVE_SOCKET_BOUNDS.ANSWER_WITHIN,
            orElse: () => Effect.andThen(end(standing), Effect.fail(new SocketEnded())),
          }),
          Effect.ensuring(Effect.sync(() => standing.waiting.delete(id))),
        );
      });

    /** A live read asked over the socket where one answers, and over HTTP where none does or it was refused. */
    const live = (request: HttpClientRequest.HttpClientRequest, url: URL) =>
      Effect.gen(function* () {
        const standing = yield* opening.withPermits(1)(socketFor);
        if (standing === undefined) return yield* http.execute(request);
        const answer = yield* Effect.mapError(ask(standing, `${url.pathname}${url.search}`), () =>
          unanswered(request),
        );
        if (answer.status !== UNAUTHORIZED) return responseOf(request, answer);
        yield* end(standing);
        return yield* http.execute(request);
      });

    return HttpClient.make((request, url) =>
      isLiveRead(request, url, serviceOrigin) ? live(request, url) : http.execute(request),
    );
  });
}
