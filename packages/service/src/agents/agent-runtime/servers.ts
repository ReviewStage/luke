import type { DatabaseServices, QueryError } from "@repo/database/core/query";
import { INTEGRATION_ROW_STATUS } from "@repo/database/integration-vocabulary";
import {
  readAgentOfConversation,
  takeAgentMentionedServers,
} from "@repo/database/models/agent-store";
import {
  INTEGRATION_GRANT,
  INTEGRATION_GRANT_OF,
  INTEGRATION_LABEL_MAX,
  INTEGRATION_NAME,
  INTEGRATION_PROVIDER_LIST,
  type IntegrationProvider,
  integrationAccountNames,
  integrationConnectionOf,
} from "@repo/features/integration-wire";
import { andList } from "@repo/features/words";
import { causeKind } from "@repo/runtime/effect";
import { Effect, Option, Result, type Schema } from "effect";
import type { GitHubApp } from "../../github/github-app.js";
import { githubOffered } from "../../integrations/github-integration.js";
import {
  accountIntegrationConnect,
  type IntegrationConnect,
} from "../../integrations/integration-connect.js";
import {
  type IntegrationConnectionRow,
  readIntegrationConnections,
} from "../../integrations/integration-store.js";
import type { ConversationAdmission } from "../eve-host/conversation.js";
import { CONNECTION_POLICY, type ConnectionPolicy } from "./role.js";

interface HandedConnection {
  readonly provider: IntegrationProvider;
  readonly connectionName: string;
  readonly instanceKey: string;
  readonly accountNote?: string;
}

export type ServerStanding =
  | {
      readonly on: true;
      readonly account: string;
      readonly connections: readonly HandedConnection[];
    }
  | { readonly on: false };

const SERVERS_OFF: ServerStanding = { on: false };

type ServerAdmission = Effect.Effect<
  ConversationAdmission,
  QueryError | Schema.SchemaError,
  DatabaseServices
>;

function takenMentions(
  policy: ConnectionPolicy,
  userId: string,
  conversationId: string,
): Effect.Effect<readonly string[], never, DatabaseServices> {
  if (policy !== CONNECTION_POLICY.AGENT_SWITCHES_AND_MENTIONS) return Effect.succeed([]);
  return takeAgentMentionedServers(userId, conversationId).pipe(
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

function handedRow(row: IntegrationConnectionRow): boolean {
  return (
    row.status === INTEGRATION_ROW_STATUS.CONNECTED || row.status === INTEGRATION_ROW_STATUS.EXPIRED
  );
}

function accountNote(
  row: IntegrationConnectionRow,
  others: readonly IntegrationConnectionRow[],
): string {
  const name = INTEGRATION_NAME[row.provider];
  const names = integrationAccountNames(
    [row, ...others].map((each) => ({
      connection: each.connectionName,
      label: each.label?.slice(0, INTEGRATION_LABEL_MAX),
    })),
  );
  const label = (each: IntegrationConnectionRow) =>
    JSON.stringify(names.get(each.connectionName) ?? "");
  return `This connection is the developer's ${label(row)} ${name} account. They also connected ${andList(others.map(label))}. If the developer hasn't said which account, ask before writing. Say which account you read from or wrote to.`;
}

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

export function turnServers(
  admission: ServerAdmission,
  policy: ConnectionPolicy,
  turnMentions: readonly string[] = [],
): Effect.Effect<ServerStanding, never, DatabaseServices | IntegrationConnect | GitHubApp> {
  return Effect.gen(function* () {
    const admitted = yield* admission;
    if (Result.isFailure(admitted)) return SERVERS_OFF;
    const { caller } = admitted.success;
    const { userId, conversationId } = admitted.success.target;
    const connect = yield* accountIntegrationConnect(caller);
    const github = yield* githubOffered;
    const offered = INTEGRATION_PROVIDER_LIST.filter((provider) =>
      INTEGRATION_GRANT_OF[provider] === INTEGRATION_GRANT.GITHUB_SIGN_IN
        ? github
        : connect[provider].configured,
    );
    const rows = yield* readIntegrationConnections(caller);
    const handed = offered.flatMap((provider) => providerConnections(provider, rows, caller));
    if (policy === CONNECTION_POLICY.ALWAYS_ON) {
      return { on: true, account: userId, connections: handed } as const;
    }
    const agent = yield* readAgentOfConversation(userId, conversationId);
    if (Option.isNone(agent)) return SERVERS_OFF;
    const { disabledServers } = agent.value;
    const mentioned = [...turnMentions, ...(yield* takenMentions(policy, userId, conversationId))];
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
