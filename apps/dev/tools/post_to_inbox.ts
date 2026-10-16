import { INBOX_TOOL } from "@luke/features/inbox-wire";
import { INBOX_TOOLS } from "@luke/service/agents/coder-host/inbox";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineTool } from "eve/tools";
import { runInboxTool } from "../host.js";

/**
 * post_to_inbox.ts -- the agent posts an item to the developer's inbox, or replaces the one under the same key.
 *
 * The call reaches the store through the host's door (`../host.ts`), as
 * `edit_plan` does, and answers with the agent's whole inbox as it stands
 * (`packages/service/src/agents/coder-host/inbox.ts`). An image block's picture is read
 * from the session's sandbox through the same door eve hands every file
 * tool, opened on first use, so a post with no image opens none.
 */
export default defineTool({
  description: INBOX_TOOLS.POST.description,
  inputSchema: emitJsonSchema(INBOX_TOOLS.POST.inputSchema),
  execute: async (input, ctx) =>
    // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
    runInboxTool(ctx.session.auth, ctx.session.id, {
      tool: INBOX_TOOL.POST,
      input: unparsedWire(input as WireBoundaryInput),
      sandbox: () => ctx.getSandbox(),
    }),
});
