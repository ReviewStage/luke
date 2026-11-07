/**
 * listening-ports.ts -- the TCP ports a server listens on in an agent's running sandbox: the command that reads the kernel's socket tables, and the ports read back from what it printed.
 *
 * The tables are read from `/proc/net/tcp` and `/proc/net/tcp6` rather
 * than `ss`, which the sandbox's image does not carry: one `cat`, quick
 * enough for the desktop to ask every few seconds. A socket is kept where
 * it listens and is not one of our own. Ours are the agent's browser's DevTools port
 * (`SANDBOX_BROWSER.DEVTOOLS_PORT`), the share helper's (`PORT_SHARE.HELPER_PORT`), and whatever root holds: a member's
 * server runs as the sandbox's default user and an agent's as its own,
 * while the sandbox's own init, which serves the sandbox's API, listens as
 * root.
 */

import { SANDBOX_BROWSER } from "../browser/sandbox-browser.js";
import type { CommandAsk, CommandRun } from "../vercel-sandbox-api.js";
import { PORT_SHARE } from "./port-share.js";

/** The kernel's TCP socket tables, IPv4's and IPv6's; a kernel without IPv6 has no second one, and `cat` prints the first alone. */
const SOCKET_TABLES = ["/proc/net/tcp", "/proc/net/tcp6"] as const;

/** A table's header names the columns; one printed nowhere is a read that did not happen. */
const TABLE_HEADER = "local_address";

/** The columns of a table's row, split on whitespace: the local address and port, the state, and the owner's uid. */
const COLUMN = { LOCAL_ADDRESS: 1, STATE: 3, UID: 7 } as const;

/** The state a listening socket is in, as the kernel prints it (`TCP_LISTEN`). */
const LISTEN_STATE = "0A";

/** The uid of root, whose listeners are the sandbox's own. */
const ROOT_UID = "0";

/** Our own ports, apart from root's, that are never a server's to forward. */
const OWN_PORTS: ReadonlySet<number> = new Set([
  SANDBOX_BROWSER.DEVTOOLS_PORT,
  PORT_SHARE.HELPER_PORT,
]);

/** Reads the sandbox's socket tables, in the lines `listeningPortsOf` reads. */
export function readSocketTables(): CommandAsk {
  return { command: "cat", args: [...SOCKET_TABLES] };
}

/** The port a row listens on, where it is a listener the list keeps. */
function keptPort(row: string): number | undefined {
  const columns = row.trim().split(/\s+/);
  if (columns[COLUMN.STATE] !== LISTEN_STATE || columns[COLUMN.UID] === ROOT_UID) return undefined;
  const port = Number.parseInt(columns[COLUMN.LOCAL_ADDRESS]?.split(":").at(-1) ?? "", 16);
  return OWN_PORTS.has(port) ? undefined : port;
}

/**
 * The ports listened on, each once and the lowest first, from what the read
 * printed; nothing where it printed no table, which is an outage rather than
 * a sandbox with no servers. A port listened on over both IPv4 and IPv6 is
 * one port.
 */
export function listeningPortsOf(run: CommandRun): readonly number[] | undefined {
  if (!run.stdout.includes(TABLE_HEADER)) return undefined;
  const ports = new Set<number>();
  for (const row of run.stdout.split("\n")) {
    const port = keptPort(row);
    if (port !== undefined) ports.add(port);
  }
  return [...ports].sort((a, b) => a - b);
}
