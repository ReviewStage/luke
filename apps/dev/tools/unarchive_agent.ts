import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { UNARCHIVE_AGENT_TOOL } from "@luke/service/agents/coding-agent-tools";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineTool } from "eve/tools";
import { runAgentTool } from "../host.js";

/**
 * unarchive_agent.ts -- the agent brings an archived coding agent of its workspace back.
 *
 * The planning model's own `unarchive_agent` too, one implementation for both
 * (`packages/service/src/agents/coding-agent-tools.ts`). The call reaches the
 * store through the host's door (`../host.ts`) on the rule the developer's
 * Unarchive keeps, for the member who started this agent; one not archived
 * answers as done, so a call run again changes nothing.
 */
export default defineTool({
  description: UNARCHIVE_AGENT_TOOL.description,
  inputSchema: emitJsonSchema(UNARCHIVE_AGENT_TOOL.inputSchema),
  execute: async (input, ctx) =>
    // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
    runAgentTool(ctx.session.auth, ctx.session.id, {
      tool: CODER_TOOL.UNARCHIVE_AGENT,
      input: unparsedWire(input as WireBoundaryInput),
      callId: ctx.callId,
    }),
});
