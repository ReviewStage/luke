import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { SEARCH_WEB_TOOL } from "@luke/service/agents/public-research";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineTool } from "eve/tools";
import { host, runResearchTool } from "../../../host.js";

/**
 * search_web.ts -- the planning model's own public search, a worker's, admitted on its ownership alone, under the turn's budget (`packages/service/src/agents/public-research.ts`).
 */
export default defineTool({
  description: SEARCH_WEB_TOOL.description,
  inputSchema: emitJsonSchema(SEARCH_WEB_TOOL.inputSchema),
  execute: async (input, ctx) =>
    runResearchTool(
      host.admitDelegated,
      CODER_TOOL.SEARCH_WEB,
      { auth: ctx.session.auth, sessionId: ctx.session.id, turnId: ctx.session.turn.id },
      // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
      unparsedWire(input as WireBoundaryInput),
    ),
});
