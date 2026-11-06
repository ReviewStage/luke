/**
 * server.ts -- the member MCP server on the MCP SDK: one instance per request, its tools registered from `tools.ts`, each handler the one promise door the tools' effects run through.
 *
 * The SDK's `McpServer` speaks the protocol, 2026-07-28 and the 2025
 * revisions alike, and awaits each tool's handler as a promise, so the
 * effect behind a tool is run here, on the services the request's own
 * fiber handed over with the admitted member provided, never on a runtime of
 * this file's own: the store and the clock a test provides are the ones the
 * tool runs under. This is the one promise door of the server, listed as a
 * permanent adaptor in `tools/anti-slop/effect-edges.json` and root
 * AGENTS.md; what would end it is an Effect-native MCP server that serves
 * the 2026-07-28 revision without a session.
 *
 * A tool's result is answered as its JSON text, which is what an agent
 * reads of any tool, and a refusal, a result whose status is `rejected`, as
 * the tool's own error in that same text, so the agent reads why and may
 * call again; a store the tool could not read, or a defect in it, is
 * answered as the tool's own error in fixed words, so the agent reads a
 * failed call as it reads a refused one. Each tool is registered with its
 * annotations, which tell a client whether it only reads. The SDK checks a
 * call's arguments against the tool's input before the handler runs, and
 * answers a mismatch itself.
 */

import { type CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { failureKind } from "@repo/runtime/effect";
import type { WorkspaceExperiment } from "@repo/settings";
import { Cause, type Context, Effect, Exit, Schema } from "effect";
import { ACTION_RESULT_STATUS } from "../core.js";
import { AdmittedMember, type AdmittedMemberValues } from "./admission.js";
import { MEMBER_MCP_TOOLS, type MemberMcpServices, type MemberMcpToolResult } from "./tools.js";

/** The name the server gives itself to a client, and the version it names. */
const SERVER_INFO = { name: `${PRODUCT_NAME}`, version: "1.0.0" } as const;

/** What a tool answers where it could not run: the words say nothing of why, which the log line does. */
const TOOL_FAILED = "This tool could not run just now; try it again in a moment.";

/** The services a tool's effect needs beyond the admitted member, which the request's fiber hands over. */
export type MemberMcpRequestServices = Exclude<MemberMcpServices, AdmittedMember>;

/** A tool's refusal: a result that says it ran nothing, and why. */
const isRefusal = Schema.is(
  Schema.Struct({ status: Schema.Literal(ACTION_RESULT_STATUS.REJECTED) }),
);

function toolResult(result: MemberMcpToolResult): CallToolResult {
  const content: CallToolResult["content"] = [{ type: "text", text: JSON.stringify(result) }];
  return isRefusal(result) ? { content, isError: true } : { content };
}

const TOOL_FAILED_RESULT: CallToolResult = {
  content: [{ type: "text", text: TOOL_FAILED }],
  isError: true,
};

/** A tool's effect as the SDK awaits it: run on the handed services as the admitted member, its failure or defect logged and answered as the tool's error. */
async function throughDoor(
  services: Context.Context<MemberMcpRequestServices>,
  member: AdmittedMemberValues,
  name: string,
  work: Effect.Effect<MemberMcpToolResult, unknown, MemberMcpServices>,
): Promise<CallToolResult> {
  const answered = work.pipe(
    Effect.map(toolResult),
    Effect.catchCause((cause) =>
      Effect.as(
        Effect.logWarning(`${PRODUCT_NAME} MCP tool ${name} failed: ${failureKind(cause)}`),
        TOOL_FAILED_RESULT,
      ),
    ),
    Effect.provideService(AdmittedMember, member),
  );
  const exit = await Effect.runPromiseExitWith(services)(answered);
  if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
  return exit.value;
}

/** The server for one request: every tool of `MEMBER_MCP_TOOLS` but those of a workspace experiment none of the member's workspaces has on, each run as the admitted member on the handed services. */
export function memberMcpServer(
  services: Context.Context<MemberMcpRequestServices>,
  member: AdmittedMemberValues,
  experimentsOn: ReadonlySet<WorkspaceExperiment>,
): McpServer {
  const server = new McpServer(SERVER_INFO);
  for (const tool of MEMBER_MCP_TOOLS) {
    if (tool.experiment !== undefined && !experimentsOn.has(tool.experiment)) continue;
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      (input) => throughDoor(services, member, tool.name, tool.run(input)),
    );
  }
  return server;
}
