import { emitJsonSchema } from "@sidecar/wire/effect";
import { defineTool } from "eve/tools";
import { unparsedWire, type WireBoundaryInput } from "../../server/core.js";
import { SHOW_PAGE_TOOL } from "../../server/hosted/page-tool.js";
import { runShowPageTool } from "../host.js";

/**
 * show_page.ts -- the agent shows the developer an interactive HTML page in the plan's side panel, or a new version of one.
 *
 * The planning model's tool too, one implementation for both
 * (`server/hosted/page-tool.ts`). The call reaches the store through the
 * host's door (`../host.ts`), as `edit_plan` does, and a page named by
 * its path is read from the session's sandbox through the same door eve
 * hands every file tool, opened on first use, so a page sent inline opens
 * none.
 */
export default defineTool({
  description: SHOW_PAGE_TOOL.description,
  inputSchema: emitJsonSchema(SHOW_PAGE_TOOL.inputSchema),
  execute: async (input, ctx) =>
    // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
    runShowPageTool(
      ctx.session.auth,
      ctx.session.id,
      unparsedWire(input as WireBoundaryInput),
      () => ctx.getSandbox(),
    ),
});
