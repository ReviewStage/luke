import { CREATE_AUTOMATION_TOOL } from "@luke/service/agents/automation-tools";
import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineTool } from "eve/tools";
import { runAgentTool } from "../host.js";

/**
 * create_automation.ts -- the agent makes an automation in its workspace, for the member who started it.
 *
 * One implementation for every runtime
 * (`packages/service/src/agents/automation-tools.ts`). The call reaches the
 * store through the host's door (`../host.ts`), under the agent its session
 * was admitted to, and acts on the automations of its workspace as the
 * member who started it.
 */
export default defineTool({
  description: CREATE_AUTOMATION_TOOL.description,
  inputSchema: emitJsonSchema(CREATE_AUTOMATION_TOOL.inputSchema),
  execute: async (input, ctx) =>
    // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
    runAgentTool(ctx.session.auth, ctx.session.id, {
      tool: CODER_TOOL.CREATE_AUTOMATION,
      input: unparsedWire(input as WireBoundaryInput),
      callId: ctx.callId,
    }),
});
