/**
 * service.ts -- the terminal relay as a WebSocket service: one socket per attached shell, admitted under the account's bearer and piped by `relay.ts`.
 *
 * The function exports the `http.Server` this builds, and Vercel upgrades
 * WebSockets into it, as it does the voice service's. An upgrade is refused
 * before any socket stands where it is not the relay's path, carries a
 * browser `Origin` (the desktop connects from its main process, never a
 * page), has no bearer, or names no agent, shell, and size; then the bearer
 * is resolved to its account, and an upgrade the account does not answer for
 * is refused too. Every admitted socket is one fiber of the service's own
 * set, so the service's scope ending ends them all, each closing its PTY
 * socket and leaving its shell running in tmux. A socket lives as long as
 * the function may run, then the desktop reconnects to the same shell.
 */

import http, { type IncomingHttpHeaders, type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { TERMINAL_RELAY } from "@luke/features/terminal-wire";
import { unparsedWire, wireUuidSchema } from "@luke/service/core";
import { HTTP_STATUS } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Effect, FiberSet, Option, Result, Schema, type Scope } from "effect";
import { type WebSocket, WebSocketServer } from "ws";
import { voiceSocket } from "../voice/socket.js";
import { type RelayAsk, type RelayDependencies, relayTerminal } from "./relay.js";

/** The statuses an upgrade is refused with, before any socket stands. */
export const RELAY_UPGRADE_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: HTTP_STATUS.UNAUTHORIZED,
  /** The handshake carried a browser `Origin`; the caller is no page, so it sets none. */
  FORBIDDEN: HTTP_STATUS.FORBIDDEN,
  NOT_FOUND: HTTP_STATUS.NOT_FOUND,
  SERVICE_UNAVAILABLE: 503,
} as const;

/** A plain request to the relay's path: the answer says what the path is for. */
const UPGRADE_REQUIRED = 426;

/** The most bytes one frame from the desktop may carry: a paste is sent in pieces well under it. */
const MAXIMUM_FRAME_BYTES = 1024 * 1024;

const BEARER_SCHEME = "Bearer ";

const SizeSchema = Schema.NumberFromString.pipe(
  Schema.decodeTo(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000 }))),
);

const readId = readEither(wireUuidSchema);
const readSize = readEither(SizeSchema);

/** What an upgrade asks for before its bearer is resolved: the bearer, and the agent, shell, and size it names. */
export type RelayUpgrade =
  | { readonly status: number }
  | { readonly bearer: string; readonly ask: Omit<RelayAsk, "userId"> };

/** Whether an upgrade is the relay's to take, read from its address and headers alone. */
export function admitRelayUpgrade(
  url: string | undefined,
  headers: IncomingHttpHeaders,
): RelayUpgrade {
  const address = new URL(url ?? "/", "http://localhost");
  if (address.pathname !== TERMINAL_RELAY.PATH) return { status: RELAY_UPGRADE_STATUS.NOT_FOUND };
  if (headers.origin !== undefined) return { status: RELAY_UPGRADE_STATUS.FORBIDDEN };
  const authorization = headers.authorization;
  if (authorization === undefined || !authorization.startsWith(BEARER_SCHEME)) {
    return { status: RELAY_UPGRADE_STATUS.UNAUTHORIZED };
  }
  if (authorization.slice(BEARER_SCHEME.length).trim().length === 0) {
    return { status: RELAY_UPGRADE_STATUS.UNAUTHORIZED };
  }
  const query = (name: string) => unparsedWire(address.searchParams.get(name) ?? "");
  const agentId = readId(query(TERMINAL_RELAY.QUERY.AGENT));
  const terminalId = readId(query(TERMINAL_RELAY.QUERY.TERMINAL));
  const cols = readSize(query(TERMINAL_RELAY.QUERY.COLUMNS));
  const rows = readSize(query(TERMINAL_RELAY.QUERY.ROWS));
  if (
    Result.isFailure(agentId) ||
    Result.isFailure(terminalId) ||
    Result.isFailure(cols) ||
    Result.isFailure(rows)
  ) {
    return { status: RELAY_UPGRADE_STATUS.BAD_REQUEST };
  }
  return {
    bearer: authorization,
    ask: {
      agentId: agentId.success,
      terminalId: terminalId.success,
      cols: cols.success,
      rows: rows.success,
    },
  };
}

