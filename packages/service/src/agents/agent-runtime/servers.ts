/**
 * servers.ts -- which integrations' MCP servers one turn of an agent is handed, read as the turn starts.
 *
 * Every agent is handed its account's integrations through one dynamic
 * connection resolved at `turn.started` (`connections.ts`), and what it is
 * handed is its role's connection policy (`role.ts`), among the
 * integrations this deployment offers the account
 * (`accountIntegrationConnect`): one not set up here, or withheld from the
 * account, is handed to none of its agents. The planning agents are handed
 * every one offered. A coding agent is handed every one but those the
 * developer switched off for it from its composer, which writes
 * the agent's `disabled_servers` (`coding-agent-store.ts`); its worker's
 * session is admitted for its parent's conversation, so it follows its
 * parent agent's switches. A server the developer mentioned in a message to
 * a coding agent (`@Linear`) is handed to the next turn the agent starts
 * whatever its switch says, and to that turn alone: the turn takes the
 * mentions from the row as it reads its standing, and the switch is never
 * written. A worker takes none. A turn already running keeps what it was
 * handed, and eve tells the model at its next step when a connection came or
 * went.
 *
 * A Luke account may hold more than one account at a provider (two Notion
 * workspaces), and each is handed as a connection of its own, under the
 * name its row goes by (`notion`, `notion-2`): every one standing connected
 * or expired, and the bare provider for one with none, so its first call
 * says how to connect it, as before. The switches and the mentions name
 * connections, and a name stored before a second account was possible is
 * the provider's own, which is its first account's. The accounts read are
 * the caller's, the member acting in the conversation, as the grant each
 * connection reads is (`../../integrations/integration-connection.ts`), so
 * a mention of `notion-2` reaches the caller's own second account or none.
 * A provider with more than one account handed tells the model which each
 * is by its label alone, quoted as a string the label cannot step out of,
 * and to ask which one where the developer has not said, before it writes.
 * A conversation whose workspace connected Linear for every member is
 * handed Linear once, bare, because every Linear call of its turns runs on
 * the workspace's grant.
 *
 * The read fails closed: a turn whose admission or row could not be read is
 * handed no server, so one the developer switched off never comes back on
 * through a passing store failure, and the turn carries on without it. A
 * resolver that threw would fail the whole turn instead, which is why
 * nothing here throws. The log line keeps the failure's kind alone, since a
 * store failure's message may name a statement.
 */

import type { DatabaseServices, QueryError } from "@luke/database/core/query";
import {
  readCodingAgentOfConversation,
  takeCodingAgentMentionedServers,
} from "@luke/database/models/coding-agent-store";
import {
  INTEGRATION_GRANT,
  INTEGRATION_GRANT_OF,
  INTEGRATION_LABEL_MAX,
  INTEGRATION_NAME,
  INTEGRATION_PROVIDER,
  INTEGRATION_PROVIDER_LIST,
  type IntegrationProvider,
  integrationAccountNames,
  integrationConnectionOf,
} from "@luke/features/integration-wire";
import { causeKind } from "@luke/runtime/effect";
import { Effect, Option, Result, type Schema } from "effect";
import type { SessionAuth } from "eve/context";
import type { GitHubApp } from "../../github/github-app.js";
import { githubOffered } from "../../integrations/github-integration.js";
import {
  accountIntegrationConnect,
  type IntegrationConnect,
} from "../../integrations/integration-connect.js";
import {
  INTEGRATION_ROW_STATUS,
  type IntegrationConnectionRow,
  readIntegrationConnections,
} from "../../integrations/integration-store.js";
import {
  readConversationWorkspace,
  readWorkspaceIntegration,
} from "../../integrations/workspace-integration-store.js";
import type { ConversationAdmission } from "../brain-host/conversation.js";
import { CONNECTION_POLICY, type ConnectionPolicy } from "./role.js";

