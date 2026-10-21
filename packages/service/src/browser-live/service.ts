/**
 * service.ts -- the live view of agents' Browser tabs as a WebSocket service: one socket per tab a member watches, admitted from the desktop under the account's bearer or from the web app under its session cookie, and relayed by `relay.ts`.
 *
 * The function exports the `http.Server` this builds, and Vercel upgrades
 * WebSockets into it, as it does the terminal relay's. An upgrade is
 * refused before any socket stands where it is not this service's path or
 * names no task and tab; then by who is asking. The desktop connects from
 * its main process, which names no `Origin`, under the account's bearer, as
 * it connects a terminal. A browser always names the page's origin on an
 * upgrade, and no page can set it, so an upgrade naming one is taken only
 * from the deployment's own pages (`authDeployment`'s `ownOrigins`, never
 * Better Auth's `trustedOrigins`), and its account is read as every hosted
 * route reads a browser's (`bearer.ts`'s `requestUserId`): the session
 * cookie the browser carried. So another site's page that opens a socket
 * here with the member's cookie is refused before it is read. An account
 * that does not resolve is refused, and so is a tab it does not reach
 * (`readTaskBrowserTab`), as not found, so no socket ever stands for a tab
 * its member cannot read. Every admitted socket is one fiber of the
 * service's own set, so the service's scope ending ends them all, each
 * handing back a takeover it took.
 */

