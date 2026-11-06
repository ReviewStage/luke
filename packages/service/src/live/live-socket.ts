import type { IncomingHttpHeaders } from "node:http";
import {
  LIVE_SOCKET,
  type LiveSocketAnswer,
  type LiveSocketAsk,
  liveSocketAskSchema,
} from "@repo/features/live-wire";
import { readEither } from "@repo/wire/effect";
import { type Cause, type Context, Effect, FiberSet, Option, Result, type Scope } from "effect";
import { CREDENTIAL_HEADER } from "../auth/session-credential.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { jsonOf } from "../http/http-effect.js";
import {
  RELAY_UPGRADE_STATUS,
  type RelayCredential,
  type RelayServer,
  relayCredential,
  relayServer,
  standRelay,
} from "../http/relay-upgrade.js";
import { SOCKET_CLOSE_CODE, type VoiceFrame, type VoiceSocket } from "../http/socket.js";
import type { HostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";

const MAXIMUM_FRAME_BYTES = 64 * 1024;

const MAXIMUM_OPEN_ASKS = 128;

const readAsk = readEither(liveSocketAskSchema);

function askOf(frame: VoiceFrame): LiveSocketAsk | undefined {
  if (!("text" in frame)) return undefined;
  const read = readAsk(jsonOf(frame.text));
  return Result.isSuccess(read) ? read.success : undefined;
}

function credentialHeaders(credential: RelayCredential): Headers {
  return "bearer" in credential
    ? new Headers({ [CREDENTIAL_HEADER.AUTHORIZATION]: credential.bearer })
    : new Headers(credential.page);
}

export interface LiveSocketAnswerer {
  readonly fetch: HostedFetch;
  readonly services: Context.Context<WebServices>;
  readonly origin: string;
}

function answerAsk(
  ask: LiveSocketAsk,
  headers: Headers,
  answerer: LiveSocketAnswerer,
): Effect.Effect<LiveSocketAnswer> {
  return Effect.tryPromise(async (signal) => {
    const request = new Request(new URL(ask.path, answerer.origin), {
      method: "GET",
      headers,
      signal,
    });
    const response = await answerer.fetch(request, answerer.services);
    return { id: ask.id, status: response.status, body: await response.text() };
  }).pipe(
    Effect.orElseSucceed(() => ({
      id: ask.id,
      status: HOSTED_HTTP_STATUS.INTERNAL_ERROR,
      body: "",
    })),
  );
}

export function answerLiveSocket(
  socket: VoiceSocket,
  credential: RelayCredential,
  answerer: LiveSocketAnswerer,
): Effect.Effect<void, never, Scope.Scope> {
  return Effect.gen(function* () {
    const asks = yield* FiberSet.make<void>();
    const headers = credentialHeaders(credential);
    while (true) {
      const frame = yield* socket.next;
      if (Option.isNone(frame)) return;
      const ask = askOf(frame.value);
      if (ask === undefined || (yield* FiberSet.size(asks)) >= MAXIMUM_OPEN_ASKS) {
        return yield* socket.close(SOCKET_CLOSE_CODE.POLICY_VIOLATION);
      }
      yield* FiberSet.run(
        asks,
        Effect.flatMap(answerAsk(ask, headers, answerer), (answer) =>
          socket.send({ text: JSON.stringify(answer) }),
        ),
      );
    }
  });
}

export function admitLiveSocketUpgrade(
  url: string | undefined,
  headers: IncomingHttpHeaders,
  ownOrigins: ReadonlySet<string>,
): { readonly status: number } | RelayCredential {
  const address = new URL(url ?? "/", "http://localhost");
  if (address.pathname !== LIVE_SOCKET.PATH) return { status: RELAY_UPGRADE_STATUS.NOT_FOUND };
  return relayCredential(headers, ownOrigins);
}

export function liveSocketServer(): RelayServer {
  return relayServer(LIVE_SOCKET.PATH);
}

export interface LiveSocketOptions {
  readonly server: RelayServer;
  readonly ownOrigins: ReadonlySet<string>;
  readonly resolveUserId: (
    credential: RelayCredential,
  ) => Effect.Effect<Option.Option<string>, Cause.UnknownError>;
  readonly fetch: HostedFetch;
  readonly origin: string;
}

export function standLiveSocket(
  options: LiveSocketOptions,
): Effect.Effect<void, never, Scope.Scope | WebServices> {
  return Effect.gen(function* () {
    const answerer = {
      fetch: options.fetch,
      services: yield* Effect.context<WebServices>(),
      origin: options.origin,
    };
    yield* standRelay({
      server: options.server,
      sockets: { maxPayload: MAXIMUM_FRAME_BYTES },
      admit: (request) => admitLiveSocketUpgrade(request.url, request.headers, options.ownOrigins),
      accept: (credential): Effect.Effect<{ readonly status: number } | RelayCredential> =>
        Effect.match(options.resolveUserId(credential), {
          onFailure: () => ({ status: RELAY_UPGRADE_STATUS.SERVICE_UNAVAILABLE }),
          onSuccess: (account) =>
            Option.isNone(account) ? { status: RELAY_UPGRADE_STATUS.UNAUTHORIZED } : credential,
        }),
      relay: (credential, socket) => answerLiveSocket(socket, credential, answerer),
    });
  });
}
