/**
 * service.ts -- tunnels into agents' sandboxes as a WebSocket service: one socket per bridge, admitted from the desktop under the account's bearer, or from one of the deployment's own pages under its session cookie, as a Terminal's is, and piped by `relay.ts`.
 *
 * The function exports the `http.Server` this builds, and Vercel upgrades
 * WebSockets into it. An upgrade is refused before any socket stands where
 * it is not the tunnel's path; where it carries neither credential
 * `http/relay-upgrade.ts` takes; or where it names no agent and bridge: a
 * kind this service knows, and for a forwarded port, a port no service needs
 * root to bind and never the agent's own browser's DevTools, so a tunnel
 * never reaches the browser the service drives. Then the credential is
 * resolved to its account, and an upgrade the account does not answer for
 * is refused too. The agent a socket reaches is read under that account by
 * the one rule every agent route keeps, as a Terminal's is (`relay.ts`).
 * Every admitted socket is one fiber of the service's own set, so the
 * service's scope ending ends them all, each closing its PTY and with it
 * the bridge.
 */

import type { IncomingHttpHeaders } from "node:http";
import { FORWARD_PORT, SANDBOX_TUNNEL, TUNNEL_KIND } from "@repo/features/sandbox-tunnel-wire";
import { readEither } from "@repo/wire/effect";
import { type Cause, Effect, Option, Result, Schema, type Scope } from "effect";
import { SANDBOX_BROWSER } from "../agents/browser/sandbox-browser.js";
import { unparsedWire, wireUuidSchema } from "../core.js";
import {
  RELAY_UPGRADE_STATUS,
  type RelayCredential,
  type RelayServer,
  relayCredential,
  relayServer,
  standRelay,
} from "../http/relay-upgrade.js";
import type { TunnelBridge } from "./bridge.js";
import { relayTunnel, type TunnelAsk, type TunnelDependencies } from "./relay.js";

/** The most bytes one frame from the desktop may carry: a channel's data is sent in pieces well under it. */
const MAXIMUM_FRAME_BYTES = 1024 * 1024;

const PortSchema = Schema.NumberFromString.pipe(
  Schema.decodeTo(
    Schema.Int.check(
      Schema.isBetween({ minimum: FORWARD_PORT.MIN, maximum: FORWARD_PORT.MAX }),
      Schema.makeFilter((port) => port !== SANDBOX_BROWSER.DEVTOOLS_PORT),
    ),
  ),
);

const readId = readEither(wireUuidSchema);
const readKind = readEither(Schema.Literals(Object.values(TUNNEL_KIND)));
const readPort = readEither(PortSchema);

/** What an upgrade asks for before its credential is resolved: who it says it is, and the agent and bridge it names. */
export type TunnelUpgrade =
  | { readonly status: number }
  | { readonly credential: RelayCredential; readonly ask: Omit<TunnelAsk, "userId"> };

/** The bridge an upgrade's query names, or none where it names no kind and argument this service takes; the mirror takes none. */
function bridgeOf(
  query: (name: string) => ReturnType<typeof unparsedWire>,
): TunnelBridge | undefined {
  const kind = readKind(query(SANDBOX_TUNNEL.QUERY.KIND));
  if (Result.isFailure(kind)) return undefined;
  if (kind.success === TUNNEL_KIND.MIRROR) return { kind: kind.success };
  const port = readPort(query(SANDBOX_TUNNEL.QUERY.PORT));
  return Result.isFailure(port) ? undefined : { kind: kind.success, port: port.success };
}

/** Whether an upgrade is the tunnel's to take, read from its address and headers alone, against the deployment's own origins. */
export function admitTunnelUpgrade(
  url: string | undefined,
  headers: IncomingHttpHeaders,
  ownOrigins: ReadonlySet<string>,
): TunnelUpgrade {
  const address = new URL(url ?? "/", "http://localhost");
  if (address.pathname !== SANDBOX_TUNNEL.PATH) return { status: RELAY_UPGRADE_STATUS.NOT_FOUND };
  const credential = relayCredential(headers, ownOrigins);
  if ("status" in credential) return credential;
  const query = (name: string) => unparsedWire(address.searchParams.get(name) ?? "");
  const agentId = readId(query(SANDBOX_TUNNEL.QUERY.AGENT));
  const bridge = bridgeOf(query);
  if (Result.isFailure(agentId) || bridge === undefined) {
    return { status: RELAY_UPGRADE_STATUS.BAD_REQUEST };
  }
  return { credential, ask: { agentId: agentId.success, bridge } };
}

/** The HTTP face of the tunnel at its path (`relayServer`). */
export function tunnelServer(): RelayServer {
  return relayServer(SANDBOX_TUNNEL.PATH);
}

export interface TunnelOptions {
  readonly server: RelayServer;
  /** The origins the deployment's own pages are served from, the only ones a page's upgrade is taken from. */
  readonly ownOrigins: ReadonlySet<string>;
  /** The account a credential answers for, or none; a failure is the auth service's, refused as unavailable. */
  readonly resolveUserId: (
    credential: RelayCredential,
  ) => Effect.Effect<Option.Option<string>, Cause.UnknownError>;
  readonly dependencies: TunnelDependencies;
}

/** The tunnel's service for one function instance (`standRelay`): one socket per bridge, under the account its credential resolves to. */
export function standTunnel(options: TunnelOptions): Effect.Effect<void, never, Scope.Scope> {
  return standRelay({
    server: options.server,
    sockets: { maxPayload: MAXIMUM_FRAME_BYTES, perMessageDeflate: false },
    admit: (request) => admitTunnelUpgrade(request.url, request.headers, options.ownOrigins),
    accept: (decision): Effect.Effect<{ readonly status: number } | TunnelAsk> =>
      Effect.match(options.resolveUserId(decision.credential), {
        onFailure: () => ({ status: RELAY_UPGRADE_STATUS.SERVICE_UNAVAILABLE }),
        onSuccess: (account) =>
          Option.isNone(account)
            ? { status: RELAY_UPGRADE_STATUS.UNAUTHORIZED }
            : { ...decision.ask, userId: account.value },
      }),
    relay: (ask, device) => relayTunnel(device, ask, options.dependencies),
  });
}
