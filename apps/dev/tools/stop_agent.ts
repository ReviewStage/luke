import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { STOP_AGENT_TOOL } from "@luke/service/agents/coding-agent-tools";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineTool } from "eve/tools";
import { runAgentTool } from "../host.js";

/**
 * stop_agent.ts -- the agent stops another coding agent of its workspace, its turn under way, on behalf of the member who started it.
 *
 * The planning model's own `stop_agent` too, one implementation for both
 * (`packages/service/src/agents/coding-agent-tools.ts`). The call takes the
 * path the developer's Stop button takes, eve's cancel of the turn under
 * way and then the row's stamp, through the host's door (`../host.ts`), as
 * the deployment acting for the member who started this agent; the agent
 * stopped stays available, and an idle one is answered as idle. The caller
 * itself and an archived agent are refused, and a Stop already standing
 * answers as done, so a call run again cancels nothing twice.
 */
export default defineTool({
  description: STOP_AGENT_TOOL.description,
  inputSchema: emitJsonSchema(STOP_AGENT_TOOL.inputSchema),
  execute: async (input, ctx) =>
    // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
    runAgentTool(ctx.session.auth, ctx.session.id, {
      tool: CODER_TOOL.STOP_AGENT,
      input: unparsedWire(input as WireBoundaryInput),
      callId: ctx.callId,
    }),
});
