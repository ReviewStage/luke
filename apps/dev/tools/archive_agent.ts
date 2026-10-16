import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { ARCHIVE_AGENT_TOOL } from "@luke/service/agents/coding-agent-tools";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineTool } from "eve/tools";
import { runAgentTool } from "../host.js";

/**
 * archive_agent.ts -- the agent archives another coding agent of its workspace, an idle one, on behalf of the member who started it.
 *
 * The planning model's own `archive_agent` too, one implementation for both
 * (`packages/service/src/agents/coding-agent-tools.ts`). The call reaches the
 * store through the host's door (`../host.ts`) on the rule the developer's
 * Archive agent menu keeps, for the member who started this agent, and
 * records this agent as the one that archived it, with the reason given;
 * an agent still working, or the caller itself, is refused, and one
 * already archived answers as done, so a call run again changes nothing.
 */
export default defineTool({
  description: ARCHIVE_AGENT_TOOL.description,
  inputSchema: emitJsonSchema(ARCHIVE_AGENT_TOOL.inputSchema),
  execute: async (input, ctx) =>
    // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
    runAgentTool(ctx.session.auth, ctx.session.id, {
      tool: CODER_TOOL.ARCHIVE_AGENT,
      input: unparsedWire(input as WireBoundaryInput),
      callId: ctx.callId,
    }),
});
