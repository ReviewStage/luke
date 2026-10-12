/**
 * connection-tools.ts -- the names a connection's calls are stored under, in every agent's transcript.
 *
 * eve offers a model a connection's tools through two tools of its own:
 * `connection_search` lists them and `connection_execute` runs one. A run of
 * a remote tool is also told as a call of its own, nested under the
 * `connection_execute` that made it and named `<connection>__<tool>`
 * (`linear__list_issues`), with its own result, before the wrapper's
 * result. The store writer holds every call of a row to a registered tool,
 * and a remote server names its tools itself, so a nested Linear call is
 * stored under one fixed name, `linear_remote`, whose input is an envelope
 * of the remote tool's name, the input eve validated for it, and the call
 * it ran under. The three names are registered in every agent's tool set
 * whatever any account's connection stands at, so a transcript that used
 * Linear reads back the same after a Disconnect.
 */

import { WireValueSchema } from "@sidecar/wire";
import { verbatimJsonSchema } from "@sidecar/wire/effect";
import type { Tool } from "ai";
import { Schema } from "effect";
import { type UnparsedWireValue, wireValidatedTool } from "../core.js";

/** The connection eve registers Linear under, which `connections/linear.ts` is named for. */
export const LINEAR_CONNECTION_NAME = "linear";

/** The calls a connection's use leaves in a transcript. */
export const CONNECTION_TOOL = {
  SEARCH: "connection_search",
  EXECUTE: "connection_execute",
  /** A nested call of one of Linear's own tools, under its envelope. */
  LINEAR_REMOTE: "linear_remote",
} as const;

/** How eve qualifies a remote tool's name: the connection, two underscores, and the tool. */
const QUALIFIED_SEPARATOR = "__";

/** A remote tool's own name as the envelope keeps it: an identifier, and nothing shaped like a sentence. */
const REMOTE_TOOL_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** A call's input as the row keeps it: one JSON object, whose fields eve's or the remote server's own schema already read. */
const OBJECT_INPUT = verbatimJsonSchema(WireValueSchema, {
  type: "object",
  additionalProperties: true,
});

/** A nested Linear call as the row keeps it. */
const LinearRemoteInputSchema = Schema.Struct({
  /** Linear's own name for the tool, without the connection's. */
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
    [
      CONNECTION_TOOL.LINEAR_REMOTE,
      wireValidatedTool(
        "One of Linear's own tools, run by connection_execute",
        LinearRemoteInputSchema,
      ),
    ],
  ];
}

/** Whether a name is eve's qualified name for a remote tool, of whatever connection. */
export function isRemoteToolName(name: string): boolean {
  return name.includes(QUALIFIED_SEPARATOR);
}

/**
 * A nested call as the record keeps it: a Linear tool's call under
 * `linear_remote` and its envelope, or nothing for a name that is no Linear
 * tool's. Only Linear is connected, so any other connection's call has no
 * name to be stored under and is left out rather than refused.
 */
export function storedRemoteCall(
  toolName: string,
  input: UnparsedWireValue,
  parentCallId: string,
): { readonly name: string; readonly input: UnparsedWireValue } | undefined {
  const prefix = `${LINEAR_CONNECTION_NAME}${QUALIFIED_SEPARATOR}`;
  if (!toolName.startsWith(prefix)) return undefined;
  const remoteTool = toolName.slice(prefix.length);
  if (!REMOTE_TOOL_PATTERN.test(remoteTool)) return undefined;
  return {
    name: CONNECTION_TOOL.LINEAR_REMOTE,
    // eve validated an object, so an empty one stands for an input it never had.
    input: { remoteTool, parentCallId, input: input ?? {} },
  };
}
