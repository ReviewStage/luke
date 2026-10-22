/**
 * connection-door.ts -- a native agent's `connection_search` and `connection_execute`: the integrations its turn would be handed, searched and called on the member's own grants, with no eve.
 *
 * eve's agents reach an integration through eve's two built-in tools over
 * the connection each turn is handed (`../agents/agent-runtime/connections.ts`).
 * A native harness's agent reaches the same integrations through Luke's MCP
 * server (`../agents/luke-mcp/tools.ts`), which calls this door: the same
 * two tools, under eve's names, words, and input schemas, answering what
 * eve's answer.
 *
 * The connections are the ones a coding agent's turn is handed
 * (`turnServers`): every integration this deployment offers the caller but
 * those switched off for the agent. A mention in a message hands a server
 * to the next turn alone, and the MCP server has no turn, so the mentions
 * are left for the turn that starts to take. Each call reads the
 * connection's grant afresh for the member acting in the conversation
 * (`integrationAccessToken`), so a Disconnect takes effect at the next call,
 * and opens one MCP session to the provider's own server
 * (`mcp-tools.ts`). Luke's account settings are where an integration is
 * connected, so nothing here starts a sign-in: a connection the member has
 * not connected, or whose grant expired, is listed by a search as
 * unavailable with `requiresSignIn` and the sentence that says how to
 * connect it, and a call of it is refused with the same.
 *
 * The bearer goes to the provider's server and nowhere else: no answer, no
 * refusal, and no log line here carries it, and a server's own error
 * message is kept only where nothing in it is shaped like a credential
 * (`mcp-tools.ts`). What a provider's tool answers reaches the agent
 * whole, as `AGENTS.md`'s carve-out for integrations allows.
 *
 * Unlike eve's, the door does not check a call's input against the tool's
 * schema before calling it: the provider's server checks it, and its
 * refusal is the call's error.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import { readNativeProjection } from "@luke/database/models/native-projection-store";
import { CONNECTION_TOOL } from "@luke/features/agent-tools";
import type { IntegrationProvider } from "@luke/features/integration-wire";
import { causeKind } from "@luke/runtime/effect";
import {
  isRecord,
  type UnparsedWireValue,
  type WireRecord,
  type WireValue,
  WireValueSchema,
} from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Option, Result, Schema } from "effect";
import type { HttpClient } from "effect/http";
import { CONNECTION_POLICY } from "../agents/agent-runtime/role.js";
import { turnServers } from "../agents/agent-runtime/servers.js";
import type { AdmittedConversation } from "../agents/brain-host/conversation.js";
import { heldProjection, turnServersOf } from "../agents/native-events/native-projection.js";
import { ACTION_RESULT_STATUS } from "../core.js";
import type { GitHubApp } from "../github/github-app.js";
import { closestToolNames, rankConnectionTools, toolSignature } from "./connection-search.js";
import type { IntegrationConnect, WorkspaceLinearConnect } from "./integration-connect.js";
import {
  type IntegrationAdmission,
  integrationAccessToken,
  integrationUnavailable,
} from "./integration-token.js";
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

/** How many connections a search lists at once. */
const SEARCH_CONCURRENCY = 4;

/** A search's page: how many tools it answers by default and at most, and how many names a refused call suggests. */
const SEARCH_LIMIT = { DEFAULT: 10, MAX: 50 } as const;
const CLOSEST_TOOLS = 5;

const SearchInputSchema = Schema.Struct({
  query: Schema.optionalKey(Schema.String),
  connection: Schema.optionalKey(Schema.String),
  signIn: Schema.optionalKey(Schema.Boolean),
  limit: Schema.optionalKey(Schema.Number),
  offset: Schema.optionalKey(Schema.Number),
});

/** `connection_search` as eve declares it, its name, words, and input schema, but for `signIn`'s words: no sign-in starts here. */
export const CONNECTION_SEARCH_TOOL = {
  name: CONNECTION_TOOL.SEARCH,
  description: [
    "Find tools in your connected services (MCP servers and OpenAPI APIs).",
    "Returns each matching tool's connection, name, description, and TypeScript signature.",
    "Omit `query` to list a connection's tools. Call a found tool with connection_execute.",
    "Connections the user has not signed in to are listed under `unavailable` with `requiresSignIn`;",
    "Luke cannot start a sign-in: when the request needs one, ask the user to connect it in Luke's Settings, then search it again.",
    "Prefer connected services over web search or general knowledge when a request relates to them.",
  ].join(" "),
  /** eve's own JSON Schema, `signIn`'s words aside: a model is shown these bytes. */
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Words describing the capability, such as 'list open issues'. Omit to list every tool.",
      },
      connection: { type: "string", description: "Only search this connection." },
      signIn: {
        type: "boolean",
        description:
          "Starts no sign-in: a connection the user has not connected is refused, and you ask the user to connect it in Luke's Settings. Requires `connection`.",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 50,
        description: "Maximum results. Defaults to 10.",
      },
      offset: { type: "integer", minimum: 0, description: "Results to skip, for paging." },
    },
    additionalProperties: false,
  },
} as const;

