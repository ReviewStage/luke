import {
  INTEGRATION_NAME,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
  type IntegrationProvider,
  type IntegrationStatus,
} from "@sidecar/hosted/integration-wire";

/**
 * agent-servers-model.ts -- what the MCP servers popover at an agent's composer says of each server: how many tools it offers, whether this agent has it on, or how to connect it.
 *
 * Every MCP server Luke hands a coding agent is one integration's, so the
 * popover has one row per integration provider, in the provider list's
 * order. A connected server carries a switch, on unless the agent switched
 * it off, which is all the agent's row keeps: a server connected later is on
 * for every agent. Its row names how many tools the server offers once they
 * have been read, and that count opens the list of them. A server not
 * connected offers to connect it, there and then; one whose sign-in expired
 * offers to reconnect; one this deployment does not offer is a dimmed row
 * with nothing to press. No row says where it stands in words: the switch,
 * the count, and the button are what say it. A read of the connections that
 * failed is the one error, offered as a way to read again.
 */

/** The kinds of row the popover draws. */
export const SERVER_ROW = {
  /** Connected: a switch for this agent, and the count of its tools. */
  SWITCH: "switch",
  /** Not connected, or a sign-in under way: connect it from here. */
  CONNECT: "connect",
  /** Its sign-in expired: connect it again from here. */
  RECONNECT: "reconnect",
  /** Nothing to do from here: this deployment offers no such server, or the read has not answered yet. */
  QUIET: "quiet",
  /** The read of the connections failed: read again. */
  RETRY: "retry",
} as const;

type ServerRowKind = (typeof SERVER_ROW)[keyof typeof SERVER_ROW];

/** What a row offers at its end where it offers a press but no switch. */
export const SERVER_ACTION = {
  CONNECT: "Connect",
  RECONNECT: "Reconnect",
  RETRY: "Try again",
} as const;

/** What the popover and its button are called. */
export const SERVERS_LABEL = "MCP servers";

/** How a connected server's count of tools reads. */
export function toolsCount(count: number): string {
  return count === 1 ? "1 tool" : `${count} tools`;
}

/** One server's row. */
export interface ServerRow {
  readonly provider: IntegrationProvider;
  readonly name: string;
  readonly kind: ServerRowKind;
  /** Whether the agent has it on; a row with no switch has it on only by default, which is never drawn. */
  readonly on: boolean;
}

/** What a row is, from where its connection stands; nothing is a read that has not answered. */
function kindOf(status: IntegrationStatus | undefined, readFailed: boolean): ServerRowKind {
  if (status === undefined) return readFailed ? SERVER_ROW.RETRY : SERVER_ROW.QUIET;
  switch (status) {
    case INTEGRATION_STATUS.CONNECTED:
      return SERVER_ROW.SWITCH;
    case INTEGRATION_STATUS.PENDING:
    case INTEGRATION_STATUS.DISCONNECTED:
      return SERVER_ROW.CONNECT;
    case INTEGRATION_STATUS.EXPIRED:
      return SERVER_ROW.RECONNECT;
    case INTEGRATION_STATUS.UNAVAILABLE:
      return SERVER_ROW.QUIET;
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
    kind: kindOf(input.statusOf(provider), input.readFailed),
    on: !input.disabled.includes(provider),
  }));
}

/** The first server this agent has on whose sign-in expired, which its composer offers to reconnect; none while every one stands. */
export function lapsedServer(input: {
  statusOf: (provider: IntegrationProvider) => IntegrationStatus | undefined;
  disabled: readonly IntegrationProvider[];
}): IntegrationProvider | undefined {
  return INTEGRATION_PROVIDER_LIST.find(
    (provider) =>
      input.statusOf(provider) === INTEGRATION_STATUS.EXPIRED && !input.disabled.includes(provider),
  );
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
