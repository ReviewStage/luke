import { CONNECTION_TOOL } from "@repo/features/agent-tools";
import {
  INTEGRATION_NAME,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_REMOTE_TOOL,
  type IntegrationProvider,
  integrationConnectionOf,
  integrationRemoteCallSchema,
} from "@repo/features/integration-wire";
import { WireValueSchema } from "@repo/wire";
import { verbatimJsonSchema } from "@repo/wire/effect";
import type { Tool } from "ai";
import { Schema } from "effect";
import { type UnparsedWireValue, wireValidatedTool } from "../core.js";

const QUALIFIED_SEPARATOR = "__";

const isRemoteToolWord = Schema.is(integrationRemoteCallSchema.fields.remoteTool);

const OBJECT_INPUT = verbatimJsonSchema(WireValueSchema, {
  type: "object",
  additionalProperties: true,
});

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

export function isRemoteToolName(name: string): boolean {
  return name.includes(QUALIFIED_SEPARATOR);
}

interface RemoteTool {
  readonly provider: IntegrationProvider;
  readonly connection: string;
  readonly place: number;
  readonly remoteTool: string;
}

function remoteToolIn(connection: string, remoteTool: string): RemoteTool | undefined {
  const account = integrationConnectionOf(connection);
  if (account === undefined || !isRemoteToolWord(remoteTool)) return undefined;
  return { ...account, connection, remoteTool };
}

function remoteToolOf(toolName: string): RemoteTool | undefined {
  const separator = toolName.indexOf(QUALIFIED_SEPARATOR);
  if (separator < 0) return undefined;
  return remoteToolIn(
    toolName.slice(0, separator),
    toolName.slice(separator + QUALIFIED_SEPARATOR.length),
  );
}

function storedAs(
  remote: RemoteTool,
  input: UnparsedWireValue,
  parentCallId: string,
): { readonly name: string; readonly input: UnparsedWireValue } {
  return {
    name: INTEGRATION_REMOTE_TOOL[remote.provider],
    input: {
      remoteTool: remote.remoteTool,
      parentCallId,
      input: input ?? {},
      ...(remote.place > 1 ? { connection: remote.connection } : undefined),
    },
  };
}

export function storedRemoteCall(
  toolName: string,
  input: UnparsedWireValue,
  parentCallId: string,
): { readonly name: string; readonly input: UnparsedWireValue } | undefined {
  const remote = remoteToolOf(toolName);
  return remote === undefined ? undefined : storedAs(remote, input, parentCallId);
}

export function storedServerCall(
  connection: string,
  remoteTool: string,
  input: UnparsedWireValue,
  callId: string,
): { readonly name: string; readonly input: UnparsedWireValue } | undefined {
  const remote = remoteToolIn(connection, remoteTool);
  return remote === undefined ? undefined : storedAs(remote, input, callId);
}