/** `connection_execute` as eve declares it: its name, its words, and its input schema. */
export const CONNECTION_EXECUTE_TOOL = {
  name: CONNECTION_TOOL.EXECUTE,
  description: [
    "Call one tool from a connected service and return its result.",
    "Use the exact `connection` and `tool` names returned by connection_search,",
    "and pass `input` matching the tool's signature.",
  ].join(" "),
  /** eve's own JSON Schema, as written: a model is shown these bytes. */
  inputSchema: {
    type: "object",
    properties: {
      connection: { type: "string", description: "Connection name from connection_search." },
      tool: { type: "string", description: "Tool name from connection_search." },
      input: {
        type: "object",
        description: "Arguments matching the tool's signature. Defaults to {}.",
      },
    },
    required: ["connection", "tool"],
    additionalProperties: false,
  },
} as const;

/** One connection a search could not list, and why: `requiresSignIn` where the member has yet to connect it, or connect it again. */
interface UnavailableConnection {
  readonly connection: string;
  readonly error: string;
  readonly requiresSignIn?: true;
}

/** One tool a search answers. */
interface FoundTool {
  readonly connection: string;
  readonly description?: string;
  readonly signature: string;
  readonly tool: string;
}

/** A refusal: the words eve's tool would have failed the call with, and, for a connection the member must connect, which and that it must. */
interface ConnectionRefusal {
  readonly status: typeof ACTION_RESULT_STATUS.REJECTED;
  readonly error: string;
  readonly connection?: string;
  readonly requiresSignIn?: true;
}

/** What a search answers: the page of tools found, how many there were, and the connections it could not list. */
export type ConnectionSearchResult =
  | {
      readonly tools: readonly FoundTool[];
      readonly total: number;
      readonly unavailable?: readonly UnavailableConnection[];
    }
  | ConnectionRefusal;

/** What a call answers: the tool's own result as eve reads it (a value, its text, or its content blocks where any is no text), or why not. */
export type ConnectionExecuteResult =
  | { readonly status: typeof ACTION_RESULT_STATUS.ACCEPTED; readonly output: WireValue }
  | ConnectionRefusal;

/** One connection handed to the agent: which account at which provider, and what the model is told of it. */
interface HandedConnection {
  readonly provider: IntegrationProvider;
  readonly connectionName: string;
  readonly instanceKey: string;
  readonly description: string;
}

/** What a token read amounted to for one connection: the bearer, or why there is none. */
type ConnectionToken = Result.Result<string, UnavailableConnection>;

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

/** The connections a coding agent's turn is handed, each with what the model is told of it. */
function handedConnections(
  admitted: AdmittedConversation,
): Effect.Effect<readonly HandedConnection[], never, ConnectionDoorServices> {
  return Effect.map(
    Effect.flatMap(turnMentionsOf(admitted), (mentioned) =>
      turnServers(admissionOf(admitted), CONNECTION_POLICY.AGENT_SWITCHES, mentioned),
    ),
    (standing) =>
      standing.on
        ? standing.connections.map((connection) => ({
            provider: connection.provider,
            connectionName: connection.connectionName,
            instanceKey: connection.instanceKey,
            description:
              connection.accountNote === undefined
                ? INTEGRATION[connection.provider].DESCRIPTION
                : `${INTEGRATION[connection.provider].DESCRIPTION} ${connection.accountNote}`,
          }))
        : [],
  );
}

/** The refusal of a connection the member must connect: why, and plainly that the agent asks them to, since nothing here starts a sign-in. */
function signInRefused(unavailable: UnavailableConnection): ConnectionRefusal {
  return refused(
    `${unavailable.error} Luke cannot start a sign-in from here: ask the user to connect "${unavailable.connection}" in Luke's Settings, then try again.`,
    { connection: unavailable.connection, requiresSignIn: true },
  );
}

/** The refusal of a connection the agent is not handed. */
function notAvailable(name: string, handed: readonly HandedConnection[]): ConnectionRefusal {
  return refused(
    handed.length === 0
      ? `Connection "${name}" is not available. No connections are available right now.`
      : `Connection "${name}" is not available. Available connections: ${handed
          .map((each) => each.connectionName)
          .join(", ")}.`,
  );
}

/** Whether a token read's sentence is one the member answers by connecting the integration again in settings. */
function asksSignIn(provider: IntegrationProvider, sentence: string): boolean {
  const sentences = integrationUnavailable(provider);
  return [sentences.NOT_CONNECTED, sentences.EXPIRED, sentences.WORKSPACE_EXPIRED].includes(
    sentence,
  );
}

