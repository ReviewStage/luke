import { CODER_SHOW_PAGE_TOOL } from "@luke/service/tasks/page-tool";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineTool } from "eve/tools";
import { runShowPageTool } from "../host.js";

/**
 * show_page.ts -- the agent shows the developer an interactive HTML page in the task's side panel, or a new version of one.
 *
 * A coding agent names its page by `path` alone, a file in its sandbox; the
 * brain's own tool also takes `html`, one implementation under both
 * (`packages/service/src/tasks/page-tool.ts`). The call reaches the store through the
 * host's door (`../host.ts`), as `post_thread` does, and a page named by
 * its path is read from the session's sandbox through the same door eve
 * hands every file tool, opened on first use. Every agent is offered it,
 * one on no task among them, whose pages stand on the agent itself.
 */
export default defineTool({
  description: CODER_SHOW_PAGE_TOOL.description,
  inputSchema: emitJsonSchema(CODER_SHOW_PAGE_TOOL.inputSchema),
  execute: async (input, ctx) =>
    // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
    runShowPageTool(
      ctx.session.auth,
      ctx.session.id,
      unparsedWire(input as WireBoundaryInput),
      () => ctx.getSandbox(),
    ),
});