/** One connection a turn is handed: one account at a provider, by the name it goes by. */
interface HandedConnection {
  readonly provider: IntegrationProvider;
  /** eve's name for the connection, and the switch and mention that name it. */
  readonly connectionName: string;
  /** The account the connection is credentialed for, which eve keys its authorization state by. */
  readonly instanceKey: string;
  /** What the model is told of which account this is, beside the provider's own description, where the provider hands more than one. */
  readonly accountNote?: string;
}

/** Which servers a turn is handed, under the account they are credentialed for, or none. */
export type ServerStanding =
  | {
      readonly on: true;
      readonly account: string;
      readonly connections: readonly HandedConnection[];
    }
  | { readonly on: false };

const SERVERS_OFF: ServerStanding = { on: false };

/** How the session a turn runs in is admitted: a root's own standing, or a worker's ownership alone. */
type ServerAdmission = Effect.Effect<
  ConversationAdmission,
  QueryError | Schema.SchemaError,
  DatabaseServices
>;

/** How an agent's edge reads the standing for one session: its own admission and policy, run where the edge runs effects. */
export type ServerStandingRead = (auth: SessionAuth, sessionId: string) => Promise<ServerStanding>;

/**
 * The servers mentioned since the agent's last turn started, taken by the
 * turn starting now; none where the policy takes none. Note that a take
 * that failed hands only what the switches say rather than failing the
 * standing, so a passing store failure costs the turn a mention, never
 * every server.
 */
function takenMentions(
  policy: ConnectionPolicy,
  userId: string,
  conversationId: string,
): Effect.Effect<readonly string[], never, DatabaseServices> {
  if (policy !== CONNECTION_POLICY.AGENT_SWITCHES_AND_MENTIONS) return Effect.succeed([]);
  return takeCodingAgentMentionedServers(userId, conversationId).pipe(
    Effect.catchCause((cause) =>
      Effect.as(
        Effect.logWarning(
          `the turn took no mentioned server, its mentions unread: ${causeKind(cause)}`,
        ),
        [],
      ),
    ),
  );
}

/** Whether a row stands for a grant an agent may be handed: connected, or expired so its call says to connect it again. */
function handedRow(row: IntegrationConnectionRow): boolean {
  return (
    row.status === INTEGRATION_ROW_STATUS.CONNECTED || row.status === INTEGRATION_ROW_STATUS.EXPIRED
  );
}

/** The others an account note names, as one phrase: `"Personal"`, or `"Personal" and "Side"`. */
const OTHERS_SAID = new Intl.ListFormat("en", { type: "conjunction" });

/**
 * What the model is told of one account among its provider's others: its
 * label and the others' labels, never their connection names, which a
 * person never reads, and to ask which account where the developer has not
 * said, so a write lands in the account meant and is said to have.
 */
function accountNote(
  row: IntegrationConnectionRow,
  others: readonly IntegrationConnectionRow[],
): string {
  const name = INTEGRATION_NAME[row.provider];
  // Note that two accounts called alike are told apart by their places, so no two notes read the same.
  // Note that a label is cut to a label's length before two alike are told apart, so the place that tells them apart is never cut away.
  const names = integrationAccountNames(
    [row, ...others].map((each) => ({
      connection: each.connectionName,
      label: each.label?.slice(0, INTEGRATION_LABEL_MAX),
    })),
  );
  // Note that a label is quoted as a string literal, because a provider names it and the model reads it.
  const label = (each: IntegrationConnectionRow) =>
    JSON.stringify(names.get(each.connectionName) ?? "");
  return `This connection is the developer's ${label(row)} ${name} account. They also connected ${OTHERS_SAID.format(others.map(label))}. If the developer hasn't said which account, ask before writing. Say which account you read from or wrote to.`;
}

/**
 * The connections the account's rows hand for one provider: each account
 * standing connected or expired, with what the model is told of which it is
 * where there is more than one, or the bare provider where none stands.
 */
