import { emitJsonSchema } from "@sidecar/wire/effect";
import { defineTool } from "eve/tools";
import { unparsedWire, type WireBoundaryInput } from "../../../../server/core.js";
import { CODER_TOOL } from "../../../../server/hosted/coder-host/tool-set.js";
import { READ_WEB_PAGE_TOOL } from "../../../../server/hosted/public-research.js";
import { host, runResearchTool } from "../../../host.js";

/**
 * read_web_page.ts -- the planning model's own public page read, a worker's, admitted on its ownership alone, under the turn's budget (`server/hosted/public-research.ts`).
 */
export default defineTool({
  description: READ_WEB_PAGE_TOOL.description,
  inputSchema: emitJsonSchema(READ_WEB_PAGE_TOOL.inputSchema),
  execute: async (input, ctx) =>
    runResearchTool(
      host.admitDelegated,
      CODER_TOOL.READ_WEB_PAGE,
      { auth: ctx.session.auth, sessionId: ctx.session.id, turnId: ctx.session.turn.id },
      // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
      unparsedWire(input as WireBoundaryInput),
    ),
});
