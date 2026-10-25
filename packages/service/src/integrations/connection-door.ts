/**
 * connection-door.ts -- a native agent's integrations, each its own MCP server: which it is handed, and the tools each lists and calls, on the member's own grants, with no eve.
 *
 * eve's agents reach an integration through eve's two built-in tools over
 * the connection each turn is handed (`../agents/agent-runtime/connections.ts`).
 * A native harness's agent is handed each connection as an MCP server of
 * its own at Luke (`../agents/luke-mcp/app.ts`), the way Claude Code and
 * Codex take any remote server: its launch names one server per connection
 * (`nativeAgentConnections`), and each server lists the provider's own tools
 * and forwards a call of one, which is this door.
 *
 * The connections are the ones a coding agent's turn is handed
 * (`turnServers`): every integration this deployment offers the caller but
 * those switched off for the agent, and those the native turn under way
 * took as mentions. Every request reads them afresh, so a switch turned off
 * after the launch lists no tools and refuses a call from the next request.
 * Each request reads the connection's grant afresh for the member acting in
 * the conversation from the store (`integrationGrant`), so a Disconnect
 * takes effect at the next request.
 *
 * A token is asked of Vercel Connect only when it is used, as Connect's docs
 * say: the harness lists every server's tools at each launch, for tools the
 * agent may never call, so a server's list is answered from the one kept on
 * its grant (`integration-tool-store.ts`), and only a grant that keeps none,
 * or one listed more than `TOOLS_KEPT` ago, is listed live on its token and
 * kept. A call reads the token and opens one MCP session to the provider's
 * own server (`mcp-tools.ts`), which lists the tools before calling one, so
 * every call keeps its grant's list current at no further ask. A token the
 * provider refuses is dropped from Connect's in-process cache and read once
 * more (`evictGrantToken`), never forced fresh on every read. A grant
 * revoked at the provider that Luke has not yet seen lists its kept tools,
 * and its first call answers why.
 *
 * Luke's account settings are where an integration is connected, so
 * nothing here starts a sign-in: a connection the member has not
 * connected, or whose grant expired, lists no tools, and a call of it is
 * refused with `requiresSignIn` and the sentence that says how to connect it.
 *
 * Every upstream read is bounded: the token's read, and the provider's
 * session (`mcp-tools.ts`'s own bounds), so a slow provider costs its own
 * server its tools and never holds the agent's start; a list that fails
 * lists no tools and logs one line naming the connection and the failure's
 * kind.
 *
 * The bearer goes to the provider's server and nowhere else: no answer, no
 * refusal, and no log line here carries it, and a server's own error
 * message is kept only where nothing in it is shaped like a credential
 * (`mcp-tools.ts`). What a provider's tool answers reaches the agent
 * whole, as `AGENTS.md`'s carve-out for integrations allows.
 *
 * The door does not check a call's input against the tool's schema before
 * calling it: the provider's server checks it, and its refusal is the
 * call's error.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import { readNativeProjection } from "@luke/database/models/native-projection-store";
import type { IntegrationProvider } from "@luke/features/integration-wire";
import { causeKind } from "@luke/runtime/effect";
import { isRecord, type WireRecord } from "@luke/wire";
import { DateTime, Duration, Effect, Option, Result } from "effect";
import type { HttpClient } from "effect/http";
import { CONNECTION_POLICY } from "../agents/agent-runtime/role.js";
import { turnServers } from "../agents/agent-runtime/servers.js";
import type { AdmittedConversation } from "../agents/brain-host/conversation.js";
import { heldProjection, turnServersOf } from "../agents/native-events/native-projection.js";
import { ACTION_RESULT_STATUS } from "../core.js";
import type { GitHubApp } from "../github/github-app.js";
import type { IntegrationConnect, WorkspaceLinearConnect } from "./integration-connect.js";
import {
  evictGrantToken,
  grantAccessToken,
  type IntegrationAdmission,
  type IntegrationGrantRef,
  integrationGrant,
  integrationUnavailable,
} from "./integration-token.js";
import { readStoredTools, storeTools } from "./integration-tool-store.js";
import { INTEGRATION } from "./integrations.js";
import {
  callMcpTool,
  listMcpToolSchemas,
  MCP_TOOLS_FAILURE,
  type McpToolSchema,
  type McpToolsFailure,
} from "./mcp-tools.js";

/** What the door runs against, every one of which a web function's runtime provides. */
export type ConnectionDoorServices =
  | DatabaseServices
  | IntegrationConnect
  | WorkspaceLinearConnect
  | GitHubApp
  | HttpClient.HttpClient;

