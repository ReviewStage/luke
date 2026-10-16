import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { READ_PAGE_TOOL } from "@luke/service/agents/coding-agent-tools";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineTool } from "eve/tools";
import { runAgentTool } from "../host.js";

/**
 * read_page.ts -- the agent reads a page shown on a task of its workspace, by the page's id.
 *
 * The planning model's own `read_page` too, one implementation for both
 * (`packages/service/src/agents/coding-agent-tools.ts`). The call reaches the
 * store through the host's door (`../host.ts`) on the standing of the member
 * who started this agent, and finds a page of a task of its workspace alone;
 * it answers the page's HTML cut on a line to a bound.
 */
export default defineTool({
  description: READ_PAGE_TOOL.description,
  inputSchema: emitJsonSchema(READ_PAGE_TOOL.inputSchema),
  execute: async (input, ctx) =>
    // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
    runAgentTool(ctx.session.auth, ctx.session.id, {
      tool: CODER_TOOL.READ_PAGE,
      input: unparsedWire(input as WireBoundaryInput),
      callId: ctx.callId,
    }),
});
