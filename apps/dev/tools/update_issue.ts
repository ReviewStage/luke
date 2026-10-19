import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { UPDATE_ISSUE_TOOL } from "@luke/service/agents/issue-tools";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineTool } from "eve/tools";
import { runAgentTool } from "../host.js";

/**
 * update_issue.ts -- the agent changes an issue of its workspace, archives it, or brings it back.
 *
 * The planning model's own `update_issue` too, one implementation for both
 * (`packages/service/src/agents/issue-tools.ts`). The call reaches the
 * store through the host's door (`../host.ts`), under the agent its session
 * was admitted to, and acts on the issues of its workspace as the member who
 * started it reads them.
 */
export default defineTool({
  description: UPDATE_ISSUE_TOOL.description,
  inputSchema: emitJsonSchema(UPDATE_ISSUE_TOOL.inputSchema),
  execute: async (input, ctx) =>
    // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
    runAgentTool(ctx.session.auth, ctx.session.id, {
      tool: CODER_TOOL.UPDATE_ISSUE,
      input: unparsedWire(input as WireBoundaryInput),
      callId: ctx.callId,
    }),
});