/**
 * How long reading a connection's token may take, past which the
 * connection is taken as unreachable: the token is read from Vercel Connect,
 * an upstream of its own.
 */
const GRANT_TIMEOUT = Duration.seconds(10);

/**
 * How long a grant's kept list answers its server's listing before it is
 * listed live again: long enough that a launch almost never asks Connect for
 * a token, short enough that a tool a provider adds reaches an agent that
 * never calls that integration within the week.
 */
const TOOLS_KEPT = Duration.days(7);

/**
 * How long listing one connection's tools may take whole, its grant's read
 * included: under the time Codex gives a server to start
 * (`agent-runner/src/codex.ts`), so a slow provider's server answers no
 * tools rather than being failed by the harness.
 */
const LIST_TIMEOUT = Duration.seconds(10);

/** A refusal: the words the call is failed with, and, for a connection the member must connect, which and that it must. */
export interface ConnectionRefusal {
  readonly status: typeof ACTION_RESULT_STATUS.REJECTED;
  readonly error: string;
  readonly connection?: string;
  readonly requiresSignIn?: true;
}

/** One connection handed to the agent: which account at which provider, and, where the member holds more than one there, the note naming which account it is. */
interface HandedConnection {
  readonly provider: IntegrationProvider;
  readonly connectionName: string;
  readonly instanceKey: string;
  readonly accountNote?: string;
}

/** What a call of a connection's tool answered: the provider's own MCP result, as it sent it, or why there is none. */
type ConnectionCall = Result.Result<WireRecord, ConnectionRefusal>;

function refused(error: string, extra: Partial<ConnectionRefusal> = {}): ConnectionRefusal {
  return { status: ACTION_RESULT_STATUS.REJECTED, error, ...extra };
}

/** The admission the reads run under: the conversation the runner's bearer admitted. */
function admissionOf(admitted: AdmittedConversation): IntegrationAdmission {
  return Effect.succeed(Result.succeed(admitted));
}

/**
 * The servers the native turn under way took as it started, mentioned to
 * the agent since its last turn (`native-events/runner-events-app.ts`),
 * which its calls are handed whatever the switches say, as an eve turn's
 * are; none where none was taken, or where the projection cannot be read,
 * so a passing store failure costs the call a mention, never a switch.
 */
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

/** The connections a coding agent's turn is handed. */
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

/** The one connection named, where the agent is handed it. */
function handedConnection(
  admitted: AdmittedConversation,
  name: string,
): Effect.Effect<Option.Option<HandedConnection>, never, ConnectionDoorServices> {
  return Effect.map(handedConnections(admitted), (handed) =>
    Option.fromUndefinedOr(handed.find((each) => each.connectionName === name)),
  );
}

/** Whether a token read's sentence is one the member answers by connecting the integration again in settings. */
function asksSignIn(provider: IntegrationProvider, sentence: string): boolean {
  const sentences = integrationUnavailable(provider);
  return [sentences.NOT_CONNECTED, sentences.EXPIRED, sentences.WORKSPACE_EXPIRED].includes(
    sentence,
  );
}

/** A refusal of the connection for a grant or token read's sentence, saying the member must connect it where the sentence asks that. */
function refusedFor(connection: HandedConnection, sentence: string): ConnectionRefusal {
  return refused(sentence, {
    connection: connection.connectionName,
    ...(asksSignIn(connection.provider, sentence) ? { requiresSignIn: true as const } : {}),
  });
}

/** The grant the connection's token is read on for the member acting in the conversation, or why there is none, read from the store alone. */
function connectionGrant(
  admitted: AdmittedConversation,
  connection: HandedConnection,
): Effect.Effect<
  Result.Result<IntegrationGrantRef, ConnectionRefusal>,
  never,
  ConnectionDoorServices
> {
  const { provider, connectionName, instanceKey } = connection;
  return Effect.map(
    integrationGrant(
      { provider, connectionName, connectSubject: instanceKey },
      admissionOf(admitted),
    ),
    Result.mapError((sentence) => refusedFor(connection, sentence)),
  );
}

/** The bearer on the grant, or why there is none, read within its bound. */
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

