import { AGENT_TOOL } from "@luke/features/agent-tools";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineTool } from "eve/tools";
import { CODER_CODING_AGENT_TOOLS } from "../../server/hosted/coding-agent-tools.js";
import { runCodingAgentTool } from "../host.js";

/**
 * list_coding_agents.ts -- the agent lists the plan's coding agents, itself among them, with each one's status and what it last did.
 *
 * The planning model's own tool, one implementation for both
 * (`server/hosted/coding-agent-tools.ts`), bound to the agent's own plan
 * through the host's door (`../host.ts`), as `show_page` is, under eve's
 * id for the call.
 */
const TOOL = CODER_CODING_AGENT_TOOLS[AGENT_TOOL.LIST_CODING_AGENTS];

export default defineTool({
  description: TOOL.description,
  inputSchema: emitJsonSchema(TOOL.inputSchema),
  execute: async (input, ctx) =>
    // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
    runCodingAgentTool(
      ctx.session.auth,
      ctx.session.id,
      ctx.callId,
      AGENT_TOOL.LIST_CODING_AGENTS,
      unparsedWire(input as WireBoundaryInput),
    ),
});