function providerConnections(
  provider: IntegrationProvider,
  rows: readonly IntegrationConnectionRow[],
  caller: string,
): readonly HandedConnection[] {
  const placeOf = (row: IntegrationConnectionRow) =>
    integrationConnectionOf(row.connectionName)?.place ?? Number.POSITIVE_INFINITY;
  const held = rows
    .filter((row) => row.provider === provider && handedRow(row))
    .toSorted((a, b) => placeOf(a) - placeOf(b));
  if (held.length === 0) return [{ provider, connectionName: provider, instanceKey: caller }];
  return held.map((row) => ({
    provider,
    connectionName: row.connectionName,
    instanceKey: row.connectSubject,
    ...(held.length > 1
      ? {
          accountNote: accountNote(
            row,
            held.filter((each) => each !== row),
          ),
        }
      : undefined),
  }));
}

/**
 * Whether the conversation's workspace connected Linear for every member,
 * standing connected or expired, so every member's Linear runs on its grant
 * (`../../integrations/integration-connection.ts`).
 */
const workspaceHoldsLinear = (conversationId: string) =>
  Effect.gen(function* () {
    const organizationId = yield* readConversationWorkspace(conversationId);
    if (organizationId === undefined) return false;
    const row = yield* readWorkspaceIntegration(organizationId, INTEGRATION_PROVIDER.LINEAR);
    return (
      row?.status === INTEGRATION_ROW_STATUS.CONNECTED ||
      row?.status === INTEGRATION_ROW_STATUS.EXPIRED
    );
  });

/**
 * The servers the turn starting is handed under the policy, among those
 * offered to the account: every one for a session admitted at all, and for
 * a coding agent every one its row does not list, and every one mentioned
 * since its last turn where the policy takes mentions; none for a session
 * the host does not admit, one admitted for no agent where the policy reads
 * an agent's switches, or a read that failed.
 */
export function turnServers(
  admission: ServerAdmission,
  policy: ConnectionPolicy,
): Effect.Effect<ServerStanding, never, DatabaseServices | IntegrationConnect | GitHubApp> {
  return Effect.gen(function* () {
    const admitted = yield* admission;
    if (Result.isFailure(admitted)) return SERVERS_OFF;
    const { caller } = admitted.success;
    const { userId, conversationId } = admitted.success.target;
    // The caller's own offer, as the accounts read and every token read are the caller's.
    const connect = yield* accountIntegrationConnect(caller);
    const github = yield* githubOffered;
    // A provider the account's GitHub sign-in grants is offered wherever the GitHub App is.
    const offered = INTEGRATION_PROVIDER_LIST.filter((provider) =>
      INTEGRATION_GRANT_OF[provider] === INTEGRATION_GRANT.GITHUB_SIGN_IN
        ? github
        : connect[provider].configured,
    );
    const rows = yield* readIntegrationConnections(caller);
    // Note that a workspace's own Linear is handed once, bare, because every Linear call of the turn runs on its grant, whatever account a label would name.
    const workspaceLinear = yield* workspaceHoldsLinear(conversationId);
    const handed = offered.flatMap((provider) =>
      provider === INTEGRATION_PROVIDER.LINEAR && workspaceLinear
        ? [{ provider, connectionName: provider, instanceKey: caller }]
        : providerConnections(provider, rows, caller),
    );
    if (policy === CONNECTION_POLICY.ALWAYS_ON) {
      return { on: true, account: userId, connections: handed } as const;
    }
    const agent = yield* readCodingAgentOfConversation(userId, conversationId);
    if (Option.isNone(agent)) return SERVERS_OFF;
    const { disabledServers } = agent.value;
    const mentioned = yield* takenMentions(policy, userId, conversationId);
    const connections = handed.filter(
      ({ connectionName }) =>
        !disabledServers.includes(connectionName) || mentioned.includes(connectionName),
    );
    return { on: true, account: userId, connections } as const;
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.as(
        Effect.logWarning(
          `the turn was handed no server, its standing unread: ${causeKind(cause)}`,
        ),
        SERVERS_OFF,
      ),
    ),
  );
}
