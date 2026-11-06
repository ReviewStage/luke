import {
  CONNECTION_HEALTH,
  type ConnectionHealth,
  type IntegrationTool,
} from "@repo/features/integration-health";
import { SIGN_IN, type SignIn, signInLine } from "@repo/features/integration-sign-in";
import {
  INTEGRATION_NAME,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
  type IntegrationAccount,
  type IntegrationProvider,
  type IntegrationStatus,
  integrationAccountNames,
} from "@repo/features/integration-wire";
import { INTEGRATION_LABEL, readFailedWords } from "@repo/features/words";
import { matchIntegration } from "./integration-search.js";
import { searchTokens } from "./search-tokens.js";

export const SERVER_ROW = {
  SWITCH: "switch",
  CONNECT: "connect",
  RECONNECT: "reconnect",
  SIGNING_IN: "signing-in",
  TRY_AGAIN: "try-again",
  QUIET: "quiet",
  RETRY: "retry",
} as const;

type ServerRowKind = (typeof SERVER_ROW)[keyof typeof SERVER_ROW];

export const SERVER_ACTION = {
  CONNECT: "Connect",
  RECONNECT: "Reconnect",
  RETRY: "Retry",
} as const;

export const SERVERS_LABEL = INTEGRATION_LABEL.many;

export interface ServerRow {
  readonly provider: IntegrationProvider;
  readonly connection: string;
  readonly account?: IntegrationAccount;
  readonly accounts: number;
  readonly name: string;
  readonly accountName?: string;
  readonly kind: ServerRowKind;
  readonly on: boolean;
  readonly tools?: readonly IntegrationTool[];
  readonly problem?: string;
  readonly said?: string;
  readonly note?: string;
}

function kindOf(
  status: IntegrationStatus | undefined,
  health: ConnectionHealth,
  signIn: SignIn | undefined,
  readFailed: boolean,
): ServerRowKind {
  if (status === undefined) return readFailed ? SERVER_ROW.RETRY : SERVER_ROW.QUIET;
  if (status !== INTEGRATION_STATUS.CONNECTED && signIn !== undefined) {
    return signIn.kind === SIGN_IN.WAITING ? SERVER_ROW.SIGNING_IN : SERVER_ROW.TRY_AGAIN;
  }
  switch (status) {
    case INTEGRATION_STATUS.CONNECTED:
      return health.kind === CONNECTION_HEALTH.BROKEN && health.reconnect
        ? SERVER_ROW.RECONNECT
        : SERVER_ROW.SWITCH;
    case INTEGRATION_STATUS.PENDING:
    case INTEGRATION_STATUS.DISCONNECTED:
      return SERVER_ROW.CONNECT;
    case INTEGRATION_STATUS.EXPIRED:
      return SERVER_ROW.RECONNECT;
    case INTEGRATION_STATUS.UNAVAILABLE:
      return SERVER_ROW.QUIET;
  }
}

function saidOf(said: string | undefined): Pick<ServerRow, "said"> {
  return said === undefined ? {} : { said };
}

function wordsOf(
  provider: IntegrationProvider,
  status: IntegrationStatus | undefined,
  health: ConnectionHealth,
  signIn: SignIn | undefined,
): Pick<ServerRow, "problem" | "said" | "note"> | undefined {
  if (status === INTEGRATION_STATUS.CONNECTED) {
    if (health.kind === CONNECTION_HEALTH.BROKEN) {
      return { problem: health.problem, ...saidOf(health.said) };
    }
    return health.kind === CONNECTION_HEALTH.FAILED
      ? { problem: readFailedWords("the tools") }
      : undefined;
  }
  if (signIn === undefined) return undefined;
  const { text, problem, said } = signInLine(provider, signIn);
  return problem ? { problem: text, ...saidOf(said) } : { note: text };
}

export function serverAccountName(
  connection: string,
  accounts: readonly IntegrationAccount[],
): string | undefined {
  const named = integrationAccountNames(accounts).get(connection);
  const labeled = accounts.some(
    (account) => account.connection === connection && (account.label ?? "").trim() !== "",
  );
  return named !== undefined && (accounts.length > 1 || labeled) ? named : undefined;
}

export function serverName(
  provider: IntegrationProvider,
  connection: string,
  accounts: readonly IntegrationAccount[],
): string {
  const accountName = serverAccountName(connection, accounts);
  return accountName === undefined
    ? INTEGRATION_NAME[provider]
    : `${INTEGRATION_NAME[provider]} · ${accountName}`;
}

export function serverRows(input: {
  statusOf: (server: string) => IntegrationStatus | undefined;
  healthOf: (server: string) => ConnectionHealth;
  signInOf: (server: string) => SignIn | undefined;
  accountsOf?: (provider: IntegrationProvider) => readonly IntegrationAccount[];
  readFailed: boolean;
  disabled: readonly string[];
}): readonly ServerRow[] {
  const offered = INTEGRATION_PROVIDER_LIST.filter(
    (provider) => input.statusOf(provider) !== INTEGRATION_STATUS.UNAVAILABLE,
  );
  return offered.flatMap((provider) => {
    const accounts = input.accountsOf?.(provider) ?? [];
    const servers = accounts.length > 0 ? accounts : [undefined];
    return servers.map((account): ServerRow => {
      const connection = account?.connection ?? provider;
      const status = input.statusOf(connection);
      const health = input.healthOf(connection);
      const signIn = input.signInOf(connection);
      const connected = status === INTEGRATION_STATUS.CONNECTED;
      const accountName = serverAccountName(connection, accounts);
      return {
        provider,
        connection,
        ...(account !== undefined ? { account } : undefined),
        accounts: accounts.length,
        name: serverName(provider, connection, accounts),
        ...(accountName !== undefined ? { accountName } : undefined),
        kind: kindOf(status, health, signIn, input.readFailed),
        on: !input.disabled.includes(connection),
        ...(connected && health.kind === CONNECTION_HEALTH.WORKING
          ? { tools: health.tools }
          : undefined),
        ...wordsOf(provider, status, health, signIn),
      };
    });
  });
}

