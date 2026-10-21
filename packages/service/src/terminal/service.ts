/**
 * service.ts -- the terminal relay as a WebSocket service: one socket per attached shell, admitted under the account's bearer from the desktop or under its session cookie from one of the deployment's own pages, and piped by `relay.ts`.
 *
 * The function exports the `http.Server` this builds, and Vercel upgrades
 * WebSockets into it, as it does the voice service's. An upgrade is refused
 * before any socket stands where it is not the relay's path; where it
 * carries neither credential `http/relay-upgrade.ts` takes, the desktop's
 * bearer with no `Origin` or the session cookie of a page on one of the
 * deployment's own origins, another site's page being refused whatever it
 * carries; or where it names no agent, shell, and size. Then the credential
 * is resolved to its account, and an upgrade the account does not answer for
 * is refused too. The agent a socket reaches is read under that account
 * alone, by the one rule every agent route keeps (`relay.ts`): an agent of a
 * workspace the account is in, and one on its starter's own GitHub token by
 * its starter alone, so a page reaches no shell its account could not open
 * from the desktop. Every admitted socket is one fiber of the service's own
 * set, so the service's scope ending ends them all, each closing its PTY
 * socket and leaving its shell running in tmux. A socket lives as long as
 * the function may run, then the panel reconnects to the same shell.
 */

import http, { type IncomingHttpHeaders, type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { TERMINAL_RELAY } from "@luke/features/terminal-wire";
import { readEither } from "@luke/wire/effect";
import { Effect, FiberSet, Option, Result, Schema, type Scope } from "effect";
import { type WebSocket, WebSocketServer } from "ws";
import { unparsedWire, wireUuidSchema } from "../core.js";
import {
  RELAY_UPGRADE_STATUS,
  type RelayCredential,
  refuseUpgrade,
  relayCredential,
} from "../http/relay-upgrade.js";
import { voiceSocket } from "../voice/socket.js";
import { type RelayAsk, type RelayDependencies, relayTerminal } from "./relay.js";

/** A plain request to the relay's path: the answer says what the path is for. */
const UPGRADE_REQUIRED = 426;

/** The most bytes one frame from a panel may carry: a paste is sent in pieces well under it. */
const MAXIMUM_FRAME_BYTES = 1024 * 1024;

const SizeSchema = Schema.NumberFromString.pipe(
  Schema.decodeTo(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000 }))),
);

const readId = readEither(wireUuidSchema);
const readSize = readEither(SizeSchema);

/** What an upgrade asks for before its credential is resolved: who it says it is, and the agent, shell, and size it names. */
export type RelayUpgrade =
  | { readonly status: number }
  | { readonly credential: RelayCredential; readonly ask: Omit<RelayAsk, "userId"> };

/** Whether an upgrade is the relay's to take, read from its address and headers alone, against the deployment's own origins. */
export function admitRelayUpgrade(
  url: string | undefined,
  headers: IncomingHttpHeaders,
  ownOrigins: ReadonlySet<string>,
): RelayUpgrade {
  const address = new URL(url ?? "/", "http://localhost");
  if (address.pathname !== TERMINAL_RELAY.PATH) return { status: RELAY_UPGRADE_STATUS.NOT_FOUND };
  const credential = relayCredential(headers, ownOrigins);
  if ("status" in credential) return credential;
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
    credential,
    ask: {
      agentId: agentId.success,
      terminalId: terminalId.success,
      cols: cols.success,
      rows: rows.success,
    },
  };
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
  /** The origins the deployment's own pages are served from, the only ones a page's upgrade is taken from. */
  readonly ownOrigins: ReadonlySet<string>;
  /** The account a credential answers for, or none. */
  readonly resolveUserId: (credential: RelayCredential) => Effect.Effect<Option.Option<string>>;
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
      decision: Extract<RelayUpgrade, { credential: RelayCredential }>,
      request: IncomingMessage,
      socket: Duplex,
      head: Buffer,
    ) =>
      Effect.gen(function* () {
        const account = yield* options.resolveUserId(decision.credential);
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
          const decision = admitRelayUpgrade(request.url, request.headers, options.ownOrigins);
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
