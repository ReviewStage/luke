import type { DatabaseServices } from "@repo/database/core/query";
import { readNativeProjection } from "@repo/database/models/native-projection-store";
import type { IntegrationProvider } from "@repo/features/integration-wire";
import { causeKind } from "@repo/runtime/effect";
import { isRecord, type WireRecord } from "@repo/wire";
import { DateTime, Duration, Effect, Option, Result } from "effect";
import type { HttpClient } from "effect/http";
import { CONNECTION_POLICY } from "../agents/agent-runtime/role.js";
import { turnServers } from "../agents/agent-runtime/servers.js";
import type { AdmittedConversation } from "../agents/eve-host/conversation.js";
import { heldProjection, turnServersOf } from "../agents/native-events/native-projection.js";
import { ACTION_RESULT_STATUS } from "../core.js";
import type { GitHubApp } from "../github/github-app.js";
import type { IntegrationConnect } from "./integration-connect.js";
import {
  evictGrantToken,
  grantAccessToken,
  type IntegrationAdmission,
  type IntegrationGrantRef,
  integrationGrant,
  integrationUnavailable,
} from "./integration-token.js";
import { readStoredTools, storeTools } from "./integration-tool-store.js";
import { INTEGRATION, integrationInstructions } from "./integrations.js";
import {
  callMcpTool,
  listMcpToolSchemas,
  MCP_TOOLS_FAILURE,
  type McpToolSchema,
  type McpToolsFailure,
} from "./mcp-tools.js";

export type ConnectionDoorServices =
  | DatabaseServices
  | IntegrationConnect
  | GitHubApp
  | HttpClient.HttpClient;

const GRANT_TIMEOUT = Duration.seconds(10);

const TOOLS_KEPT = Duration.days(7);

const LIST_TIMEOUT = Duration.seconds(10);

export interface ConnectionRefusal {
  readonly status: typeof ACTION_RESULT_STATUS.REJECTED;
  readonly error: string;
  readonly connection?: string;
  readonly requiresSignIn?: true;
}

interface HandedConnection {
  readonly provider: IntegrationProvider;
  readonly connectionName: string;
  readonly instanceKey: string;
  readonly accountNote?: string;
}

type ConnectionCall = Result.Result<WireRecord, ConnectionRefusal>;

function refused(error: string, extra: Partial<ConnectionRefusal> = {}): ConnectionRefusal {
  return { status: ACTION_RESULT_STATUS.REJECTED, error, ...extra };
}

function admissionOf(admitted: AdmittedConversation): IntegrationAdmission {
  return Effect.succeed(Result.succeed(admitted));
}

function turnMentionsOf(
  admitted: AdmittedConversation,
): Effect.Effect<readonly string[], never, DatabaseServices> {
  return readNativeProjection(admitted.target).pipe(
    Effect.map(
      Option.match({
        onNone: (): readonly string[] => [],
        onSome: (saved) => turnServersOf(heldProjection(saved)),
      }),
    ),
    Effect.catchCause((cause) =>
      Effect.as(
        Effect.logWarning(`a native turn's mentioned servers were not read: ${causeKind(cause)}`),
        [],
      ),
    ),
  );
}

function handedConnections(
  admitted: AdmittedConversation,
): Effect.Effect<readonly HandedConnection[], never, ConnectionDoorServices> {
  return Effect.map(
    Effect.flatMap(turnMentionsOf(admitted), (mentioned) =>
      turnServers(admissionOf(admitted), CONNECTION_POLICY.AGENT_SWITCHES, mentioned),
    ),
    (standing) => (standing.on ? standing.connections : []),
  );
}

function handedConnection(
  admitted: AdmittedConversation,
  name: string,
): Effect.Effect<Option.Option<HandedConnection>, never, ConnectionDoorServices> {
  return Effect.map(handedConnections(admitted), (handed) =>
    Option.fromUndefinedOr(handed.find((each) => each.connectionName === name)),
  );
}

