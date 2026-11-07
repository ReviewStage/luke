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
 * The first ask opens a socket in the background, under the account's
 * credential as the terminals open theirs (`relay-credential.ts`), and goes
 * over HTTP itself, as does every ask until the socket stands, so no read
 * waits on an open: not at launch, and not on a cold function. A socket
 * takes asks for `ROTATE_AFTER`; the next ask after that goes over HTTP
 * while the next socket opens the same way, and the old one is closed
 * `DRAIN` later, once the asks it holds have been answered, all inside the
 * service function's 800 s bound, so a rotation fails no poll and holds
 * none. Where no socket answers, the polls go over HTTP:
 *
 * - an open refused, reaching nothing, or not done within `OPEN_WITHIN`
 *   sends every ask over HTTP for `HTTP_AFTER_FAILED_OPEN`, as a deployment
 *   serving no socket, such as the local server, does always;
 * - every ask a socket held when it ended early is asked again over HTTP,
 *   so a socket's end is never a poll's failure, nor the service's silence
 *   where the client keeps its reach (`ServiceReach`);
 * - an ask unanswered within its bound (`ANSWER_WITHIN`) takes its socket as
 *   stalled, closes it, and fails, since an HTTP ask then would have too
 *   little of its deadline left to answer: the read's own retry asks again,
 *   on the next socket or over HTTP while that opens;
 * - a 401 closes the socket, whose credential may be one since renewed or
 *   another account's, and asks again over HTTP, where the account call
 *   renews the credential as it does for any request.
 */

import { type CallCredential, readServiceAnswer, webSocketOrigin } from "@repo/features";
import {
  LIVE_POLL,
  LIVE_SOCKET,
  type LiveSocketAnswer,
  type LiveSocketAsk,
  liveSocketAnswerSchema,
} from "@repo/features/live-wire";
import { unparsedWire } from "@repo/wire";
import { Clock, Deferred, Duration, Effect, Exit, Result, Schema, Scope, Stream } from "effect";
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
  /** How long an open may take before it is taken as reaching nothing, so a handshake that hangs holds the next open off for no longer. */
  OPEN_WITHIN: Duration.seconds(10),
  /** How long asks go over HTTP after an open was refused or reached nothing. */
  HTTP_AFTER_FAILED_OPEN: Duration.seconds(30),
  /**
   * How long an ask waits for its answer before its socket is taken as
   * stalled, each shorter than the account call's deadline it travels under
   * (`@repo/features/hosted-link`), or the deadline ends the ask first and
   * the socket is never taken as stalled: a held read's past the service's
   * 25 s hold and inside its 35 s held deadline, any other's inside the
   * usual 10 s.
   */
  ANSWER_WITHIN: {
    HELD: Duration.seconds(30),
    USUAL: Duration.seconds(8),
  },
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

/** Why an ask was never answered: its socket ended first. */
class SocketEnded {
  readonly _tag = "SocketEnded";
}

/** Why an ask was never answered: its socket gave no answer within the ask's bound. */
class SocketStalled {
  readonly _tag = "SocketStalled";
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

/** Whether a live read is one the service holds until its rows move: one past a digest, or past a sync id (`@repo/features/hosted-call`'s `askLiveRead`). */
function isHeldRead(url: URL): boolean {
  return (
    url.searchParams.has(LIVE_POLL.AFTER) || (url.searchParams.get(LIVE_POLL.SYNC) ?? "") !== ""
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
    let current: StandingSocket | undefined;
    let opening = false;
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

    /** A socket opened, with its reader standing; none where the open was refused or reached nothing. */
    const open = Effect.gen(function* () {
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
        openedAt: yield* Clock.currentTimeMillis,
        waiting: new Map(),
        ended: false,
      };
      yield* Effect.forkIn(read(standing), scope);
      return standing;
    });

    /** The next socket, taking asks once it stands; where its open failed, asks go over HTTP for a while. */
    const openNext = Effect.gen(function* () {
      const opened = yield* open;
      if (opened === undefined) {
        const now = yield* Clock.currentTimeMillis;
        httpUntil = now + Duration.toMillis(LIVE_SOCKET_BOUNDS.HTTP_AFTER_FAILED_OPEN);
      }
      current = opened;
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          opening = false;
        }),
      ),
    );

    /**
     * The socket an ask goes over: the current one while it takes asks.
     * Otherwise none, so the ask goes over HTTP, while the old one, past its
     * time, drains, and the next one opens in the background.
     */
    const socketFor = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const standing = current;
      if (
        standing !== undefined &&
        !standing.ended &&
        now - standing.openedAt < Duration.toMillis(LIVE_SOCKET_BOUNDS.ROTATE_AFTER)
      ) {
        return standing;
      }
      if (standing !== undefined) {
        current = undefined;
        yield* Effect.forkIn(Effect.delay(end(standing), LIVE_SOCKET_BOUNDS.DRAIN), scope);
      }
      if (!opening && now >= httpUntil) {
        opening = true;
        yield* Effect.forkIn(openNext, scope);
      }
      return undefined;
    });

    /** One ask over the socket, answered, or failed where the socket ended or stalled first. */
    const ask = (standing: StandingSocket, url: URL) =>
      Effect.gen(function* () {
        const path = `${url.pathname}${url.search}`;
        const id = nextId++;
        const answered = yield* Deferred.make<LiveSocketAnswer, SocketEnded>();
        if (standing.ended) return yield* Effect.fail(new SocketEnded());
        standing.waiting.set(id, answered);
        const asked: LiveSocketAsk = { id, path };
        yield* standing.socket.send({ text: JSON.stringify(asked) });
        const within = isHeldRead(url)
          ? LIVE_SOCKET_BOUNDS.ANSWER_WITHIN.HELD
          : LIVE_SOCKET_BOUNDS.ANSWER_WITHIN.USUAL;
        return yield* Deferred.await(answered).pipe(
          Effect.mapError((): SocketEnded | SocketStalled => new SocketEnded()),
          Effect.timeoutOrElse({
            duration: within,
            orElse: () => Effect.andThen(end(standing), Effect.fail(new SocketStalled())),
          }),
          Effect.ensuring(Effect.sync(() => standing.waiting.delete(id))),
        );
      });

    /**
     * A live read asked over the socket where one answers, and over HTTP
     * where none does, it ended first, or it was refused; failed where it
     * stalled, which the read's own retry asks again.
     */
    const live = (request: HttpClientRequest.HttpClientRequest, url: URL) =>
      Effect.gen(function* () {
        const standing = yield* socketFor;
        if (standing === undefined) return yield* http.execute(request);
        const asked = yield* Effect.result(ask(standing, url));
        if (Result.isSuccess(asked) && asked.success.status !== UNAUTHORIZED) {
          return responseOf(request, asked.success);
        }
        if (Result.isFailure(asked) && asked.failure instanceof SocketStalled) {
          return yield* Effect.fail(
            new HttpClientError.HttpClientError({
              reason: new HttpClientError.TransportError({
                request,
                description: "The live socket gave no answer in time",
              }),
            }),
          );
        }
        yield* end(standing);
        return yield* http.execute(request);
      });

    return HttpClient.make((request, url) =>
      isLiveRead(request, url, serviceOrigin) ? live(request, url) : http.execute(request),
    );
  });
}
