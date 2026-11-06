import { type CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { failureKind } from "@repo/runtime/effect";
import { Cause, type Context, Effect, Exit, Schema } from "effect";
import { ACTION_RESULT_STATUS } from "../core.js";
import { AdmittedMember, type AdmittedMemberValues } from "./admission.js";
import { MEMBER_MCP_TOOLS, type MemberMcpServices, type MemberMcpToolResult } from "./tools.js";

const SERVER_INFO = { name: `${PRODUCT_NAME}`, version: "1.0.0" } as const;

const TOOL_FAILED = "This tool could not run just now; try it again in a moment.";

export type MemberMcpRequestServices = Exclude<MemberMcpServices, AdmittedMember>;

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

export function memberMcpServer(
  services: Context.Context<MemberMcpRequestServices>,
  member: AdmittedMemberValues,
): McpServer {
  const server = new McpServer(SERVER_INFO);
  for (const tool of MEMBER_MCP_TOOLS) {
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
