import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { CODER_READ_AGENT_TOOL } from "@luke/service/agents/coding-agent-tools";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineTool } from "eve/tools";
import { runAgentTool } from "../host.js";

/**
 * read_agent.ts -- the agent reads another coding agent of its workspace: where it stands, what it published, and the tail of its transcript.
 *
 * The planning model's own `read_agent` too, one implementation for both
 * (`packages/service/src/agents/coding-agent-tools.ts`), in words of its own
 * and with a longer tail it may ask for. The call reaches the store through
 * the host's door (`../host.ts`) on the standing of the member who started
 * this agent, and finds an agent of its workspace alone.
 */
export default defineTool({
  description: CODER_READ_AGENT_TOOL.description,
  inputSchema: emitJsonSchema(CODER_READ_AGENT_TOOL.inputSchema),
  execute: async (input, ctx) =>
    // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
    runAgentTool(ctx.session.auth, ctx.session.id, {
      tool: CODER_TOOL.READ_AGENT,
      input: unparsedWire(input as WireBoundaryInput),
      callId: ctx.callId,
    }),
});
