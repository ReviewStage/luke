import { INBOX_TOOL } from "@sidecar/hosted/inbox-wire";
import { emitJsonSchema } from "@sidecar/wire/effect";
import { defineTool } from "eve/tools";
import { unparsedWire, type WireBoundaryInput } from "../../server/core.js";
import { INBOX_TOOLS } from "../../server/hosted/coder-host/inbox.js";
import { runInboxTool } from "../host.js";

/**
 * read_inbox.ts -- the agent reads every item it put in the developer's inbox, answers and all.
 *
 * The call reaches the store through the host's door (`../host.ts`), as
 * `edit_plan` does, and answers with the agent's whole inbox as it stands
 * (`server/hosted/coder-host/inbox.ts`).
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
