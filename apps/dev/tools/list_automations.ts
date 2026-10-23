import { LIST_AUTOMATIONS_TOOL } from "@luke/service/agents/automation-tools";
import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineTool } from "eve/tools";
import { runAgentTool } from "../host.js";

/**
 * list_automations.ts -- the agent lists its workspace's automations, or reads one whole with its newest runs.
 *
 * One implementation for every runtime
 * (`packages/service/src/agents/automation-tools.ts`). The call reaches the
 * store through the host's door (`../host.ts`), under the agent its session
 * was admitted to, and acts on the automations of its workspace as the
 * member who started it.
 */
export default defineTool({
  description: LIST_AUTOMATIONS_TOOL.description,
  inputSchema: emitJsonSchema(LIST_AUTOMATIONS_TOOL.inputSchema),
  execute: async (input, ctx) =>
    // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
    runAgentTool(ctx.session.auth, ctx.session.id, {
      tool: CODER_TOOL.LIST_AUTOMATIONS,
      input: unparsedWire(input as WireBoundaryInput),
      callId: ctx.callId,
    }),
});
