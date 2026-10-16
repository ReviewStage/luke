/**
 * connection-tools.ts -- the names a connection's calls are stored under, in every agent's transcript.
 *
 * eve offers a model a connection's tools through two tools of its own:
 * `connection_search` lists them and `connection_execute` runs one. A run of
 * a remote tool is also told as a call of its own, nested under the
 * `connection_execute` that made it and named `<connection>__<tool>`
 * (`linear__list_issues`, `notion-2__notion-fetch` for a second Notion
 * account), with its own result, before the wrapper's
 * result. The store writer holds every call of a row to a registered tool,
 * and a remote server names its tools itself, so a nested call of one
 * integration's tool is stored under that integration's one fixed name
 * (the wire's `INTEGRATION_REMOTE_TOOL`, `linear_remote` for Linear), whose
 * input is an envelope of the remote tool's name, the input eve validated
 * for it, the call it ran under, and, for an account past the provider's
 * first, which account it was (`integrationRemoteCallSchema`), which the
 * desktop reads back to draw the row. Every name is registered in every
 * agent's tool set whatever any account's connections stand at, so a
 * transcript that used an integration reads back the same after a
 * Disconnect.
 */

import { CONNECTION_TOOL } from "@luke/features/agent-tools";
import {
  INTEGRATION_NAME,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_REMOTE_TOOL,
  type IntegrationProvider,
  integrationConnectionOf,
  integrationRemoteCallSchema,
} from "@luke/features/integration-wire";
import { WireValueSchema } from "@luke/wire";
import { verbatimJsonSchema } from "@luke/wire/effect";
import type { Tool } from "ai";
import { Schema } from "effect";
import { type UnparsedWireValue, wireValidatedTool } from "../core.js";

/** How eve qualifies a remote tool's name: the connection, two underscores, and the tool. */
const QUALIFIED_SEPARATOR = "__";

/** Whether a name is one the envelope keeps a remote tool's own name as. */
const isRemoteToolWord = Schema.is(integrationRemoteCallSchema.fields.remoteTool);

/** A call's input as the row keeps it: one JSON object, whose fields eve's or the remote server's own schema already read. */
const OBJECT_INPUT = verbatimJsonSchema(WireValueSchema, {
  type: "object",
  additionalProperties: true,
});

/** The connection calls as stored rows are held to them, for every agent's tool set. */
export function connectionToolEntries(): ReadonlyArray<readonly [string, Tool]> {
  return [
    [CONNECTION_TOOL.SEARCH, wireValidatedTool("eve's own connection_search tool", OBJECT_INPUT)],
    [CONNECTION_TOOL.EXECUTE, wireValidatedTool("eve's own connection_execute tool", OBJECT_INPUT)],
    ...INTEGRATION_PROVIDER_LIST.map(
      (provider) =>
        [
          INTEGRATION_REMOTE_TOOL[provider],
          wireValidatedTool(
            `One of ${INTEGRATION_NAME[provider]}'s own tools, run by connection_execute`,
            integrationRemoteCallSchema,
          ),
        ] as const,
    ),
  ];
}

/** Whether a name is eve's qualified name for a remote tool, of whatever connection. */
export function isRemoteToolName(name: string): boolean {
  return name.includes(QUALIFIED_SEPARATOR);
}

/** The integration and account whose connection eve qualified a remote tool's name with, and the tool's own name. */
function remoteToolOf(toolName: string):
  | {
      readonly provider: IntegrationProvider;
      readonly connection: string;
      readonly place: number;
      readonly remoteTool: string;
    }
  | undefined {
  const separator = toolName.indexOf(QUALIFIED_SEPARATOR);
  if (separator < 0) return undefined;
  const connection = toolName.slice(0, separator);
  // Note that a connection is named for its account, the first after its provider (`agent-runtime/connections.ts`).
  const account = integrationConnectionOf(connection);
  const remoteTool = toolName.slice(separator + QUALIFIED_SEPARATOR.length);
  if (account === undefined || !isRemoteToolWord(remoteTool)) return undefined;
  return { ...account, connection, remoteTool };
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
    name: INTEGRATION_REMOTE_TOOL[remote.provider],
    // eve validated an object, so an empty one stands for an input it never had.
    input: {
      remoteTool: remote.remoteTool,
      parentCallId,
      input: input ?? {},
      ...(remote.place > 1 ? { connection: remote.connection } : undefined),
    },
  };
}
