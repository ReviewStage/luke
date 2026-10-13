import {
  INTEGRATION_NAME,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
  type IntegrationProvider,
  type IntegrationStatus,
} from "@sidecar/hosted/integration-wire";

/**
 * agent-servers-model.ts -- what the MCP servers popover at an agent's composer says of each server: where its connection stands and whether this agent has it on.
 *
 * Every MCP server Luke hands a coding agent is one integration's, so the
 * popover has one row per integration provider, in the provider list's
 * order. A connected server carries a switch, on unless the agent switched
 * it off, which is all the agent's row keeps: a server connected later is on
 * for every agent. A server that is not connected, whose sign-in expired, or
 * that this deployment does not offer carries no switch, since there is
 * nothing to hand the agent either way, and says why in muted words; the two
 * the developer can mend in Settings say so. A read of the connections that
 * failed is the one error, said on every row with a way to read again.
 */

/** The kinds of row the popover draws. */
export const SERVER_ROW = {
  /** Connected: a switch for this agent. */
  SWITCH: "switch",
  /** Mended in Settings › Integrations: not connected, or its sign-in expired. */
  CONNECT: "connect",
  /** Nothing to do from here: this deployment offers no such server, or the read has not answered yet. */
  QUIET: "quiet",
  /** The read of the connections failed: read again. */
  RETRY: "retry",
} as const;

type ServerRowKind = (typeof SERVER_ROW)[keyof typeof SERVER_ROW];

/** The muted words a row says of its server. */
const SERVER_STATE = {
  CONNECTED: "Connected",
  NOT_CONNECTED: "Not connected",
  EXPIRED: "Sign-in expired",
  NOT_AVAILABLE: "Not available",
  READING: "Checking…",
  ERROR: "Error",
} as const;

/** What a row offers at its end where it offers a press but no switch. */
export const SERVER_ACTION = {
  CONNECT: "Connect in Settings",
  RETRY: "Try again",
} as const;

/** The quiet line under the rows: a turn under way keeps what it was handed. */
export const SERVERS_NOTE = "Changes apply from the agent's next turn.";

/** What the popover and its button are called. */
export const SERVERS_LABEL = "MCP servers";

/** One server's row. */
export interface ServerRow {
  readonly provider: IntegrationProvider;
  readonly name: string;
  readonly kind: ServerRowKind;
  readonly state: string;
  /** Whether the agent has it on; a row with no switch has it on only by default, which is never drawn. */
  readonly on: boolean;
}

/** What a row is, from where its connection stands; nothing is a read that has not answered. */
function rowOf(
  status: IntegrationStatus | undefined,
  readFailed: boolean,
): Pick<ServerRow, "kind" | "state"> {
  if (status === undefined) {
    return readFailed
      ? { kind: SERVER_ROW.RETRY, state: SERVER_STATE.ERROR }
      : { kind: SERVER_ROW.QUIET, state: SERVER_STATE.READING };
  }
  switch (status) {
    case INTEGRATION_STATUS.CONNECTED:
      return { kind: SERVER_ROW.SWITCH, state: SERVER_STATE.CONNECTED };
    case INTEGRATION_STATUS.PENDING:
    case INTEGRATION_STATUS.DISCONNECTED:
      return { kind: SERVER_ROW.CONNECT, state: SERVER_STATE.NOT_CONNECTED };
    case INTEGRATION_STATUS.EXPIRED:
      return { kind: SERVER_ROW.CONNECT, state: SERVER_STATE.EXPIRED };
    case INTEGRATION_STATUS.UNAVAILABLE:
      return { kind: SERVER_ROW.QUIET, state: SERVER_STATE.NOT_AVAILABLE };
  }
}

/**
 * Every server's row, from where each connection stands and the servers the
 * agent switched off. A status read before is kept over a read that failed
 * since, so a passing failure does not take a server's switch away.
 */
export function serverRows(input: {
  statusOf: (provider: IntegrationProvider) => IntegrationStatus | undefined;
  readFailed: boolean;
  disabled: readonly IntegrationProvider[];
}): readonly ServerRow[] {
  return INTEGRATION_PROVIDER_LIST.map((provider) => ({
    provider,
    name: INTEGRATION_NAME[provider],
    ...rowOf(input.statusOf(provider), input.readFailed),
    on: !input.disabled.includes(provider),
  }));
}

/** The servers off once one is switched, in the provider list's order, each once. */
export function switchedServers(
  disabled: readonly IntegrationProvider[],
  provider: IntegrationProvider,
  on: boolean,
): readonly IntegrationProvider[] {
  return INTEGRATION_PROVIDER_LIST.filter((each) =>
    each === provider ? !on : disabled.includes(each),
  );
}