/**
 * One session's work with the provider on the grant's token: where the
 * provider refuses the token, it is dropped from Connect's cache and the
 * work runs once more on the token read next, as Connect's docs say, and a
 * second refusal is the answer. Answers why no token could be read, or the
 * work's own answer.
 */
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
    const token = yield* grantToken(connection, grant);
    if (Result.isFailure(token)) return Result.fail(token.failure);
    return Result.succeed(yield* Effect.result(work(token.success)));
  });
  return Effect.flatMap(attempt, (first) => {
    const refusedByProvider =
      Result.isSuccess(first) &&
      Result.isFailure(first.success) &&
      first.success.failure.reason === MCP_TOOLS_FAILURE.REFUSED;
    return refusedByProvider
      ? Effect.andThen(evictGrantToken(grant), attempt)
      : Effect.succeed(first);
  });
}

/** Keeps the tools a read begun at `from` listed on the grant; a store that cannot be written costs the next listing a live read, never this request. */
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

/** Why a session with a provider's server failed, in words that name nothing of its bearer. */
function sessionFailed(connectionName: string, doing: string, failure: McpToolsFailure): string {
  if (failure.reason === MCP_TOOLS_FAILURE.REFUSED) {
    return `Authorization failed for "${connectionName}": the service refused the connection's credential.`;
  }
  const said = failure.serverMessage === undefined ? "" : `: ${failure.serverMessage}`;
  return `Failed to ${doing} "${connectionName}": the service was ${failure.reason}${said}.`;
}

/**
 * What the model is told of one connection the agent is handed, as eve
 * tells it: the integration's description and, where the member holds more
 * than one account there, the note naming which account this one is, so the
 * agent can pick the account the developer named; nothing for a connection
 * it is not handed. Its server answers it as its `initialize`'s
 * `instructions`, which the harness shows the model beside the server's
 * tools.
 */
export function connectionInstructions(
  admitted: AdmittedConversation,
  name: string,
): Effect.Effect<Option.Option<string>, never, ConnectionDoorServices> {
  return Effect.map(
    handedConnection(admitted, name),
    Option.map(({ provider, accountNote }) =>
      accountNote === undefined
        ? INTEGRATION[provider].DESCRIPTION
        : `${INTEGRATION[provider].DESCRIPTION} ${accountNote}`,
    ),
  );
}

/**
 * The names of the connections a native agent is handed as its launch
 * starts, one MCP server each; none where they cannot be read, so a passing
 * failure costs the launch its integrations, never the launch.
 */
export function nativeAgentConnections(
  admitted: AdmittedConversation,
): Effect.Effect<readonly string[], never, ConnectionDoorServices> {
  return Effect.map(handedConnections(admitted), (handed) =>
    handed.map((each) => each.connectionName),
  );
}

/**
 * The tools one connection's provider lists for the member, as it listed
 * them, within `LIST_TIMEOUT`: the list kept on the connection's grant
 * while it is younger than `TOOLS_KEPT`, so listing asks Connect for no
 * token, and otherwise the provider's own list on the grant's token, kept
 * for the next listing. A connection the agent is not handed lists none,
 * and so does one whose grant or list failed, with one log line naming the
 * connection and why in words that carry no credential.
 */
export function listConnectionTools(
  admitted: AdmittedConversation,
  name: string,
): Effect.Effect<readonly McpToolSchema[], never, ConnectionDoorServices> {
  const listed = Effect.gen(function* () {
    const connection = yield* handedConnection(admitted, name);
    if (Option.isNone(connection)) return [];
    const grant = yield* connectionGrant(admitted, connection.value);
    if (Result.isFailure(grant)) {
      yield* Effect.logWarning(`integration server ${name} lists no tools: ${grant.failure.error}`);
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
      yield* Effect.logWarning(`integration server ${name} lists no tools: ${read.failure.error}`);
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

/**
 * One call of a connection's tool with its input, on the member's own
 * grant: the provider's MCP result as it sent it, its own error among them.
 * A connection the agent is not handed, one the member has not connected,
 * a tool the server lists none of, and a session that failed are each
 * refused. The tools the session listed are kept on the grant, so the next
 * launch's listing shows what the provider lists now.
 */
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
          refused("Luke could not reach this integration just now; try again in a moment."),
        ),
      ),
    ),
  );
}
