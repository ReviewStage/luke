/**
 * relay-upgrade.ts -- who a relay's WebSocket upgrade says it is, read before any socket stands: the desktop's bearer, sent with no `Origin`, or a page's session cookie, taken only from one of the deployment's own origins; and the server and service both relays stand on.
 *
 * Two relays stand on these terms, an agent's terminal (`terminal/service.ts`)
 * and a cloud Browser tab's live view (`browser-live/service.ts`). The
 * desktop connects from its main process, which names no `Origin`, under the
 * account's bearer. A browser names the page's origin on every upgrade, and
 * no page can set or drop it; it also carries the deployment's cookies on an
 * upgrade any page opens, and a WebSocket's handshake, unlike a fetch, asks
 * no CORS question first. So an upgrade naming an origin is taken only from
 * the deployment's own pages (`authDeployment`'s `ownOrigins`, the list
 * `origin-guard.ts` holds a cookie's writes to, never Better Auth's
 * `trustedOrigins`), and its account is then read from its cookie alone, as
 * every hosted route reads a browser's: another site's page that opens a
 * socket here, carrying the member's cookie, is refused before the cookie is
 * read. A page can set no `Authorization` on a WebSocket, so one beside a
 * page's origin is never read, and a cookie with no origin is no desktop's
 * credential. What the account may then reach is each relay's own rule.
 */

