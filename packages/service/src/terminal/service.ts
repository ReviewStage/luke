import type { IncomingHttpHeaders } from "node:http";
import { TERMINAL_RELAY } from "@repo/features/terminal-wire";
import { readEither } from "@repo/wire/effect";
import { type Cause, Effect, Option, Result, Schema, type Scope } from "effect";
import { unparsedWire, wireUuidSchema } from "../core.js";
import {
  RELAY_UPGRADE_STATUS,
  type RelayCredential,
  type RelayServer,
  relayCredential,
  relayServer,
  standRelay,
} from "../http/relay-upgrade.js";
import { type RelayAsk, type RelayDependencies, relayTerminal } from "./relay.js";

const MAXIMUM_FRAME_BYTES = 1024 * 1024;

const SizeSchema = Schema.NumberFromString.pipe(
  Schema.decodeTo(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000 }))),
);

const readId = readEither(wireUuidSchema);
const readSize = readEither(SizeSchema);

export type RelayUpgrade =
  | { readonly status: number }
  | { readonly credential: RelayCredential; readonly ask: Omit<RelayAsk, "userId"> };

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

export function terminalRelayServer(): RelayServer {
  return relayServer(TERMINAL_RELAY.PATH);
}

export interface TerminalRelayOptions {
  readonly server: RelayServer;
  readonly ownOrigins: ReadonlySet<string>;
  readonly resolveUserId: (
    credential: RelayCredential,
  ) => Effect.Effect<Option.Option<string>, Cause.UnknownError>;
  readonly dependencies: RelayDependencies;
}

export function standTerminalRelay(
  options: TerminalRelayOptions,
): Effect.Effect<void, never, Scope.Scope> {
  return standRelay({
    server: options.server,
    sockets: { maxPayload: MAXIMUM_FRAME_BYTES },
    admit: (request) => admitRelayUpgrade(request.url, request.headers, options.ownOrigins),
    accept: (decision): Effect.Effect<{ readonly status: number } | RelayAsk> =>
      Effect.match(options.resolveUserId(decision.credential), {
        onFailure: () => ({ status: RELAY_UPGRADE_STATUS.SERVICE_UNAVAILABLE }),
        onSuccess: (account) =>
          Option.isNone(account)
            ? { status: RELAY_UPGRADE_STATUS.UNAUTHORIZED }
            : { ...decision.ask, userId: account.value },
      }),
    relay: (ask, device) => relayTerminal(device, ask, options.dependencies),
  });
}