function asksSignIn(provider: IntegrationProvider, sentence: string): boolean {
  const sentences = integrationUnavailable(provider);
  return [sentences.NOT_CONNECTED, sentences.EXPIRED].includes(sentence);
}

function refusedFor(connection: HandedConnection, sentence: string): ConnectionRefusal {
  return refused(sentence, {
    connection: connection.connectionName,
    ...(asksSignIn(connection.provider, sentence) ? { requiresSignIn: true as const } : {}),
  });
}

function noToolsLogged(name: string, refusal: ConnectionRefusal): Effect.Effect<void> {
  const line = `integration server ${name} lists no tools: ${refusal.error}`;
  return refusal.requiresSignIn ? Effect.logDebug(line) : Effect.logWarning(line);
}

function accountOf({ provider, connectionName, instanceKey }: HandedConnection) {
  return { provider, connectionName, connectSubject: instanceKey };
}

function connectionGrant(
  admitted: AdmittedConversation,
  connection: HandedConnection,
): Effect.Effect<
  Result.Result<IntegrationGrantRef, ConnectionRefusal>,
  never,
  ConnectionDoorServices
> {
  return Effect.map(
    integrationGrant(accountOf(connection), admissionOf(admitted)),
    Result.mapError((sentence) => refusedFor(connection, sentence)),
  );
}

function grantToken(
  connection: HandedConnection,
  grant: IntegrationGrantRef,
): Effect.Effect<Result.Result<string, ConnectionRefusal>, never, ConnectionDoorServices> {
  const { connectionName } = connection;
  return grantAccessToken(grant).pipe(
    Effect.map((answer) =>
      Result.isSuccess(answer)
        ? Result.succeed(answer.success.token)
        : Result.fail(refusedFor(connection, answer.failure)),
    ),
    Effect.timeoutOrElse({
      duration: GRANT_TIMEOUT,
      orElse: () =>
        Effect.succeed(
          Result.fail(
            refused(`Failed to reach "${connectionName}": its credential could not be read.`, {
              connection: connectionName,
            }),
          ),
        ),
    }),
  );
}

function onGrantToken<A>(
  connection: HandedConnection,
  grant: IntegrationGrantRef,
  work: (token: string) => Effect.Effect<A, McpToolsFailure, ConnectionDoorServices>,
): Effect.Effect<
  Result.Result<Result.Result<A, McpToolsFailure>, ConnectionRefusal>,
  never,
  ConnectionDoorServices
> {
  const attempt = Effect.gen(function* () {
    const bearer = yield* grantToken(connection, grant);
    if (Result.isFailure(bearer)) return Result.fail(bearer.failure);
    return Result.succeed(yield* Effect.result(work(bearer.success)));
  });
  return Effect.flatMap(attempt, (first) => {
    if (Result.isFailure(first)) return Effect.succeed(first);
    const done = first.success;
    const refusedByProvider =
      Result.isFailure(done) && done.failure.reason === MCP_TOOLS_FAILURE.REFUSED;
    return refusedByProvider
      ? Effect.andThen(evictGrantToken(grant), attempt)
      : Effect.succeed(first);
  });
}

function keepTools(
  name: string,
  grant: IntegrationGrantRef,
  tools: readonly McpToolSchema[],
  from: Date,
): Effect.Effect<void, never, ConnectionDoorServices> {
  return storeTools(grant, tools, from).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning(`integration server ${name}'s tools were not kept: ${causeKind(cause)}`),
    ),
  );
}

function sessionFailed(connectionName: string, doing: string, failure: McpToolsFailure): string {
  if (failure.reason === MCP_TOOLS_FAILURE.REFUSED) {
    return `Authorization failed for "${connectionName}": the service refused the connection's credential.`;
  }
  const said = failure.serverMessage === undefined ? "" : `: ${failure.serverMessage}`;
  return `Failed to ${doing} "${connectionName}": the service was ${failure.reason}${said}.`;
}

export function connectionInstructions(
  admitted: AdmittedConversation,
  name: string,
): Effect.Effect<Option.Option<string>, never, ConnectionDoorServices> {
  return Effect.map(
    handedConnection(admitted, name),
    Option.map(({ provider, accountNote }) => integrationInstructions(provider, accountNote)),
  );
}