/** The connection's bearer for the member acting in the conversation, or why there is none. */
function connectionToken(
  admitted: AdmittedConversation,
  connection: HandedConnection,
): Effect.Effect<ConnectionToken, never, ConnectionDoorServices> {
  const { provider, connectionName, instanceKey } = connection;
  return Effect.map(
    integrationAccessToken(
      { provider, connectionName, connectSubject: instanceKey },
      admissionOf(admitted),
    ),
    (answer) =>
      Result.isSuccess(answer)
        ? Result.succeed(answer.success.token)
        : Result.fail({
            connection: connectionName,
            error: answer.failure,
            ...(asksSignIn(provider, answer.failure) ? { requiresSignIn: true as const } : {}),
          }),
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

/** One connection's tools, or why it could not be listed; `terminal` where connecting it again would not help. */
function listConnection(
  admitted: AdmittedConversation,
  connection: HandedConnection,
): Effect.Effect<
  | { readonly tools: readonly McpToolSchema[] }
  | { readonly unavailable: UnavailableConnection; readonly terminal: boolean },
  never,
  ConnectionDoorServices
> {
  return Effect.gen(function* () {
    const token = yield* connectionToken(admitted, connection);
    if (Result.isFailure(token)) {
      return { unavailable: token.failure, terminal: token.failure.requiresSignIn !== true };
    }
    const listed = yield* Effect.result(
      listMcpToolSchemas(INTEGRATION[connection.provider].MCP_URL, token.success),
    );
    if (Result.isSuccess(listed)) return { tools: listed.success };
    return {
      unavailable: {
        connection: connection.connectionName,
        error: sessionFailed(connection.connectionName, "load tools for", listed.failure),
      },
      terminal: true,
    };
  });
}

function clampInteger(value: number | undefined, min: number, max: number, fallback: number) {
  return value === undefined || !Number.isFinite(value)
    ? fallback
    : Math.min(max, Math.max(min, Math.trunc(value)));
}

/**
 * One `connection_search`: the tools of every connection the agent is
 * handed, or of the one it names, ranked by the words asked for, a page of
 * them with their signatures, and the connections that could not be listed.
 * A search whose every connection failed for a reason connecting it again
 * would not mend is refused with their reasons. `signIn` starts nothing,
 * since an integration is connected in Luke's settings: a connection the
 * member has not connected is refused with the sentence saying how.
 */
export function runConnectionSearch(
  admitted: AdmittedConversation,
  input: UnparsedWireValue,
): Effect.Effect<ConnectionSearchResult, never, ConnectionDoorServices> {
  return Effect.gen(function* () {
    const read = readEither(SearchInputSchema)(isRecord(input) ? input : {});
    if (Result.isFailure(read)) {
      return refused(
        "connection_search takes `query`, `connection`, `signIn`, `limit`, and `offset`.",
      );
    }
    const asked = read.success;
    const named =
      asked.connection === undefined || asked.connection === "" ? undefined : asked.connection;
    if (asked.signIn === true && named === undefined) {
      return refused(
        "connection_search with signIn: true requires `connection`. Ask the user to sign in to one connection at a time.",
      );
    }
    const handed = yield* handedConnections(admitted);
    const searched =
      named === undefined ? handed : handed.filter((each) => each.connectionName === named);
    if (named !== undefined && searched.length === 0) return notAvailable(named, handed);
    const lists = yield* Effect.forEach(
      searched,
      (connection) =>
        Effect.map(listConnection(admitted, connection), (listed) => ({ connection, listed })),
      { concurrency: SEARCH_CONCURRENCY },
    );
    const unavailable: UnavailableConnection[] = [];
    const terminal: UnavailableConnection[] = [];
    const candidates = lists.flatMap(({ connection, listed }) => {
      if ("tools" in listed) return listed.tools.map((tool) => ({ connection, tool }));
      unavailable.push(listed.unavailable);
      if (listed.terminal) terminal.push(listed.unavailable);
      return [];
    });
    const signIn = unavailable.find((each) => each.requiresSignIn === true);
    if (asked.signIn === true && signIn !== undefined) {
      return signInRefused(signIn);
    }
    if (searched.length > 0 && terminal.length === searched.length) {
      return refused(terminal.map((each) => each.error).join("\n"));
    }
    const ranked = rankConnectionTools(asked.query ?? "", candidates);
    const limit = clampInteger(asked.limit, 1, SEARCH_LIMIT.MAX, SEARCH_LIMIT.DEFAULT);
    const offset = clampInteger(asked.offset, 0, Number.MAX_SAFE_INTEGER, 0);
    const tools = ranked.slice(offset, offset + limit).map(
      ({ connection, tool }): FoundTool => ({
        connection: connection.connectionName,
        ...(tool.description !== undefined ? { description: tool.description } : {}),
        signature: toolSignature(tool),
        tool: tool.name,
      }),
    );
    return {
      tools,
      total: ranked.length,
      ...(unavailable.length > 0 ? { unavailable } : {}),
    };
  }).pipe(Effect.catchCause(doorFailed("connection_search")));
}

/** The text blocks of a tool's MCP result, joined. */
function textOf(blocks: readonly WireRecord[]): string {
  return blocks
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

/** A text as JSON where it reads as an object or array, else as it is. */
function parsedJsonText(text: string): WireValue {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return text;
  const parsed = Schema.decodeUnknownOption(Schema.fromJsonString(WireValueSchema))(trimmed);
  return parsed._tag === "Some" ? parsed.value : text;
}

const MCP_CONTENT_TYPES: ReadonlySet<string> = new Set([
  "text",
  "image",
  "audio",
  "resource",
  "resource_link",
]);

/**
 * A tool's MCP result as eve reads it: its error's words where it says it
 * failed; its content blocks where any is no text; else its structured
 * content where it sent any, its text where its tool declares an output
 * schema, and its text read as JSON where that reads.
 */
function toolResult(tool: McpToolSchema, result: WireValue): Result.Result<WireValue, string> {
  if (!isRecord(result)) return Result.succeed(result);
  const blocks = (Array.isArray(result.content) ? result.content : []).filter(
    (block): block is WireRecord =>
      isRecord(block) && typeof block.type === "string" && MCP_CONTENT_TYPES.has(block.type),
  );
  const text = textOf(blocks);
  if (result.isError === true) {
    if (text.length > 0) return Result.fail(text);
    return Result.fail(
      result.structuredContent === undefined
        ? "The tool reported an error."
        : JSON.stringify(result.structuredContent),
    );
  }
  if (blocks.some((block) => block.type !== "text")) return Result.succeed(blocks);
  if (result.structuredContent !== undefined) return Result.succeed(result.structuredContent);
  return Result.succeed(tool.outputSchema === undefined ? parsedJsonText(text) : text);
}

const ExecuteTargetSchema = Schema.Struct({
  connection: Schema.String,
  tool: Schema.String,
  input: Schema.optionalKey(WireValueSchema),
});

/**
 * One `connection_execute`: the named tool of the named connection, called
 * with its input on the member's own grant, answering the tool's result as
 * eve reads it. A connection the agent is not handed, one the member has
 * not connected, a tool the server lists none of, and the tool's own error
 * are each refused with the words eve's tool fails the call with.
 */
export function runConnectionExecute(
  admitted: AdmittedConversation,
  input: UnparsedWireValue,
): Effect.Effect<ConnectionExecuteResult, never, ConnectionDoorServices> {
  return Effect.gen(function* () {
    const target = readEither(ExecuteTargetSchema)(isRecord(input) ? input : {});
    if (Result.isFailure(target)) {
      return refused("connection_execute requires string `connection` and `tool` values.");
    }
    const { connection: name, tool: toolName } = target.success;
    const toolInput = isRecord(target.success.input) ? target.success.input : {};
    const handed = yield* handedConnections(admitted);
    const connection = handed.find((each) => each.connectionName === name);
    if (connection === undefined) return notAvailable(name, handed);
    const token = yield* connectionToken(admitted, connection);
    if (Result.isFailure(token)) {
      return token.failure.requiresSignIn
        ? signInRefused(token.failure)
        : refused(token.failure.error, { connection: name });
    }
    const call = yield* Effect.result(
      callMcpTool(INTEGRATION[connection.provider].MCP_URL, token.success, toolName, toolInput),
    );
    if (Result.isFailure(call)) return refused(sessionFailed(name, "call a tool of", call.failure));
    if (!call.success.called) {
      const closest = closestToolNames(toolName, call.success.tools, CLOSEST_TOOLS);
      return refused(
        `Connection "${name}" has no tool named "${toolName}".${
          closest.length > 0
            ? ` Closest tools: ${closest.join(", ")}.`
            : " Use connection_search to find its tools."
        }`,
      );
    }
    const answered = toolResult(call.success.tool, call.success.result);
    if (Result.isFailure(answered)) return refused(answered.failure);
    return { status: ACTION_RESULT_STATUS.ACCEPTED, output: answered.success } as const;
  }).pipe(Effect.catchCause(doorFailed("connection_execute")));
}

/** A failure the door did not expect, logged by its kind alone and answered as a refusal that names nothing of it. */
function doorFailed(tool: string) {
  return (cause: Parameters<typeof causeKind>[0]) =>
    Effect.as(
      Effect.logWarning(`${tool} failed: ${causeKind(cause)}`),
      refused("Luke could not reach this agent's integrations just now; try again in a moment."),
    );
}
