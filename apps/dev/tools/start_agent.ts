import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { START_AGENT_TOOL } from "@luke/service/agents/coding-agent-tools";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineTool } from "eve/tools";
import { runAgentTool } from "../host.js";

/**
 * start_agent.ts -- the agent starts a new coding agent on its own task or another of its workspace, as the Start button would.
 *
 * The planning model's own `start_agent` too, one implementation for both
 * (`packages/service/src/agents/coding-agent-tools.ts`). The call reaches the
 * Start path through the host's door (`../host.ts`), under eve's id for the
 * call, so a call run again starts no second agent, and the agent it starts
 * is told which agent started it and how to report back. An agent on no
 * task names the task by its id (`list_tasks`).
 */
export default defineTool({
  description: START_AGENT_TOOL.description,
  inputSchema: emitJsonSchema(START_AGENT_TOOL.inputSchema),
  execute: async (input, ctx) =>
    // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
    runAgentTool(ctx.session.auth, ctx.session.id, {
      tool: CODER_TOOL.START_AGENT,
      input: unparsedWire(input as WireBoundaryInput),
      callId: ctx.callId,
    }),
});
