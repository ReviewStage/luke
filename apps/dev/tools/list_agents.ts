import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { LIST_AGENTS_TOOL } from "@luke/service/agents/coding-agent-tools";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineTool } from "eve/tools";
import { runAgentTool } from "../host.js";

/**
 * list_agents.ts -- the agent lists the other coding agents of its workspace, on any task, each with its task, archived ones marked.
 *
 * The planning model's own `list_agents` too, one implementation for both
 * (`packages/service/src/agents/coding-agent-tools.ts`). The call reaches the
 * store through the host's door (`../host.ts`), under the agent its session
 * was admitted to.
 */
export default defineTool({
  description: LIST_AGENTS_TOOL.description,
  inputSchema: emitJsonSchema(LIST_AGENTS_TOOL.inputSchema),
  execute: async (input, ctx) =>
    // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
    runAgentTool(ctx.session.auth, ctx.session.id, {
      tool: CODER_TOOL.LIST_AGENTS,
      input: unparsedWire(input as WireBoundaryInput),
      callId: ctx.callId,
    }),
});
