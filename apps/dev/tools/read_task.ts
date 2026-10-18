import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { READ_TASK_TOOL } from "@luke/service/agents/task-tools";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineTool } from "eve/tools";
import { runAgentTool } from "../host.js";

/**
 * read_task.ts -- the agent reads one task of its workspace by its id, its plan included.
 *
 * The planning model's own `read_task` too, one implementation for both
 * (`packages/service/src/agents/task-tools.ts`). The call reaches the store
 * through the host's door (`../host.ts`), under the agent its session was
 * admitted to, and reads as the member who started it.
 */
export default defineTool({
  description: READ_TASK_TOOL.description,
  inputSchema: emitJsonSchema(READ_TASK_TOOL.inputSchema),
  execute: async (input, ctx) =>
    // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
    runAgentTool(ctx.session.auth, ctx.session.id, {
      tool: CODER_TOOL.READ_TASK,
      input: unparsedWire(input as WireBoundaryInput),
      callId: ctx.callId,
    }),
});
