import { INBOX_TOOL } from "@luke/features/inbox-wire";
import { INBOX_TOOLS } from "@luke/service/agents/coder-host/inbox";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineTool } from "eve/tools";
import { runInboxTool } from "../host.js";

/**
 * reply_inbox.ts -- the agent replies on the thread of one of its inbox items, by key, without changing what the item asks.
 *
 * The call reaches the store through the host's door (`../host.ts`), as
 * `post_to_inbox` does, and answers with the agent's whole inbox as it
 * stands (`packages/service/src/agents/coder-host/inbox.ts`). A picture the
 * reply shows is read from the session's sandbox through the same door eve
 * hands every file tool, opened on first use, so a reply with no picture
 * opens none.
 */
export default defineTool({
  description: INBOX_TOOLS.REPLY.description,
  inputSchema: emitJsonSchema(INBOX_TOOLS.REPLY.inputSchema),
  execute: async (input, ctx) =>
    // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
    runInboxTool(ctx.session.auth, ctx.session.id, {
      tool: INBOX_TOOL.REPLY,
      input: unparsedWire(input as WireBoundaryInput),
      sandbox: () => ctx.getSandbox(),
    }),
});
