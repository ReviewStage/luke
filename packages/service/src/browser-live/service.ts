import type { IncomingHttpHeaders } from "node:http";
import type { ReachedBrowserTab } from "@repo/database/models/agent-browser-tabs";
import type { BrowserTabsPlace } from "@repo/features/agent-browser-tab-wire";
import { BROWSER_LIVE } from "@repo/features/browser-live-wire";
import { readEither } from "@repo/wire/effect";
import { type Cause, Effect, Option, Result, type Scope } from "effect";
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

const MAXIMUM_FRAME_BYTES = 64 * 1024;

const readId = readEither(wireUuidSchema);

export type BrowserLiveUpgrade =
  | { readonly status: number }
  | {
      readonly credential: RelayCredential;
      readonly ask: Omit<BrowserLiveAsk, "userId">;
    };

export function admitBrowserLiveUpgrade(
  url: string | undefined,
  headers: IncomingHttpHeaders,
  ownOrigins: ReadonlySet<string>,
): BrowserLiveUpgrade {
  const address = new URL(url ?? "/", "http://localhost");
  if (address.pathname !== BROWSER_LIVE.PATH) return { status: RELAY_UPGRADE_STATUS.NOT_FOUND };
  const query = (name: string) => unparsedWire(address.searchParams.get(name) ?? "");
  const named: Result.Result<BrowserTabsPlace, unknown> = address.searchParams.has(
    BROWSER_LIVE.QUERY.AGENT,
  )
    ? Result.map(readId(query(BROWSER_LIVE.QUERY.AGENT)), (agentId) => ({ agentId }))
    : Result.map(readId(query(BROWSER_LIVE.QUERY.TASK)), (taskId) => ({ taskId }));
  const tabId = readId(query(BROWSER_LIVE.QUERY.TAB));
  if (Result.isFailure(named) || Result.isFailure(tabId)) {
    return { status: RELAY_UPGRADE_STATUS.BAD_REQUEST };
  }
  const credential = relayCredential(headers, ownOrigins);
  if ("status" in credential) return credential;
  return { credential, ask: { place: named.success, tabId: tabId.success } };
}

export function browserLiveServer(): RelayServer {
  return relayServer(BROWSER_LIVE.PATH);
}

export interface BrowserLiveAdmission {
  readonly resolveUserId: (
    credential: RelayCredential,
  ) => Effect.Effect<Option.Option<string>, Cause.UnknownError>;
  readonly readTab: BrowserLiveDependencies["readTab"];
}

export function admitBrowserLiveAccount(
  decision: Extract<BrowserLiveUpgrade, { credential: RelayCredential }>,
  admission: BrowserLiveAdmission,
): Effect.Effect<
  | { readonly status: number }
  | { readonly ask: BrowserLiveAsk; readonly reached: ReachedBrowserTab }
> {
  return Effect.gen(function* () {
    const resolved = yield* Effect.result(admission.resolveUserId(decision.credential));
    if (Result.isFailure(resolved)) return { status: RELAY_UPGRADE_STATUS.SERVICE_UNAVAILABLE };
    const account = resolved.success;
    if (Option.isNone(account)) return { status: RELAY_UPGRADE_STATUS.UNAUTHORIZED };
    const ask = { ...decision.ask, userId: account.value };
    const found = yield* Effect.result(admission.readTab(ask.userId, ask.place, ask.tabId));
    if (Result.isFailure(found)) return { status: RELAY_UPGRADE_STATUS.SERVICE_UNAVAILABLE };
    if (Option.isNone(found.success)) return { status: RELAY_UPGRADE_STATUS.NOT_FOUND };
    return { ask, reached: found.success.value };
  });
}

export interface BrowserLiveOptions {
  readonly server: RelayServer;
  readonly ownOrigins: ReadonlySet<string>;
  readonly resolveUserId: BrowserLiveAdmission["resolveUserId"];
  readonly dependencies: BrowserLiveDependencies;
}

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
