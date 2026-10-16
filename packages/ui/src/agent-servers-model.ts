import {
  CONNECTION_HEALTH,
  type ConnectionHealth,
  type IntegrationTool,
} from "@luke/features/integration-health";
import { SIGN_IN, type SignIn, signInLine } from "@luke/features/integration-sign-in";
import {
  INTEGRATION_NAME,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
  type IntegrationAccount,
  type IntegrationProvider,
  type IntegrationStatus,
  integrationAccountNames,
} from "@luke/features/integration-wire";
import { matchIntegration } from "./integration-search.js";
import { searchTokens } from "./search-tokens.js";

/**
 * agent-servers-model.ts -- what the MCP servers popover at an agent's composer says of each server: how many tools it offers, whether this agent has it on, or how to connect it; which section it stands under; and what a search of it finds.
 *
 * Every MCP server Luke hands a coding agent is one account at an
 * integration, so the popover has one row per account the Luke account
 * holds at each provider the deployment offers it, and one for a provider
 * where it holds none, in the provider list's order. A provider with more
 * than one account names each row by its label ("Notion · Acme"), and one
 * with a single account by the provider alone, as it always has. A connected server carries a
 * switch, on unless the agent switched it off, which is all the agent's row
 * keeps: a server connected later is on for every agent. Its row names how
 * many tools the server offers once they have been read, and that count
 * opens the list of them. A server not
 * connected offers to connect it, there and then; one whose sign-in expired,
 * or connected but whose server refused it or answered an error of its own
 * (`@luke/features/integration-health`), offers to reconnect, the latter with the
 * server's reason beside its name; one whose server could not be reached
 * keeps its switch, with that said beside its name; one whose sign-in the
 * window waits on offers to reopen or cancel it, and one whose sign-in
 * failed or never finished says so and offers to try again, as Settings
 * does (`@luke/features/integration-sign-in`); one this
 * deployment does not offer the account is not drawn at all, as the agent is never
 * handed it. No other row says where it stands in words: the switch, the
 * count, and the buttons are what say it. A read of the connections that
 * failed is the one error, offered as a way to read again. The rows stand
 * under Connected, a lapsed connection among them, and Not connected, a
 * sign-in under way or one that did not finish among the latter; one whose
 * standing is unread stands first under no heading. A search finds servers
 * by name or what they are for, and every connected server's tools by name
 * or description, as Settings › Integrations' filter does
 * (`integration-search.ts`).
 */

/** The kinds of row the popover draws. */
export const SERVER_ROW = {
  /** Connected: a switch for this agent, and the count of its tools. */
  SWITCH: "switch",
  /** Not connected, or a sign-in under way: connect it from here. */
  CONNECT: "connect",
  /** Its sign-in expired, or its server will not list its tools: connect it again from here. */
  RECONNECT: "reconnect",
  /** A sign-in the window waits on: reopen it in the browser, or cancel it. */
  SIGNING_IN: "signing-in",
  /** A sign-in that failed or never finished: begin it again from here. */
  TRY_AGAIN: "try-again",
  /** Nothing to do from here yet: the read has not answered. */
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

/** One server's row. */
export interface ServerRow {
  readonly provider: IntegrationProvider;
  /** The server's name: its account's connection name, or the provider's where it holds none. */
  readonly connection: string;
  /** The account the row stands for, where the Luke account holds one at the provider. */
  readonly account?: IntegrationAccount;
  /** How many accounts the Luke account holds at the provider. */
  readonly accounts: number;
  readonly name: string;
  readonly kind: ServerRowKind;
  /** Whether the agent has it on; a row with no switch has it on only by default, which is never drawn. */
  readonly on: boolean;
  /** A connected server's tools, once it answered with them. */
  readonly tools?: readonly IntegrationTool[];
  /** Why a connected server lists no tools, where it answered why, or why its sign-in failed. */
  readonly problem?: string;
  /** Where a sign-in stands that is no problem: waiting on the browser, or never finished. */
  readonly note?: string;
}

/**
 * What a row is, from where its connection stands, how its server answered,
 * and the sign-in the window waits on or last waited on; nothing is a read
 * that has not answered.
 */
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
    // Never drawn: `serverRows` leaves a server the deployment does not offer out.
    case INTEGRATION_STATUS.UNAVAILABLE:
      return SERVER_ROW.QUIET;
  }
}

