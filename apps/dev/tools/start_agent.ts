import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { START_AGENT_TOOL } from "@luke/service/agents/coding-agent-tools";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineDynamic, defineTool } from "eve/tools";
import { offeredPlanTools, runAgentTool } from "../host.js";

/**
 * start_agent.ts -- the agent starts a new coding agent on its own task, as the Start button would.
 *
 * The planning model's own `start_agent` too, one implementation for both
 * (`packages/service/src/agents/coding-agent-tools.ts`). The call reaches the
 * Start path through the host's door (`../host.ts`), under eve's id for the
 * call, so a call run again starts no second agent, and the agent it starts
 * is told which agent started it and how to report back. It is offered at
 * each turn's start only to an agent on a task (`planToolsOf`), since one on
 * no task has no plan to start another on.
 */
export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) =>
      (await offeredPlanTools(ctx.session.auth, ctx.session.id)).has(CODER_TOOL.START_AGENT)
        ? defineTool({
            description: START_AGENT_TOOL.description,
            inputSchema: emitJsonSchema(START_AGENT_TOOL.inputSchema),
            execute: async (input, toolContext) =>
              // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
              runAgentTool(toolContext.session.auth, toolContext.session.id, {
                tool: CODER_TOOL.START_AGENT,
                input: unparsedWire(input as WireBoundaryInput),
                callId: toolContext.callId,
              }),
          })
        : null,
  },
});
