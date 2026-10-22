import { INBOX_TOOL } from "@luke/features/inbox-wire";
import { INBOX_TOOLS } from "@luke/service/agents/coder-host/inbox";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineTool } from "eve/tools";
import { runInboxTool } from "../host.js";

/**
 * read_inbox.ts -- the agent reads its threads in the developer's inbox, each message with its ask and the answers.
 *
 * The call reaches the store through the host's door (`../host.ts`), as
 * `edit_plan` does, and answers with the agent's whole inbox as it stands
 * (`packages/service/src/agents/coder-host/inbox.ts`).
 */
export default defineTool({
  description: INBOX_TOOLS.READ.description,
  inputSchema: emitJsonSchema(INBOX_TOOLS.READ.inputSchema),
  execute: async (input, ctx) =>
    // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
    runInboxTool(ctx.session.auth, ctx.session.id, {
      tool: INBOX_TOOL.READ,
      input: unparsedWire(input as WireBoundaryInput),
    }),
});
