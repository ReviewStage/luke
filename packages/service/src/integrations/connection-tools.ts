/**
 * connection-tools.ts -- the names a connection's calls are stored under, in every agent's transcript.
 *
 * eve offers a model a connection's tools through two tools of its own:
 * `connection_search` lists them and `connection_execute` runs one. A run of
 * a remote tool is also told as a call of its own, nested under the
 * `connection_execute` that made it and named `<connection>__<tool>`
 * (`linear__list_issues`), with its own result, before the wrapper's
 * result. The store writer holds every call of a row to a registered tool,
 * and a remote server names its tools itself, so a nested call of one
 * integration's tool is stored under that integration's one fixed name
 * (`integrations.ts`'s `REMOTE_TOOL`, `linear_remote` for Linear), whose
 * input is an envelope of the remote tool's name, the input eve validated
 * for it, and the call it ran under. Every name is registered in every
 * agent's tool set whatever any account's connections stand at, so a
 * transcript that used an integration reads back the same after a
 * Disconnect.
 */

import {
  INTEGRATION_NAME,
  INTEGRATION_PROVIDER_LIST,
  type IntegrationProvider,
} from "@luke/features/integration-wire";
import { WireValueSchema } from "@luke/wire";
import { verbatimJsonSchema } from "@luke/wire/effect";
import type { Tool } from "ai";
import { Schema } from "effect";
import { type UnparsedWireValue, wireValidatedTool } from "../core.js";
import { INTEGRATION } from "./integrations.js";

/** eve's own two calls a connection's use leaves in a transcript, beside each integration's nested ones. */
export const CONNECTION_TOOL = {
  SEARCH: "connection_search",
  EXECUTE: "connection_execute",
} as const;

/** How eve qualifies a remote tool's name: the connection, two underscores, and the tool. */
const QUALIFIED_SEPARATOR = "__";

/**
 * A remote tool's own name as the envelope keeps it: the characters MCP
 * allows a tool's name, dots among them (Y Combinator's `hiring.list_jobs`),
 * and nothing shaped like a sentence.
 */
const REMOTE_TOOL_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;

/** A call's input as the row keeps it: one JSON object, whose fields eve's or the remote server's own schema already read. */
const OBJECT_INPUT = verbatimJsonSchema(WireValueSchema, {
  type: "object",
  additionalProperties: true,
});

/** A nested call of an integration's tool as the row keeps it. */
const RemoteInputSchema = Schema.Struct({
  /** The provider's own name for the tool, without the connection's. */
  remoteTool: Schema.String.check(Schema.isPattern(REMOTE_TOOL_PATTERN)),
  /** The `connection_execute` call it ran under. */
  parentCallId: Schema.String,
  /** The input eve validated against the tool's schema and sent; empty where it sent none. */
  input: OBJECT_INPUT,
});

/** The connection calls as stored rows are held to them, for every agent's tool set. */
export function connectionToolEntries(): ReadonlyArray<readonly [string, Tool]> {
  return [
    [CONNECTION_TOOL.SEARCH, wireValidatedTool("eve's own connection_search tool", OBJECT_INPUT)],
    [CONNECTION_TOOL.EXECUTE, wireValidatedTool("eve's own connection_execute tool", OBJECT_INPUT)],
    ...INTEGRATION_PROVIDER_LIST.map(
      (provider) =>
        [
          INTEGRATION[provider].REMOTE_TOOL,
          wireValidatedTool(
            `One of ${INTEGRATION_NAME[provider]}'s own tools, run by connection_execute`,
            RemoteInputSchema,
          ),
        ] as const,
    ),
  ];
}

/** Whether a name is eve's qualified name for a remote tool, of whatever connection. */
export function isRemoteToolName(name: string): boolean {
  return name.includes(QUALIFIED_SEPARATOR);
}

/** The integration whose connection eve qualified a remote tool's name with, and the tool's own name. */
function remoteToolOf(
  toolName: string,
): { readonly provider: IntegrationProvider; readonly remoteTool: string } | undefined {
  const separator = toolName.indexOf(QUALIFIED_SEPARATOR);
  if (separator < 0) return undefined;
  const connection = toolName.slice(0, separator);
  // Note that a provider's value is its connection's name, which eve names it by (`agent-runtime/connections.ts`).
  const provider = INTEGRATION_PROVIDER_LIST.find((each) => each === connection);
  const remoteTool = toolName.slice(separator + QUALIFIED_SEPARATOR.length);
  if (provider === undefined || !REMOTE_TOOL_PATTERN.test(remoteTool)) return undefined;
  return { provider, remoteTool };
}

/**
 * A nested call as the record keeps it: an integration's tool's call under
 * that integration's fixed name and its envelope, or nothing for a name that
 * is no integration's tool. Only integrations are connected, so any other
 * connection's call has no name to be stored under and is left out rather
 * than refused.
 */
export function storedRemoteCall(
  toolName: string,
  input: UnparsedWireValue,
  parentCallId: string,
): { readonly name: string; readonly input: UnparsedWireValue } | undefined {
  const remote = remoteToolOf(toolName);
  if (remote === undefined) return undefined;
  return {
    name: INTEGRATION[remote.provider].REMOTE_TOOL,
    // eve validated an object, so an empty one stands for an input it never had.
    input: { remoteTool: remote.remoteTool, parentCallId, input: input ?? {} },
  };
}
