import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { MOVE_TASK_TOOL } from "@luke/service/agents/task-section-tools";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineTool } from "eve/tools";
import { runAgentTool } from "../host.js";

/**
 * move_task.ts -- the agent moves a task of its workspace into one of the sidebar sections of the member who started it, or out of them.
 *
 * The planning model's own `move_task` too, one implementation for both
 * (`packages/service/src/agents/task-section-tools.ts`). The call reaches the
 * store through the host's door (`../host.ts`), under the agent its session
 * was admitted to, and acts on the sections of the member who started it.
 */
export default defineTool({
  description: MOVE_TASK_TOOL.description,
  inputSchema: emitJsonSchema(MOVE_TASK_TOOL.inputSchema),
  execute: async (input, ctx) =>
    // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
    runAgentTool(ctx.session.auth, ctx.session.id, {
      tool: CODER_TOOL.MOVE_TASK,
      input: unparsedWire(input as WireBoundaryInput),
      callId: ctx.callId,
    }),
});
