import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { CREATE_TASK_TOOL } from "@luke/service/agents/task-tools";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineTool } from "eve/tools";
import { runAgentTool } from "../host.js";

/**
 * create_task.ts -- the agent makes a task in its workspace, for the member who started it, with no agent on it.
 *
 * The planning model's own `create_task` too, one implementation for both
 * (`packages/service/src/agents/task-tools.ts`). The call reaches the store
 * and GitHub through the host's door (`../host.ts`), under the agent its
 * session was admitted to, and makes the task as the member who started it,
 * once under the call's key.
 */
export default defineTool({
  description: CREATE_TASK_TOOL.description,
  inputSchema: emitJsonSchema(CREATE_TASK_TOOL.inputSchema),
  execute: async (input, ctx) =>
    // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
    runAgentTool(ctx.session.auth, ctx.session.id, {
      tool: CODER_TOOL.CREATE_TASK,
      input: unparsedWire(input as WireBoundaryInput),
      callId: ctx.callId,
    }),
});