/** What a row says of where it stands in words: a connected server's problem, or its sign-in's line. */
function wordsOf(
  provider: IntegrationProvider,
  status: IntegrationStatus | undefined,
  health: ConnectionHealth,
  signIn: SignIn | undefined,
): Pick<ServerRow, "problem" | "note"> | undefined {
  if (status === INTEGRATION_STATUS.CONNECTED) {
    return health.kind === CONNECTION_HEALTH.BROKEN ? { problem: health.problem } : undefined;
  }
  if (signIn === undefined) return undefined;
  const { text, problem } = signInLine(provider, signIn);
  return problem ? { problem: text } : { note: text };
}

/**
 * Every offered server's row, from where each connection stands, how each
 * connected server answered, the sign-ins the window waits on or last
 * waited on, and the servers the agent switched off. A
 * status read before is kept over a read that failed since, so a passing
 * failure does not take a server's switch away; a server whose status has
 * not been read is drawn until it is.
 */
export function serverRows(input: {
  statusOf: (server: string) => IntegrationStatus | undefined;
  healthOf: (server: string) => ConnectionHealth;
  signInOf: (server: string) => SignIn | undefined;
  /** The accounts held at a provider; a surface that draws none hands none. */
  accountsOf?: (provider: IntegrationProvider) => readonly IntegrationAccount[];
  readFailed: boolean;
  disabled: readonly string[];
}): readonly ServerRow[] {
  const offered = INTEGRATION_PROVIDER_LIST.filter(
    (provider) => input.statusOf(provider) !== INTEGRATION_STATUS.UNAVAILABLE,
  );
  return offered.flatMap((provider) => {
    const accounts = input.accountsOf?.(provider) ?? [];
    const names = integrationAccountNames(accounts);
    const servers = accounts.length > 0 ? accounts : [undefined];
    return servers.map((account): ServerRow => {
      const connection = account?.connection ?? provider;
      const status = input.statusOf(connection);
      const health = input.healthOf(connection);
      const signIn = input.signInOf(connection);
      const connected = status === INTEGRATION_STATUS.CONNECTED;
      const named = names.get(connection);
      return {
        provider,
        connection,
        ...(account !== undefined ? { account } : undefined),
        accounts: accounts.length,
        name:
          named !== undefined && accounts.length > 1
            ? `${INTEGRATION_NAME[provider]} · ${named}`
            : INTEGRATION_NAME[provider],
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

/** The headings the popover's servers stand under: those connected, then those to connect. */
export const SERVER_SECTION = {
  CONNECTED: "Connected",
  NOT_CONNECTED: "Not connected",
} as const;

type ServerSection = (typeof SERVER_SECTION)[keyof typeof SERVER_SECTION];

/** A run of rows under one heading, or under none. */
export interface ServerGroup {
  readonly heading: ServerSection | undefined;
  readonly rows: readonly ServerRow[];
}

/** Which heading a row stands under: none while where it stands is unread. */
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

/**
 * The rows in their sections, each in the provider list's order: any whose
 * standing is unread first under no heading, then Connected, then Not
 * connected, a section with no row left out.
 */
export function serverGroups(rows: readonly ServerRow[]): readonly ServerGroup[] {
  const order = [undefined, SERVER_SECTION.CONNECTED, SERVER_SECTION.NOT_CONNECTED] as const;
  return order
    .map((heading) => ({ heading, rows: rows.filter((row) => sectionOf(row) === heading) }))
    .filter((group) => group.rows.length > 0);
}

/** Whether a row opens onto its server's tools: connected, and its server answered with at least one. */
export function opensTools(row: ServerRow): boolean {
  return row.kind === SERVER_ROW.SWITCH && row.tools !== undefined && row.tools.length > 0;
}

/** One tool a search found, with the server that offers it. */
export interface ToolHit {
  readonly row: ServerRow;
  readonly tool: IntegrationTool;
}

/** What a search of the popover finds: the servers it names, and the tools it finds (`integration-search.ts`). */
export interface ServerSearch {
  readonly rows: readonly ServerRow[];
  readonly tools: readonly ToolHit[];
}

/**
 * The servers and tools a query finds, as Settings › Integrations' filter
 * finds them; a blank query is every server and no tool. Note that the
 * tools found stay together by server, in the provider list's order and
 * alphabetical within each, because a server's tools read best beside each
 * other and each names its server once in the same place.
 */
export function searchServers(rows: readonly ServerRow[], query: string): ServerSearch {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return { rows, tools: [] };
  const found = rows.map((row) => ({
    row,
    match: matchIntegration(row.provider, row.tools ?? [], tokens),
    // An account's label finds its row too, so "personal" finds Notion · Personal.
    labelled: row.accounts > 1 && tokens.every((token) => row.name.toLowerCase().includes(token)),
  }));
  return {
    rows: found.flatMap(({ row, match, labelled }) => (match?.named || labelled ? [row] : [])),
    tools: found.flatMap(({ row, match }) => (match?.tools ?? []).map((tool) => ({ row, tool }))),
  };
}

/** One server as a surface names it: its provider, its connection, and what it is called beside its provider's others. */
export interface NamedServer {
  readonly provider: IntegrationProvider;
  readonly connection: string;
  readonly name: string;
}

/**
 * Every server the Luke account holds, standing as `status` says, in the
 * provider list's order: each account at a provider, named by its label
 * where the provider has more than one, and a provider with none by itself.
 */
export function namedServers(input: {
  statusOf: (server: string) => IntegrationStatus | undefined;
  accountsOf: (provider: IntegrationProvider) => readonly IntegrationAccount[];
  standing: (status: IntegrationStatus | undefined) => boolean;
}): readonly NamedServer[] {
  return INTEGRATION_PROVIDER_LIST.flatMap((provider) => {
    const accounts = input.accountsOf(provider);
    const names = integrationAccountNames(accounts);
    const servers: readonly NamedServer[] =
      accounts.length === 0
        ? [{ provider, connection: provider, name: INTEGRATION_NAME[provider] }]
        : accounts.map((account) => ({
            provider,
            connection: account.connection,
            name:
              accounts.length > 1
                ? `${INTEGRATION_NAME[provider]} · ${names.get(account.connection)}`
                : INTEGRATION_NAME[provider],
          }));
    return servers.filter((server) => input.standing(input.statusOf(server.connection)));
  });
}

/** The first server this agent has on whose sign-in expired, which its composer offers to reconnect; none while every one stands. */
export function lapsedServer(input: {
  statusOf: (server: string) => IntegrationStatus | undefined;
  accountsOf: (provider: IntegrationProvider) => readonly IntegrationAccount[];
  disabled: readonly string[];
}): NamedServer | undefined {
  return namedServers({
    ...input,
    standing: (status) => status === INTEGRATION_STATUS.EXPIRED,
  }).find((server) => !input.disabled.includes(server.connection));
}

/**
 * The servers off once one is switched, each once: the connection switched
 * off where it is now off, and every other one already off kept, an account
 * this window draws no row of among them.
 */
export function switchedServers(
  disabled: readonly string[],
  connection: string,
  on: boolean,
): readonly string[] {
  const others = disabled.filter((each) => each !== connection);
  return on ? others : [...others, connection];
}

/** How the developer's words reach the agent they are written to: they open its turn, or reach one already under way. */
export const SERVER_HANDED = {
  OPENS: "opens",
  STEERS: "steers",
} as const;

export type ServerHanded = (typeof SERVER_HANDED)[keyof typeof SERVER_HANDED];

/** What a server's card says of what a mention of it does. */
export const SERVER_MENTION_NOTE = {
  ON: "On for this agent.",
  ON_NAMED: "On for this agent, and this message names it.",
  OFF: "Off for this agent.",
  OFF_OPENS:
    "Off for this agent. This message hands it to the turn it opens alone; the switch stays off.",
  OFF_STEERS:
    "Off for this agent. Sent into a turn under way, this message hands it to the next turn alone; the switch stays off.",
  NOT_CONNECTED: "Not connected, so no agent is handed it.",
  EXPIRED: "Its sign-in expired, so no agent is handed it until it is reconnected.",
} as const;

/**
 * What a server's card says of a mention of it, from its row and the agent
 * the words are written to, if any, and how they reach it: an agent with
 * the server on has it anyway, and one with it off is handed it for one
 * turn, the one the words open or, where they reached a turn under way, the
 * next, its switch untouched (the service's `mentionedServers`); a server
 * not connected, or whose sign-in expired, is handed to no agent. Nothing
 * where the row already says it, a problem of its server's or a sign-in
 * under way, or nothing is read yet.
 */
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
      if (agent === undefined) return undefined;
      if (row.on) {
        return agent.handed === undefined ? SERVER_MENTION_NOTE.ON : SERVER_MENTION_NOTE.ON_NAMED;
      }
      if (agent.handed === undefined) return SERVER_MENTION_NOTE.OFF;
      return agent.handed === SERVER_HANDED.STEERS
        ? SERVER_MENTION_NOTE.OFF_STEERS
        : SERVER_MENTION_NOTE.OFF_OPENS;
  }
}