export function nativeAgentConnections(
  admitted: AdmittedConversation,
): Effect.Effect<readonly string[], never, ConnectionDoorServices> {
  return Effect.map(handedConnections(admitted), (handed) =>
    handed.map((each) => each.connectionName),
  );
}

export function listConnectionTools(
  admitted: AdmittedConversation,
  name: string,
): Effect.Effect<readonly McpToolSchema[], never, ConnectionDoorServices> {
  const listed = Effect.gen(function* () {
    const connection = yield* handedConnection(admitted, name);
    if (Option.isNone(connection)) return [];
    const grant = yield* connectionGrant(admitted, connection.value);
    if (Result.isFailure(grant)) {
      yield* noToolsLogged(name, grant.failure);
      return [];
    }
    const from = yield* DateTime.nowAsDate;
    const kept = yield* readStoredTools(grant.success);
    if (
      kept !== undefined &&
      from.getTime() - kept.listedAt.getTime() < Duration.toMillis(TOOLS_KEPT)
    ) {
      return kept.tools;
    }
    const url = INTEGRATION[connection.value.provider].MCP_URL;
    const read = yield* onGrantToken(connection.value, grant.success, (token) =>
      listMcpToolSchemas(url, token),
    );
    if (Result.isFailure(read)) {
      yield* noToolsLogged(name, read.failure);
      return [];
    }
    const tools = read.success;
    if (Result.isSuccess(tools)) {
      yield* keepTools(name, grant.success, tools.success, from);
      return tools.success;
    }
    yield* Effect.logWarning(
      `integration server ${name} lists no tools: ${sessionFailed(name, "load tools for", tools.failure)}`,
    );
    return [];
  });
  return listed.pipe(
    Effect.timeoutOrElse({
      duration: LIST_TIMEOUT,
      orElse: () =>
        Effect.as(Effect.logWarning(`integration server ${name} lists no tools: timed out`), []),
    }),
    Effect.catchCause((cause) =>
      Effect.as(
        Effect.logWarning(`integration server ${name} lists no tools: ${causeKind(cause)}`),
        [],
      ),
    ),
  );
}

export function callConnectionTool(
  admitted: AdmittedConversation,
  name: string,
  tool: string,
  input: WireRecord,
): Effect.Effect<ConnectionCall, never, ConnectionDoorServices> {
  return Effect.gen(function* () {
    const connection = yield* handedConnection(admitted, name);
    if (Option.isNone(connection)) {
      return Result.fail(refused(`Connection "${name}" is not available to this agent.`));
    }
    const grant = yield* connectionGrant(admitted, connection.value);
    if (Result.isFailure(grant)) return Result.fail(grant.failure);
    const from = yield* DateTime.nowAsDate;
    const url = INTEGRATION[connection.value.provider].MCP_URL;
    const read = yield* onGrantToken(connection.value, grant.success, (token) =>
      callMcpTool(url, token, tool, input),
    );
    if (Result.isFailure(read)) return Result.fail(read.failure);
    const call = read.success;
    const listed = Result.isSuccess(call) ? call.success.tools : call.failure.listed;
    if (listed !== undefined) yield* keepTools(name, grant.success, listed, from);
    if (Result.isFailure(call)) {
      return Result.fail(refused(sessionFailed(name, "call a tool of", call.failure)));
    }
    if (!call.success.called) {
      return Result.fail(refused(`Connection "${name}" has no tool named "${tool}".`));
    }
    const { result } = call.success;
    if (!isRecord(result)) {
      return Result.fail(
        refused(`Failed to call a tool of "${name}": the service was unreadable.`),
      );
    }
    return Result.succeed(result);
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.as(
        Effect.logWarning(`integration server ${name} call failed: ${causeKind(cause)}`),
        Result.fail(
          refused("This integration could not be reached just now; try again in a moment."),
        ),
      ),
    ),
  );
}
