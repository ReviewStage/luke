import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { READ_WEB_PAGE_TOOL } from "@luke/service/agents/public-research";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineTool } from "eve/tools";
import { host, runResearchTool } from "../host.js";

/**
 * read_web_page.ts -- the brain's own public page read, the agent's under the turn's budget (`packages/service/src/agents/public-research.ts`).
 */
export default defineTool({
  description: READ_WEB_PAGE_TOOL.description,
  inputSchema: emitJsonSchema(READ_WEB_PAGE_TOOL.inputSchema),
  execute: async (input, ctx) =>
    runResearchTool(
      host.admit,
      CODER_TOOL.READ_WEB_PAGE,
      { auth: ctx.session.auth, sessionId: ctx.session.id, turnId: ctx.session.turn.id },
      // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
      unparsedWire(input as WireBoundaryInput),
    ),
});
