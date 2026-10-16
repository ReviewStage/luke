import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { MESSAGE_AGENT_TOOL } from "@luke/service/agents/coding-agent-tools";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineTool } from "eve/tools";
import { runAgentTool } from "../host.js";

/**
 * message_agent.ts -- the agent sends another coding agent of its workspace a message, under its own name.
 *
 * The planning model's own `message_agent` too, one implementation for both
 * (`packages/service/src/agents/coding-agent-tools.ts`). The call reaches the
 * other agent through the host's door (`../host.ts`), on the one path a
 * developer's message takes, under eve's id for the call, so a call run
 * again sends once; it answers once the other agent's session took the
 * message, never waiting for its reply.
 */
export default defineTool({
  description: MESSAGE_AGENT_TOOL.description,
  inputSchema: emitJsonSchema(MESSAGE_AGENT_TOOL.inputSchema),
  execute: async (input, ctx) =>
    // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
    runAgentTool(ctx.session.auth, ctx.session.id, {
      tool: CODER_TOOL.MESSAGE_AGENT,
      input: unparsedWire(input as WireBoundaryInput),
      callId: ctx.callId,
    }),
});
