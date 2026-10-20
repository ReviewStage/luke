/**
 * tools.ts -- the Luke tools a native harness's agent is served over MCP, each by its eve tool's own schema and door.
 *
 * A Claude Code or Codex agent keeps its harness's own shell, files, todos,
 * and subagents; what touches Luke reaches it as an MCP tool of Luke's own
 * server (`app.ts`). Each tool here is the one the agent's eve tool file
 * declares (`apps/dev/tools/<name>.ts`): the same name, the same description,
 * the same input schema, and the same door on the coder host, so the two
 * runtimes run one implementation. The registry maps a tool's name to those
 * three and nothing else, so serving another tool is one entry.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import { INBOX_TOOL } from "@luke/features/inbox-wire";
import { ACTION_RESULT_STATUS, type UnparsedWireValue } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import type { Effect } from "effect";
import type { AdmittedConversation } from "../brain-host/conversation.js";
import type { CoderHost } from "../coder-host/host.js";
import { INBOX_TOOLS } from "../coder-host/inbox.js";

/** What a door answers: the tool's own result, the value its eve tool hands the model. */
export type LukeMcpToolResult = { readonly status?: string } & object;

/** One tool as the server offers and runs it. */
export interface LukeMcpTool {
  readonly description: string;
  /** The input schema as JSON Schema, emitted from the eve tool's own. */
  readonly inputSchema: object;
  /** Runs one call through the tool's door on the coder host, as the agent's admitted conversation. */
  readonly run: (
    host: CoderHost,
    admitted: AdmittedConversation,
    input: UnparsedWireValue,
  ) => Effect.Effect<LukeMcpToolResult, unknown, DatabaseServices>;
}

/** The tools served, by name. */
export const LUKE_MCP_TOOLS: ReadonlyMap<string, LukeMcpTool> = new Map<string, LukeMcpTool>([
  [
    INBOX_TOOL.READ,
    {
      description: INBOX_TOOLS.READ.description,
      inputSchema: emitJsonSchema(INBOX_TOOLS.READ.inputSchema),
      run: (host, admitted, input) => host.inbox(admitted, { tool: INBOX_TOOL.READ, input }),
    },
  ],
]);

/** Whether a door's answer is its refusal, which the server answers as a tool error the agent reads. */
export function refusedByDoor(result: LukeMcpToolResult): boolean {
  return result.status === ACTION_RESULT_STATUS.REJECTED;
}
