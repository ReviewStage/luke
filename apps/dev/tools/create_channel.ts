import { CHANNEL_TOOL } from "@luke/features/channel-wire";
import { INBOX_TOOLS } from "@luke/service/agents/coder-host/inbox";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineTool } from "eve/tools";
import { runInboxTool } from "../host.js";

/**
 * create_channel.ts -- the agent makes an open channel in its workspace, as a member does.
 *
 * The call reaches the store through the host's door (`../host.ts`), as
 * the thread tools do, and answers with the workspace's open channels as they then stand
 * (`packages/service/src/agents/coder-host/inbox.ts`).
 */
export default defineTool({
  description: INBOX_TOOLS.CREATE_CHANNEL.description,
  inputSchema: emitJsonSchema(INBOX_TOOLS.CREATE_CHANNEL.inputSchema),
  execute: async (input, ctx) =>
    // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
    runInboxTool(ctx.session.auth, ctx.session.id, {
      tool: CHANNEL_TOOL.CREATE,
      input: unparsedWire(input as WireBoundaryInput),
    }),
});
