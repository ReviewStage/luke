import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { LIST_ISSUES_TOOL } from "@luke/service/agents/issue-tools";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineTool } from "eve/tools";
import { runAgentTool } from "../host.js";

/**
 * list_issues.ts -- the agent lists its workspace's issues, narrowed and paged as asked.
 *
 * The planning model's own `list_issues` too, one implementation for both
 * (`packages/service/src/agents/issue-tools.ts`). The call reaches the
 * store through the host's door (`../host.ts`), under the agent its session
 * was admitted to, and acts on the issues of its workspace as the member who
 * started it reads them.
 */
export default defineTool({
  description: LIST_ISSUES_TOOL.description,
  inputSchema: emitJsonSchema(LIST_ISSUES_TOOL.inputSchema),
  execute: async (input, ctx) =>
    // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
    runAgentTool(ctx.session.auth, ctx.session.id, {
      tool: CODER_TOOL.LIST_ISSUES,
      input: unparsedWire(input as WireBoundaryInput),
      callId: ctx.callId,
    }),
});