import http, { type IncomingHttpHeaders, type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { Effect, FiberSet, type Scope } from "effect";
import { type WebSocket, WebSocketServer } from "ws";
import { CREDENTIAL_HEADER } from "../auth/session-credential.js";
import { type VoiceSocket, voiceSocket } from "../voice/socket.js";
import { HOSTED_HTTP_STATUS } from "./http.js";

/** The statuses an upgrade is refused with, before any socket stands. */
export const RELAY_UPGRADE_STATUS = {
  BAD_REQUEST: HOSTED_HTTP_STATUS.BAD_REQUEST,
  UNAUTHORIZED: HOSTED_HTTP_STATUS.UNAUTHORIZED,
  /** The handshake named an origin that is not one of the deployment's own: another site's page. */
  FORBIDDEN: HOSTED_HTTP_STATUS.FORBIDDEN,
  NOT_FOUND: HOSTED_HTTP_STATUS.NOT_FOUND,
  SERVICE_UNAVAILABLE: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
} as const;

/** A plain request to a relay's path: the answer says what the path is for. */
const UPGRADE_REQUIRED = 426;

/** The close code every socket is ended with as its service goes away. */
const GOING_AWAY = 1001;

const BEARER_SCHEME = "Bearer ";

/** Who an upgrade says it is: the desktop's bearer, or a page's session cookie, as the headers its session is read from. */
export type RelayCredential = { readonly bearer: string } | { readonly page: Headers };

/** The headers a page's session is read from: its cookie alone, which is all a browser's socket can carry; none where it carries none. */
function pageHeaders(headers: IncomingHttpHeaders): Headers | undefined {
  const cookie = headers.cookie?.trim();
  return cookie ? new Headers({ [CREDENTIAL_HEADER.COOKIE]: cookie }) : undefined;
}

/** The desktop's bearer, where the upgrade carries one with something in it. */
function bearerOf(headers: IncomingHttpHeaders): string | undefined {
  const authorization = headers.authorization;
  if (authorization === undefined || !authorization.startsWith(BEARER_SCHEME)) return undefined;
  return authorization.slice(BEARER_SCHEME.length).trim() === "" ? undefined : authorization;
}

/**
 * The credential an upgrade carries, read from its headers alone against
 * the deployment's own origins, or the status it is refused with: a page of
 * another origin is forbidden whatever it carries, and a page with no
 * cookie, or a caller with no origin and no bearer, is unauthorized.
 */
export function relayCredential(
  headers: IncomingHttpHeaders,
  ownOrigins: ReadonlySet<string>,
): RelayCredential | { readonly status: number } {
  if (headers.origin !== undefined) {
    if (!ownOrigins.has(headers.origin)) return { status: RELAY_UPGRADE_STATUS.FORBIDDEN };
    const page = pageHeaders(headers);
    return page === undefined ? { status: RELAY_UPGRADE_STATUS.UNAUTHORIZED } : { page };
  }
  const bearer = bearerOf(headers);
  return bearer === undefined ? { status: RELAY_UPGRADE_STATUS.UNAUTHORIZED } : { bearer };
}

/** Refuses one upgrade before any socket stands, with the status given. */
function refuseUpgrade(socket: Duplex, status: number): void {
  socket.end(`HTTP/1.1 ${status} Refused\r\nConnection: close\r\n\r\n`);
}

/** Whether an answer is a refusal, by the status it carries, rather than what was asked. */
function refused<A>(
  answer: { readonly status: number } | A,
): answer is { readonly status: number } {
  return typeof answer === "object" && answer !== null && "status" in answer;
}

/** What a server hands a service that stands on it, which is what `ws` upgrades on. */
type UpgradeHandler = (request: IncomingMessage, socket: Duplex, head: Buffer) => void;

export interface RelayServer {
  /** The server a function module exports for Vercel to upgrade into. */
  readonly server: http.Server;
  /** The one service answering this server's upgrades: none until one stands, and none again once its scope closes. */
  readonly serve: (handle: UpgradeHandler | undefined) => void;
}

/**
 * The HTTP face of a relay at its path, built where its function module is
 * evaluated because that module's export is synchronous and the service
 * behind it is an effect the edge's runtime runs. Until a service claims it,
 * every upgrade is refused with 503.
 */
export function relayServer(path: string): RelayServer {
  let handle: UpgradeHandler | undefined;
  const server = http.createServer((request, response) => {
    const asked = new URL(request.url ?? "/", "http://localhost").pathname;
    response.writeHead(asked === path ? UPGRADE_REQUIRED : RELAY_UPGRADE_STATUS.NOT_FOUND).end();
  });
  server.on("upgrade", (request, socket, head) => {
    socket.on("error", () => socket.destroy());
    if (handle === undefined) {
      refuseUpgrade(socket, RELAY_UPGRADE_STATUS.SERVICE_UNAVAILABLE);
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

/** One relay's own rules for a socket, from its upgrade's request to the socket it relays. */
export interface RelayOptions<Asked, Admitted> {
  readonly server: RelayServer;
  /** The `ws` server's bound on one message, and whether it compresses, where the relay says. */
  readonly sockets: { readonly maxPayload: number; readonly perMessageDeflate?: false };
  /** Whether an upgrade is the relay's to take, read from its request alone: refused, or what it asks. */
  readonly admit: (request: IncomingMessage) => { readonly status: number } | Asked;
  /** Who is asking, resolved before any socket stands: refused, or what the socket relays. */
  readonly accept: (asked: Asked) => Effect.Effect<{ readonly status: number } | Admitted>;
  /** The socket relayed, its reader standing, for as long as its scope does. */
  readonly relay: (
    admitted: Admitted,
    socket: VoiceSocket,
    webSocket: WebSocket,
  ) => Effect.Effect<void, never, Scope.Scope>;
}

/**
 * A relay's service for one function instance, standing for the scope it is
 * built in: the `ws` server, the set every connection's fiber joins, and the
 * claim on the server. The scope's close gives up the claim, ends every
 * connection, and closes the `ws` server.
 */
export function standRelay<Asked, Admitted>(
  options: RelayOptions<Asked, Admitted>,
): Effect.Effect<void, never, Scope.Scope> {
  return Effect.gen(function* () {
    const fibers = yield* FiberSet.make<void>();
    const fork = yield* FiberSet.runtime(fibers)();
    const sockets = yield* Effect.acquireRelease(
      Effect.sync(() => new WebSocketServer({ noServer: true, ...options.sockets })),
      (server) =>
        Effect.callback<void>((resume) => {
          server.close(() => resume(Effect.void));
        }),
    );
    /** The socket the upgrade stands, paused until the connection's own reader stands. */
    const upgraded = (request: IncomingMessage, socket: Duplex, head: Buffer) =>
      Effect.callback<WebSocket>((resume) => {
        sockets.handleUpgrade(request, socket, head, (webSocket) => {
          webSocket.pause();
          resume(Effect.succeed(webSocket));
        });
      });
    const connection = (asked: Asked, request: IncomingMessage, socket: Duplex, head: Buffer) =>
      Effect.gen(function* () {
        const admitted = yield* options.accept(asked);
        if (refused(admitted)) {
          refuseUpgrade(socket, admitted.status);
          return;
        }
        const webSocket = yield* upgraded(request, socket, head);
        yield* Effect.scoped(
          Effect.gen(function* () {
            const relayed = yield* voiceSocket(webSocket);
            yield* Effect.sync(() => webSocket.resume());
            yield* options.relay(admitted, relayed, webSocket);
          }),
        );
      });
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        options.server.serve((request, socket, head) => {
          const asked = options.admit(request);
          if (refused(asked)) {
            refuseUpgrade(socket, asked.status);
            return;
          }
          fork(Effect.andThen(Effect.yieldNow, connection(asked, request, socket, head)));
        }),
      ),
      () =>
        Effect.gen(function* () {
          options.server.serve(undefined);
          for (const client of sockets.clients) client.close(GOING_AWAY);
          yield* FiberSet.awaitEmpty(fibers);
        }),
    );
  });
}
