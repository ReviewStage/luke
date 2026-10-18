import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { ARCHIVE_TASK_TOOL } from "@luke/service/agents/coding-agent-tools";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineTool } from "eve/tools";
import { runAgentTool } from "../host.js";

/**
 * archive_task.ts -- the agent archives a task of its workspace on behalf of the member who started it.
 *
 * The planning model's own `archive_task` too, one implementation for both
 * (`packages/service/src/agents/coding-agent-tools.ts`). The call reaches the
 * store through the host's door (`../host.ts`) on the rule the developer's
 * Archive task menu keeps, for the member who started this agent, and stops
 * no agent, as the menu stops none; the task this agent works on is
 * refused, and one already archived answers as done, so a call run again
 * changes nothing.
 */
export default defineTool({
  description: ARCHIVE_TASK_TOOL.description,
  inputSchema: emitJsonSchema(ARCHIVE_TASK_TOOL.inputSchema),
  execute: async (input, ctx) =>
    // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
    runAgentTool(ctx.session.auth, ctx.session.id, {
      tool: CODER_TOOL.ARCHIVE_TASK,
      input: unparsedWire(input as WireBoundaryInput),
      callId: ctx.callId,
    }),
});
