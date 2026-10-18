import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { CREATE_SECTION_TOOL } from "@luke/service/agents/task-section-tools";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineTool } from "eve/tools";
import { runAgentTool } from "../host.js";

/**
 * create_section.ts -- the agent makes a section in its workspace's sidebar, for the member who started it, to keep tasks in.
 *
 * The planning model's own `create_section` too, one implementation for both
 * (`packages/service/src/agents/task-section-tools.ts`). The call reaches the
 * store through the host's door (`../host.ts`), under the agent its session
 * was admitted to, and acts on the sections of the member who started it.
 */
export default defineTool({
  description: CREATE_SECTION_TOOL.description,
  inputSchema: emitJsonSchema(CREATE_SECTION_TOOL.inputSchema),
  execute: async (input, ctx) =>
    // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
    runAgentTool(ctx.session.auth, ctx.session.id, {
      tool: CODER_TOOL.CREATE_SECTION,
      input: unparsedWire(input as WireBoundaryInput),
      callId: ctx.callId,
    }),
});