export const SERVER_SECTION = {
  CONNECTED: "Connected",
  NOT_CONNECTED: "Not connected",
} as const;

type ServerSection = (typeof SERVER_SECTION)[keyof typeof SERVER_SECTION];

export interface ServerGroup {
  readonly heading: ServerSection | undefined;
  readonly rows: readonly ServerRow[];
}

function sectionOf(row: ServerRow): ServerSection | undefined {
  switch (row.kind) {
    case SERVER_ROW.SWITCH:
    case SERVER_ROW.RECONNECT:
      return SERVER_SECTION.CONNECTED;
    case SERVER_ROW.CONNECT:
    case SERVER_ROW.SIGNING_IN:
    case SERVER_ROW.TRY_AGAIN:
      return SERVER_SECTION.NOT_CONNECTED;
    case SERVER_ROW.QUIET:
    case SERVER_ROW.RETRY:
      return undefined;
  }
}

export function serverGroups(rows: readonly ServerRow[]): readonly ServerGroup[] {
  const order = [undefined, SERVER_SECTION.CONNECTED, SERVER_SECTION.NOT_CONNECTED] as const;
  return order
    .map((heading) => ({ heading, rows: rows.filter((row) => sectionOf(row) === heading) }))
    .filter((group) => group.rows.length > 0);
}

export function serversOnWords(rows: readonly ServerRow[]): string {
  return `${rows.filter((row) => row.on).length} of ${rows.length} on`;
}

export function opensTools(row: ServerRow): boolean {
  return row.kind === SERVER_ROW.SWITCH && row.tools !== undefined && row.tools.length > 0;
}

export interface ToolHit {
  readonly row: ServerRow;
  readonly tool: IntegrationTool;
}

export interface ServerSearch {
  readonly rows: readonly ServerRow[];
  readonly tools: readonly ToolHit[];
}

export function searchServers(rows: readonly ServerRow[], query: string): ServerSearch {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return { rows, tools: [] };
  const found = rows.map((row) => ({
    row,
    match: matchIntegration(row.provider, row.tools ?? [], tokens),
    labeled:
      row.account !== undefined && tokens.every((token) => row.name.toLowerCase().includes(token)),
  }));
  return {
    rows: found.flatMap(({ row, match, labeled }) => (match?.named || labeled ? [row] : [])),
    tools: found.flatMap(({ row, match }) => (match?.tools ?? []).map((tool) => ({ row, tool }))),
  };
}

export interface NamedServer {
  readonly provider: IntegrationProvider;
  readonly connection: string;
  readonly name: string;
}

export function namedServers(input: {
  statusOf: (server: string) => IntegrationStatus | undefined;
  accountsOf: (provider: IntegrationProvider) => readonly IntegrationAccount[];
  standing: (status: IntegrationStatus | undefined) => boolean;
}): readonly NamedServer[] {
  return INTEGRATION_PROVIDER_LIST.flatMap((provider) => {
    const accounts = input.accountsOf(provider);
    const servers: readonly NamedServer[] =
      accounts.length === 0
        ? [{ provider, connection: provider, name: INTEGRATION_NAME[provider] }]
        : accounts.map((account) => ({
            provider,
            connection: account.connection,
            name: serverName(provider, account.connection, accounts),
          }));
    return servers.filter((server) => input.standing(input.statusOf(server.connection)));
  });
}

export function switchedServers(
  disabled: readonly string[],
  connection: string,
  on: boolean,
): readonly string[] {
  const others = disabled.filter((each) => each !== connection);
  return on ? others : [...others, connection];
}

export const SERVER_HANDED = {
  OPENS: "opens",
  STEERS: "steers",
} as const;

export type ServerHanded = (typeof SERVER_HANDED)[keyof typeof SERVER_HANDED];

export const SERVER_MENTION_NOTE = {
  OFF_OPENS: "This message hands it to the turn it opens alone; the switch stays off.",
  OFF_STEERS:
    "Sent into a turn under way, this message hands it to the next turn alone; the switch stays off.",
  NOT_CONNECTED: "Not connected, so no agent is handed it.",
  EXPIRED: "Sign-in expired. A call to it asks you to reconnect it first.",
} as const;

export function serverMentionNote(
  row: ServerRow,
  agent: { readonly handed: ServerHanded | undefined } | undefined,
): string | undefined {
  switch (row.kind) {
    case SERVER_ROW.CONNECT:
    case SERVER_ROW.TRY_AGAIN:
      return SERVER_MENTION_NOTE.NOT_CONNECTED;
    case SERVER_ROW.RECONNECT:
      return row.problem === undefined ? SERVER_MENTION_NOTE.EXPIRED : undefined;
    case SERVER_ROW.SIGNING_IN:
    case SERVER_ROW.QUIET:
    case SERVER_ROW.RETRY:
      return undefined;
    case SERVER_ROW.SWITCH:
      if (agent?.handed === undefined || row.on) return undefined;
      return agent.handed === SERVER_HANDED.STEERS
        ? SERVER_MENTION_NOTE.OFF_STEERS
        : SERVER_MENTION_NOTE.OFF_OPENS;
  }
}
