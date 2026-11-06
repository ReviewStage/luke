import { SANDBOX_BROWSER } from "../browser/sandbox-browser.js";
import type { CommandAsk, CommandRun } from "../vercel-sandbox-api.js";

const SOCKET_TABLES = ["/proc/net/tcp", "/proc/net/tcp6"] as const;

const TABLE_HEADER = "local_address";

const COLUMN = { LOCAL_ADDRESS: 1, STATE: 3, UID: 7 } as const;

const LISTEN_STATE = "0A";

const ROOT_UID = "0";

const OWN_PORTS: ReadonlySet<number> = new Set([SANDBOX_BROWSER.DEVTOOLS_PORT]);

export function readSocketTables(): CommandAsk {
  return { command: "cat", args: [...SOCKET_TABLES] };
}

function keptPort(row: string): number | undefined {
  const columns = row.trim().split(/\s+/);
  if (columns[COLUMN.STATE] !== LISTEN_STATE || columns[COLUMN.UID] === ROOT_UID) return undefined;
  const port = Number.parseInt(columns[COLUMN.LOCAL_ADDRESS]?.split(":").at(-1) ?? "", 16);
  return OWN_PORTS.has(port) ? undefined : port;
}

export function listeningPortsOf(run: CommandRun): readonly number[] | undefined {
  if (!run.stdout.includes(TABLE_HEADER)) return undefined;
  const ports = new Set<number>();
  for (const row of run.stdout.split("\n")) {
    const port = keptPort(row);
    if (port !== undefined) ports.add(port);
  }
  return [...ports].sort((a, b) => a - b);
}
