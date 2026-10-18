import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { DELETE_SECTION_TOOL } from "@luke/service/agents/task-section-tools";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineTool } from "eve/tools";
import { runAgentTool } from "../host.js";

/**
 * delete_section.ts -- the agent deletes a sidebar section of the member who started it, its tasks back under Tasks.
 *
 * The planning model's own `delete_section` too, one implementation for both
 * (`packages/service/src/agents/task-section-tools.ts`). The call reaches the
 * store through the host's door (`../host.ts`), under the agent its session
 * was admitted to, and acts on the sections of the member who started it.
 */
export default defineTool({
  description: DELETE_SECTION_TOOL.description,
  inputSchema: emitJsonSchema(DELETE_SECTION_TOOL.inputSchema),
  execute: async (input, ctx) =>
    // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
    runAgentTool(ctx.session.auth, ctx.session.id, {
      tool: CODER_TOOL.DELETE_SECTION,
      input: unparsedWire(input as WireBoundaryInput),
      callId: ctx.callId,
    }),
});
