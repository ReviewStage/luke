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
const readText = readEither(Schema.String);

export type TunnelUpgrade =
  | { readonly status: number }
  | { readonly credential: RelayCredential; readonly ask: Omit<TunnelAsk, "userId"> };

function bridgeOf(
  query: (name: string) => ReturnType<typeof unparsedWire>,
): TunnelBridge | undefined {
  const kind = readKind(query(SANDBOX_TUNNEL.QUERY.KIND));
  if (Result.isFailure(kind)) return undefined;
  if (kind.success === TUNNEL_KIND.MIRROR) {
    const wake = Result.getOrUndefined(readText(query(SANDBOX_TUNNEL.QUERY.WAKE)));
    return { kind: kind.success, wake: wake === SANDBOX_TUNNEL.WAKE_ASKED };
  }
  const port = readPort(query(SANDBOX_TUNNEL.QUERY.PORT));
  return Result.isFailure(port) ? undefined : { kind: kind.success, port: port.success };
}

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

export function tunnelServer(): RelayServer {
  return relayServer(SANDBOX_TUNNEL.PATH);
}

export interface TunnelOptions {
  readonly server: RelayServer;
  readonly ownOrigins: ReadonlySet<string>;
  readonly resolveUserId: (
    credential: RelayCredential,
  ) => Effect.Effect<Option.Option<string>, Cause.UnknownError>;
  readonly dependencies: TunnelDependencies;
}

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
