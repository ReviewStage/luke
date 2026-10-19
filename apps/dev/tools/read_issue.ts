import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { READ_ISSUE_TOOL } from "@luke/service/agents/issue-tools";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineTool } from "eve/tools";
import { runAgentTool } from "../host.js";

/**
 * read_issue.ts -- the agent reads one issue of its workspace by its id or identifier, with its description.
 *
 * The planning model's own `read_issue` too, one implementation for both
 * (`packages/service/src/agents/issue-tools.ts`). The call reaches the
 * store through the host's door (`../host.ts`), under the agent its session
 * was admitted to, and acts on the issues of its workspace as the member who
 * started it reads them.
 */
export default defineTool({
  description: READ_ISSUE_TOOL.description,
  inputSchema: emitJsonSchema(READ_ISSUE_TOOL.inputSchema),
  execute: async (input, ctx) =>
    // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
    runAgentTool(ctx.session.auth, ctx.session.id, {
      tool: CODER_TOOL.READ_ISSUE,
      input: unparsedWire(input as WireBoundaryInput),
      callId: ctx.callId,
    }),
});
