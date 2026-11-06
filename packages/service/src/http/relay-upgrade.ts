import http, { type IncomingHttpHeaders, type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { Effect, FiberSet, type Scope } from "effect";
import { type WebSocket, WebSocketServer } from "ws";
import { CREDENTIAL_HEADER } from "../auth/session-credential.js";
import { HOSTED_HTTP_STATUS } from "./http.js";
import { type VoiceSocket, voiceSocket } from "./socket.js";

export const RELAY_UPGRADE_STATUS = {
  BAD_REQUEST: HOSTED_HTTP_STATUS.BAD_REQUEST,
  UNAUTHORIZED: HOSTED_HTTP_STATUS.UNAUTHORIZED,
  FORBIDDEN: HOSTED_HTTP_STATUS.FORBIDDEN,
  NOT_FOUND: HOSTED_HTTP_STATUS.NOT_FOUND,
  SERVICE_UNAVAILABLE: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
} as const;

const UPGRADE_REQUIRED = 426;

const GOING_AWAY = 1001;

const BEARER_SCHEME = "Bearer ";

export type RelayCredential = { readonly bearer: string } | { readonly page: Headers };

function pageHeaders(headers: IncomingHttpHeaders): Headers | undefined {
  const cookie = headers.cookie?.trim();
  return cookie ? new Headers({ [CREDENTIAL_HEADER.COOKIE]: cookie }) : undefined;
}

function bearerOf(headers: IncomingHttpHeaders): string | undefined {
  const authorization = headers.authorization;
  if (authorization === undefined || !authorization.startsWith(BEARER_SCHEME)) return undefined;
  return authorization.slice(BEARER_SCHEME.length).trim() === "" ? undefined : authorization;
}

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

function refuseUpgrade(socket: Duplex, status: number): void {
  socket.end(`HTTP/1.1 ${status} Refused\r\nConnection: close\r\n\r\n`);
}

function refused<A>(
  answer: { readonly status: number } | A,
): answer is { readonly status: number } {
  return typeof answer === "object" && answer !== null && "status" in answer;
}

type UpgradeHandler = (request: IncomingMessage, socket: Duplex, head: Buffer) => void;

export interface RelayServer {
  readonly server: http.Server;
  readonly serve: (handle: UpgradeHandler | undefined) => void;
}

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

export interface RelayOptions<Asked, Admitted> {
  readonly server: RelayServer;
  readonly sockets: { readonly maxPayload: number; readonly perMessageDeflate?: false };
  readonly admit: (request: IncomingMessage) => { readonly status: number } | Asked;
  readonly accept: (asked: Asked) => Effect.Effect<{ readonly status: number } | Admitted>;
  readonly relay: (
    admitted: Admitted,
    socket: VoiceSocket,
    webSocket: WebSocket,
  ) => Effect.Effect<void, never, Scope.Scope>;
}

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
