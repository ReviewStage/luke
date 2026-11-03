/**
 * live-socket.ts -- the live reads over one WebSocket per host: each ask one poll, named by the path its HTTP poll would GET and answered by the same procedures under the socket's own credential.
 *
 * A signed-in host opens one socket and sends every live poll over it,
 * rather than holding one request per read. There is no subscription and no
 * dispatch of our own: an ask names the path and query of the poll
 * (`live-wire.ts`'s `LIVE_SOCKET`), which is built into a `Request` on the
 * deployment's own origin and answered by the hosted router's fetch over the
 * live procedures, so its status and body are the HTTP poll's, byte for
 * byte, its hold and its wakes among them.
 *
 * An upgrade is refused before any socket stands where it is not this
 * path, or carries neither credential the relays take
 * (`http/relay-upgrade.ts`): the desktop's bearer with no `Origin`, or the
 * session cookie of a page on one of the deployment's own origins. Then its
 * account is resolved once, and an upgrade nobody answers for is refused
 * too. Every ask is built with that upgrade's `Authorization` or cookie and
 * nothing of its frame but the path, and is resolved afresh by the
 * procedures' own middleware, so a session revoked while its socket stands
 * is refused at its next ask, and a read naming another account is signed
 * out as its HTTP poll is.
 *
 * Each ask is a fiber of its socket's own set, answered whenever it is
 * answered, so a poll held 25 s holds no other; the socket's end interrupts
 * them all, and aborts each one's request. A frame that does not read as an
 * ask, or an ask past the bound on open ones, closes the socket as a policy
 * violation. No frame is logged or counted.
 */

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

/** The most bytes one frame from a host may carry: an ask's path is bounded well under it. */
const MAXIMUM_FRAME_BYTES = 64 * 1024;

/** The most asks one socket may hold open at once: every live read a host holds, many times over. */
const MAXIMUM_OPEN_ASKS = 128;

const readAsk = readEither(liveSocketAskSchema);

/** The ask a frame carries, where it is a text frame that reads as one. */
function askOf(frame: VoiceFrame): LiveSocketAsk | undefined {
  if (!("text" in frame)) return undefined;
  const read = readAsk(jsonOf(frame.text));
  return Result.isSuccess(read) ? read.success : undefined;
}

/** The headers every ask is sent with: the upgrade's own credential, and nothing else. */
function credentialHeaders(credential: RelayCredential): Headers {
  return "bearer" in credential
    ? new Headers({ [CREDENTIAL_HEADER.AUTHORIZATION]: credential.bearer })
    : new Headers(credential.page);
}

/** What answers every ask on a socket: the hosted router's fetch over the instance's services, at the deployment's own origin. */
export interface LiveSocketAnswerer {
  readonly fetch: HostedFetch;
  readonly services: Context.Context<WebServices>;
  /** The origin every ask's request is built on (`authDeployment`'s `baseURL`), never one a frame names. */
  readonly origin: string;
}

/**
 * One ask answered as its HTTP poll would be, under the socket's credential:
 * a fetch that throws, which the handler never does on purpose, answers a
 * bare 500, so the host's poll fails at once rather than at its deadline.
 */
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

/**
 * Every ask a socket sends, each answered on a fiber of its own and sent
 * back under its id, until the host goes or sends what is not an ask, or
 * more asks than the bound holds open, which closes the socket. The scope
 * the socket stands in ending interrupts every ask still open.
 */
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

/** Whether an upgrade is this service's to take, read from its address and headers alone, against the deployment's own origins: refused, or the credential it carries. */
export function admitLiveSocketUpgrade(
  url: string | undefined,
  headers: IncomingHttpHeaders,
  ownOrigins: ReadonlySet<string>,
): { readonly status: number } | RelayCredential {
  const address = new URL(url ?? "/", "http://localhost");
  if (address.pathname !== LIVE_SOCKET.PATH) return { status: RELAY_UPGRADE_STATUS.NOT_FOUND };
  return relayCredential(headers, ownOrigins);
}

/** The HTTP face of the live socket at its path (`relayServer`). */
export function liveSocketServer(): RelayServer {
  return relayServer(LIVE_SOCKET.PATH);
}

export interface LiveSocketOptions {
  readonly server: RelayServer;
  /** The origins the deployment's own pages are served from. */
  readonly ownOrigins: ReadonlySet<string>;
  /** The account a credential answers for, or none; a failure is the auth service's, refused as unavailable. */
  readonly resolveUserId: (
    credential: RelayCredential,
  ) => Effect.Effect<Option.Option<string>, Cause.UnknownError>;
  /** The hosted router's fetch over the live procedures. */
  readonly fetch: HostedFetch;
  /** The deployment's own origin, which every ask is built on. */
  readonly origin: string;
}

/**
 * The live socket's service for one function instance (`standRelay`): one
 * socket per host, under the account its credential resolves to, every ask
 * answered over the services of the runtime it stands on, captured once
 * here because the relay hands its sockets none.
 */
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
