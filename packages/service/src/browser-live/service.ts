/**
 * service.ts -- the live view of agents' Browser tabs as a WebSocket service: one socket per tab a member watches, admitted from the desktop under the account's bearer or from the web app under its session cookie, and relayed by `relay.ts`.
 *
 * The function exports the `http.Server` this builds, and Vercel upgrades
 * WebSockets into it, as it does the terminal relay's. An upgrade is
 * refused before any socket stands where it is not this service's path or
 * names no task and tab; then by who is asking, on the terms the terminal
 * relay keeps too (`http/relay-upgrade.ts`): the desktop's bearer with no
 * `Origin`, or a page of the deployment's own origins by its session
 * cookie, read as every hosted route reads a browser's, so another site's
 * page that opens a socket here with the member's cookie is refused before
 * it is read. An account that does not resolve is refused, and so is a tab
 * it does not reach (`readTaskBrowserTab`), as not found, so no socket ever
 * stands for a tab its member cannot read. Every admitted socket is one
 * fiber of the service's own set, so the service's scope ending ends them
 * all, each handing back a takeover it took.
 */

import type { IncomingHttpHeaders } from "node:http";
import type { ReachedBrowserTab } from "@luke/database/models/agent-browser-tabs";
import { BROWSER_LIVE } from "@luke/features/browser-live-wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Option, Result, type Scope } from "effect";
import { unparsedWire, wireUuidSchema } from "../core.js";
import {
  RELAY_UPGRADE_STATUS,
  type RelayCredential,
  type RelayServer,
  relayCredential,
  relayServer,
  standRelay,
} from "../http/relay-upgrade.js";
import { type BrowserLiveAsk, type BrowserLiveDependencies, relayBrowserTab } from "./relay.js";

/** The most bytes one message from a panel may carry: a text message's largest is well under it. */
const MAXIMUM_FRAME_BYTES = 64 * 1024;

const readId = readEither(wireUuidSchema);

/** What an upgrade asks for before its credential is resolved: the credential, and the task and tab it names. */
export type BrowserLiveUpgrade =
  | { readonly status: number }
  | {
      readonly credential: RelayCredential;
      readonly ask: Omit<BrowserLiveAsk, "userId">;
    };

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
  const credential = relayCredential(headers, ownOrigins);
  if ("status" in credential) return credential;
  return { credential, ask: { taskId: taskId.success, tabId: tabId.success } };
}

/** The HTTP face of the live view at its path (`relayServer`). */
export function browserLiveServer(): RelayServer {
  return relayServer(BROWSER_LIVE.PATH);
}

/** Who may watch a tab: the account an upgrade's credential resolves to, and the tab it reaches. */
export interface BrowserLiveAdmission {
  /** The account a credential answers for, or none. */
  readonly resolveUserId: (credential: RelayCredential) => Effect.Effect<Option.Option<string>>;
  readonly readTab: BrowserLiveDependencies["readTab"];
}

/** An admitted upgrade's account and tab, or the status it is refused with before a socket stands. */
export function admitBrowserLiveAccount(
  decision: Extract<BrowserLiveUpgrade, { credential: RelayCredential }>,
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
  readonly server: RelayServer;
  /** The origins the deployment's own pages are served from. */
  readonly ownOrigins: ReadonlySet<string>;
  readonly resolveUserId: BrowserLiveAdmission["resolveUserId"];
  readonly dependencies: BrowserLiveDependencies;
}

/** The live view's service for one function instance (`standRelay`): one socket per tab a member watches, under the account its credential resolves to and the tab it reaches. */
export function standBrowserLive(
  options: BrowserLiveOptions,
): Effect.Effect<void, never, Scope.Scope> {
  const admission = {
    resolveUserId: options.resolveUserId,
    readTab: options.dependencies.readTab,
  };
  return standRelay({
    server: options.server,
    sockets: { maxPayload: MAXIMUM_FRAME_BYTES, perMessageDeflate: false },
    admit: (request) => admitBrowserLiveUpgrade(request.url, request.headers, options.ownOrigins),
    accept: (decision) => admitBrowserLiveAccount(decision, admission),
    relay: (admitted, panel, webSocket) => {
      const viewer = { ...panel, buffered: Effect.sync(() => webSocket.bufferedAmount) };
      return relayBrowserTab(viewer, admitted.ask, admitted.reached, options.dependencies);
    },
  });
}