/** Refuses one upgrade before any socket stands, with the status given. */
function refuseUpgrade(socket: Duplex, status: number): void {
  socket.end(`HTTP/1.1 ${status} Refused\r\nConnection: close\r\n\r\n`);
}

/** What a server hands a service that stands on it, which is what `ws` upgrades on. */
type RelayUpgradeHandler = (request: IncomingMessage, socket: Duplex, head: Buffer) => void;

export interface TerminalRelayServer {
  /** The server a function module exports for Vercel to upgrade into. */
  readonly server: http.Server;
  /** The one service answering this server's upgrades: none until one stands, and none again once its scope closes. */
  readonly serve: (handle: RelayUpgradeHandler | undefined) => void;
}

/**
 * The HTTP face of the relay, built where its function module is evaluated
 * because that module's export is synchronous and the service behind it is
 * an effect the edge's runtime runs. Until a service claims it, every
 * upgrade is refused with 503.
 */
export function terminalRelayServer(): TerminalRelayServer {
  let handle: RelayUpgradeHandler | undefined;
  const server = http.createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    response
      .writeHead(path === TERMINAL_RELAY.PATH ? UPGRADE_REQUIRED : RELAY_UPGRADE_STATUS.NOT_FOUND)
      .end();
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

export interface TerminalRelayOptions {
  readonly server: TerminalRelayServer;
  /** The account a bearer answers for, or none. */
  readonly resolveUserId: (authorization: string) => Effect.Effect<Option.Option<string>>;
  readonly dependencies: RelayDependencies;
}

/**
 * The service for one function instance, standing for the scope it is built
 * in: the `ws` server, the set every connection's fiber joins, and the claim
 * on the server. The scope's close gives up the claim, ends every
 * connection, and closes the `ws` server.
 */
export function standTerminalRelay(
  options: TerminalRelayOptions,
): Effect.Effect<void, never, Scope.Scope> {
  return Effect.gen(function* () {
    const fibers = yield* FiberSet.make<void>();
    const fork = yield* FiberSet.runtime(fibers)();
    const sockets = yield* Effect.acquireRelease(
      Effect.sync(() => new WebSocketServer({ noServer: true, maxPayload: MAXIMUM_FRAME_BYTES })),
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
    const connection = (
      decision: Extract<RelayUpgrade, { bearer: string }>,
      request: IncomingMessage,
      socket: Duplex,
      head: Buffer,
    ) =>
      Effect.gen(function* () {
        const account = yield* options.resolveUserId(decision.bearer);
        if (Option.isNone(account)) {
          refuseUpgrade(socket, RELAY_UPGRADE_STATUS.UNAUTHORIZED);
          return;
        }
        const webSocket = yield* upgraded(request, socket, head);
        yield* Effect.scoped(
          Effect.gen(function* () {
            const device = yield* voiceSocket(webSocket);
            yield* Effect.sync(() => webSocket.resume());
            yield* relayTerminal(
              device,
              { ...decision.ask, userId: account.value },
              options.dependencies,
            );
          }),
        );
      });
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        options.server.serve((request, socket, head) => {
          const decision = admitRelayUpgrade(request.url, request.headers);
          if ("status" in decision) {
            refuseUpgrade(socket, decision.status);
            return;
          }
          fork(Effect.andThen(Effect.yieldNow, connection(decision, request, socket, head)));
        }),
      ),
      () =>
        Effect.gen(function* () {
          options.server.serve(undefined);
          for (const client of sockets.clients) client.close(1001);
          yield* FiberSet.awaitEmpty(fibers);
        }),
    );
  });
}
