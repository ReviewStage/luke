import { type CallCredential, readServiceAnswer, webSocketOrigin } from "@repo/features";
import {
  LIVE_SOCKET,
  type LiveSocketAnswer,
  type LiveSocketAsk,
  liveSocketAnswerSchema,
} from "@repo/features/live-wire";
import { unparsedWire } from "@repo/wire";
import { Clock, Deferred, Duration, Effect, Exit, Result, Schema, Scope, Stream } from "effect";
import { HttpClient, type HttpClientRequest, HttpClientResponse } from "effect/http";
import type { OpenTerminalSocket, TerminalSocket } from "./compose-terminals.js";
import { openedUnderCredential } from "./relay-credential.js";

const LIVE_SOCKET_BOUNDS = {
  ROTATE_AFTER: Duration.minutes(12),
  DRAIN: Duration.seconds(40),
  OPEN_WITHIN: Duration.seconds(10),
  HTTP_AFTER_FAILED_OPEN: Duration.seconds(30),
  ANSWER_WITHIN: Duration.seconds(30),
} as const;

const UNAUTHORIZED = 401;

const JSON_HEADERS = { "content-type": "application/json" } as const;

const readAnswer = readServiceAnswer(Schema.fromJsonString(liveSocketAnswerSchema));

interface StandingSocket {
  readonly socket: TerminalSocket;
  readonly scope: Scope.Closeable;
  readonly openedAt: number;
  readonly waiting: Map<number, Deferred.Deferred<LiveSocketAnswer, SocketEnded>>;
  ended: boolean;
}

class SocketEnded {
  readonly _tag = "SocketEnded";
}

export interface LiveSocketOptions {
  readonly http: HttpClient.HttpClient;
  readonly openSocket: OpenTerminalSocket;
  readonly credential: CallCredential;
  readonly serviceBaseUrl: string;
}

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

    const read = (standing: StandingSocket) =>
      Stream.runForEach(standing.socket.arrivals, (arrival) => {
        if (!("text" in arrival)) return Effect.void;
        const answer = readAnswer(unparsedWire(arrival.text));
        if (Result.isFailure(answer)) return Effect.void;
        const waiting = standing.waiting.get(answer.success.id);
        standing.waiting.delete(answer.success.id);
        return waiting === undefined ? Effect.void : Deferred.succeed(waiting, answer.success);
      }).pipe(Effect.ensuring(end(standing)));

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

    const live = (request: HttpClientRequest.HttpClientRequest, url: URL) =>
      Effect.gen(function* () {
        const standing = yield* socketFor;
        if (standing === undefined) return yield* http.execute(request);
        const asked = yield* Effect.result(ask(standing, `${url.pathname}${url.search}`));
        if (Result.isSuccess(asked) && asked.success.status !== UNAUTHORIZED) {
          return responseOf(request, asked.success);
        }
        yield* end(standing);
        return yield* http.execute(request);
      });

    return HttpClient.make((request, url) =>
      isLiveRead(request, url, serviceOrigin) ? live(request, url) : http.execute(request),
    );
  });
}