import http, { type IncomingHttpHeaders, type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { ReachedBrowserTab } from "@luke/database/models/agent-browser-tabs";
import { BROWSER_LIVE } from "@luke/features/browser-live-wire";
import { readEither } from "@luke/wire/effect";
import { Effect, FiberSet, Option, Result, type Scope } from "effect";
import { type WebSocket, WebSocketServer } from "ws";
import { CREDENTIAL_HEADER } from "../auth/session-credential.js";
import { unparsedWire, wireUuidSchema } from "../core.js";
import { RELAY_UPGRADE_STATUS } from "../terminal/service.js";
import { voiceSocket } from "../voice/socket.js";
import { type BrowserLiveAsk, type BrowserLiveDependencies, relayBrowserTab } from "./relay.js";

/** A plain request to the service's path: the answer says what the path is for. */
const UPGRADE_REQUIRED = 426;

/** The most bytes one message from a panel may carry: a text message's largest is well under it. */
const MAXIMUM_FRAME_BYTES = 64 * 1024;

const BEARER_SCHEME = "Bearer ";

const readId = readEither(wireUuidSchema);

/** Who an upgrade says it is: the desktop's bearer, or a page's session cookie, as headers. */
export type BrowserLiveCredential = { readonly bearer: string } | { readonly page: Headers };

/** What an upgrade asks for before its credential is resolved: the credential, and the task and tab it names. */
export type BrowserLiveUpgrade =
  | { readonly status: number }
  | {
      readonly credential: BrowserLiveCredential;
      readonly ask: Omit<BrowserLiveAsk, "userId">;
    };

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

/** Whether an upgrade is this service's to take, read from its address and headers alone, against the deployment's own origins. */
export function admitBrowserLiveUpgrade(
  url: string | undefined,
  headers: IncomingHttpHeaders,
  ownOrigins: ReadonlySet<string>,
): BrowserLiveUpgrade {
  const address = new URL(url ?? "/", "http://localhost");
  if (address.pathname !== BROWSER_LIVE.PATH) return { status: RELAY_UPGRADE_STATUS.NOT_FOUND };
  const query = (name: string) => unparsedWire(address.searchParams.get(name) ?? "");
  const taskId = readId(query(BROWSER_LIVE.QUERY.TASK));
  const tabId = readId(query(BROWSER_LIVE.QUERY.TAB));
  if (Result.isFailure(taskId) || Result.isFailure(tabId)) {
    return { status: RELAY_UPGRADE_STATUS.BAD_REQUEST };
  }
  const ask = { taskId: taskId.success, tabId: tabId.success };
  if (headers.origin !== undefined) {
    if (!ownOrigins.has(headers.origin)) return { status: RELAY_UPGRADE_STATUS.FORBIDDEN };
    const page = pageHeaders(headers);
    if (page === undefined) return { status: RELAY_UPGRADE_STATUS.UNAUTHORIZED };
    return { credential: { page }, ask };
  }
  const bearer = bearerOf(headers);
  if (bearer === undefined) return { status: RELAY_UPGRADE_STATUS.UNAUTHORIZED };
  return { credential: { bearer }, ask };
}

/** Refuses one upgrade before any socket stands, with the status given. */
function refuseUpgrade(socket: Duplex, status: number): void {
  socket.end(`HTTP/1.1 ${status} Refused\r\nConnection: close\r\n\r\n`);
}

/** What a server hands a service that stands on it, which is what `ws` upgrades on. */
type UpgradeHandler = (request: IncomingMessage, socket: Duplex, head: Buffer) => void;

export interface BrowserLiveServer {
  /** The server a function module exports for Vercel to upgrade into. */
  readonly server: http.Server;
  /** The one service answering this server's upgrades: none until one stands, and none again once its scope closes. */
  readonly serve: (handle: UpgradeHandler | undefined) => void;
}

/**
 * The HTTP face of the service, built where its function module is
 * evaluated, as the terminal relay's is. Until a service claims it, every
 * upgrade is refused with 503.
 */
export function browserLiveServer(): BrowserLiveServer {
  let handle: UpgradeHandler | undefined;
  const server = http.createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    response
      .writeHead(path === BROWSER_LIVE.PATH ? UPGRADE_REQUIRED : RELAY_UPGRADE_STATUS.NOT_FOUND)
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

/** Who may watch a tab: the account an upgrade's credential resolves to, and the tab it reaches. */
export interface BrowserLiveAdmission {
  /** The account a credential answers for, or none. */
  readonly resolveUserId: (
    credential: BrowserLiveCredential,
  ) => Effect.Effect<Option.Option<string>>;
  readonly readTab: BrowserLiveDependencies["readTab"];
}

/** An admitted upgrade's account and tab, or the status it is refused with before a socket stands. */
export function admitBrowserLiveAccount(
  decision: Extract<BrowserLiveUpgrade, { credential: BrowserLiveCredential }>,
  admission: BrowserLiveAdmission,
): Effect.Effect<
  | { readonly status: number }
  | { readonly ask: BrowserLiveAsk; readonly reached: ReachedBrowserTab }
> {
  return Effect.gen(function* () {
    const account = yield* admission.resolveUserId(decision.credential);
    if (Option.isNone(account)) return { status: RELAY_UPGRADE_STATUS.UNAUTHORIZED };
    const ask = { ...decision.ask, userId: account.value };
    const found = yield* Effect.result(admission.readTab(ask.userId, ask.taskId, ask.tabId));
    if (Result.isFailure(found)) return { status: RELAY_UPGRADE_STATUS.SERVICE_UNAVAILABLE };
    if (Option.isNone(found.success)) return { status: RELAY_UPGRADE_STATUS.NOT_FOUND };
    return { ask, reached: found.success.value };
  });
}

export interface BrowserLiveOptions {
  readonly server: BrowserLiveServer;
  /** The origins the deployment's own pages are served from. */
  readonly ownOrigins: ReadonlySet<string>;
  readonly resolveUserId: BrowserLiveAdmission["resolveUserId"];
  readonly dependencies: BrowserLiveDependencies;
}

/**
 * The service for one function instance, standing for the scope it is built
 * in: the `ws` server, the set every connection's fiber joins, and the claim
 * on the server. The scope's close gives up the claim, ends every
 * connection, and closes the `ws` server.
 */
export function standBrowserLive(
  options: BrowserLiveOptions,
): Effect.Effect<void, never, Scope.Scope> {
  return Effect.gen(function* () {
    const fibers = yield* FiberSet.make<void>();
    const fork = yield* FiberSet.runtime(fibers)();
    const sockets = yield* Effect.acquireRelease(
      Effect.sync(
        () =>
          new WebSocketServer({
            noServer: true,
            maxPayload: MAXIMUM_FRAME_BYTES,
            perMessageDeflate: false,
          }),
      ),
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
    const admission = {
      resolveUserId: options.resolveUserId,
      readTab: options.dependencies.readTab,
    };
    const connection = (
      decision: Extract<BrowserLiveUpgrade, { credential: BrowserLiveCredential }>,
      request: IncomingMessage,
      socket: Duplex,
      head: Buffer,
    ) =>
      Effect.gen(function* () {
        const admitted = yield* admitBrowserLiveAccount(decision, admission);
        if ("status" in admitted) {
          refuseUpgrade(socket, admitted.status);
          return;
        }
        const webSocket = yield* upgraded(request, socket, head);
        yield* Effect.scoped(
          Effect.gen(function* () {
            const panel = yield* voiceSocket(webSocket);
            yield* Effect.sync(() => webSocket.resume());
            const viewer = { ...panel, buffered: Effect.sync(() => webSocket.bufferedAmount) };
            yield* relayBrowserTab(viewer, admitted.ask, admitted.reached, options.dependencies);
          }),
        );
      });
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        options.server.serve((request, socket, head) => {
          const decision = admitBrowserLiveUpgrade(
            request.url,
            request.headers,
            options.ownOrigins,
          );
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
