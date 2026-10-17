import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { SHOW_PAGE_TOOL } from "@luke/service/tasks/page-tool";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineDynamic, defineTool } from "eve/tools";
import { offeredPlanTools, runShowPageTool } from "../host.js";

/**
 * show_page.ts -- the agent shows the developer an interactive HTML page in the task's side panel, or a new version of one.
 *
 * The brain's tool too, one implementation for both
 * (`packages/service/src/plans/page-tool.ts`). The call reaches the store through the
 * host's door (`../host.ts`), as `post_to_inbox` does, and a page named by
 * its path is read from the session's sandbox through the same door eve
 * hands every file tool, opened on first use, so a page sent inline opens
 * none. It is offered at each turn's start only to an agent on a plan
 * (`planToolsOf`), since one on no plan has no side panel to show a page in.
 */
export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) =>
      (await offeredPlanTools(ctx.session.auth, ctx.session.id)).has(CODER_TOOL.SHOW_PAGE)
        ? defineTool({
            description: SHOW_PAGE_TOOL.description,
            inputSchema: emitJsonSchema(SHOW_PAGE_TOOL.inputSchema),
            execute: async (input, toolContext) =>
              // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
              runShowPageTool(
                toolContext.session.auth,
                toolContext.session.id,
                unparsedWire(input as WireBoundaryInput),
                () => toolContext.getSandbox(),
              ),
          })
        : null,
  },
});
