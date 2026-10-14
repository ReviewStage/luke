import { AGENT_TOOL } from "@luke/features/agent-tools";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineTool } from "eve/tools";
import { CODER_CODING_AGENT_TOOLS } from "../../server/hosted/coding-agent-tools.js";
import { runCodingAgentTool } from "../host.js";

/**
 * read_coding_agent.ts -- the agent reads one of the plan's coding agents: its status, the pull request from its branch, and a short tail of what it last said and did.
 *
 * The planning model's own tool, one implementation for both
 * (`server/hosted/coding-agent-tools.ts`), bound to the agent's own plan
 * through the host's door (`../host.ts`), as `show_page` is, under eve's
 * id for the call.
 */
const TOOL = CODER_CODING_AGENT_TOOLS[AGENT_TOOL.READ_CODING_AGENT];

export default defineTool({
  description: TOOL.description,
  inputSchema: emitJsonSchema(TOOL.inputSchema),
  execute: async (input, ctx) =>
    // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
    runCodingAgentTool(
      ctx.session.auth,
      ctx.session.id,
      ctx.callId,
      AGENT_TOOL.READ_CODING_AGENT,
      unparsedWire(input as WireBoundaryInput),
    ),
});
