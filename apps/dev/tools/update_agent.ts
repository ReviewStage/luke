import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { UPDATE_AGENT_TOOL } from "@luke/service/agents/coding-agent-tools";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineTool } from "eve/tools";
import { runAgentTool } from "../host.js";

/**
 * update_agent.ts -- the agent renames, re-models, pins, or switches the servers of another coding agent of its workspace, for the member who started it.
 *
 * The planning model's own `update_agent` too, one implementation for both
 * (`packages/service/src/agents/coding-agent-tools.ts`). Each change takes
 * the store's own write the agent's menu, model chip, and composer make,
 * through the host's door (`../host.ts`), as the member who started this
 * agent; a model the catalog refuses changes nothing.
 */
export default defineTool({
  description: UPDATE_AGENT_TOOL.description,
  inputSchema: emitJsonSchema(UPDATE_AGENT_TOOL.inputSchema),
  execute: async (input, ctx) =>
    // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
    runAgentTool(ctx.session.auth, ctx.session.id, {
      tool: CODER_TOOL.UPDATE_AGENT,
      input: unparsedWire(input as WireBoundaryInput),
      callId: ctx.callId,
    }),
});
