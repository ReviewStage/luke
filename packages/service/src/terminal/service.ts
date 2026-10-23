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

import type { IncomingHttpHeaders } from "node:http";
import { TERMINAL_RELAY } from "@luke/features/terminal-wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Option, Result, Schema, type Scope } from "effect";
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

/** The HTTP face of the terminal relay at its path (`relayServer`). */
export function terminalRelayServer(): RelayServer {
  return relayServer(TERMINAL_RELAY.PATH);
}

export interface TerminalRelayOptions {
  readonly server: RelayServer;
  /** The origins the deployment's own pages are served from, the only ones a page's upgrade is taken from. */
  readonly ownOrigins: ReadonlySet<string>;
  /** The account a credential answers for, or none. */
  readonly resolveUserId: (credential: RelayCredential) => Effect.Effect<Option.Option<string>>;
  readonly dependencies: RelayDependencies;
}

/** The terminal relay's service for one function instance (`standRelay`): one socket per attached shell, under the account its credential resolves to. */
export function standTerminalRelay(
  options: TerminalRelayOptions,
): Effect.Effect<void, never, Scope.Scope> {
  return standRelay({
    server: options.server,
    sockets: { maxPayload: MAXIMUM_FRAME_BYTES },
    admit: (request) => admitRelayUpgrade(request.url, request.headers, options.ownOrigins),
    accept: (decision): Effect.Effect<{ readonly status: number } | RelayAsk> =>
      Effect.map(options.resolveUserId(decision.credential), (account) =>
        Option.isNone(account)
          ? { status: RELAY_UPGRADE_STATUS.UNAUTHORIZED }
          : { ...decision.ask, userId: account.value },
      ),
    relay: (ask, device) => relayTerminal(device, ask, options.dependencies),
  });
}
