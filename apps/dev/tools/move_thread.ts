import { CHANNEL_TOOL } from "@luke/features/channel-wire";
import { INBOX_TOOLS } from "@luke/service/agents/coder-host/inbox";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineTool } from "eve/tools";
import { runInboxTool } from "../host.js";

/**
 * move_thread.ts -- the agent moves a thread it may read into another open channel of its workspace, as a member does.
 *
 * The call reaches the store through the host's door (`../host.ts`), as
 * the thread tools do, and answers with the thread and the channel it now lives in
 * (`packages/service/src/agents/coder-host/inbox.ts`).
 */
export default defineTool({
  description: INBOX_TOOLS.MOVE_THREAD.description,
  inputSchema: emitJsonSchema(INBOX_TOOLS.MOVE_THREAD.inputSchema),
  execute: async (input, ctx) =>
    // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
    runInboxTool(ctx.session.auth, ctx.session.id, {
      tool: CHANNEL_TOOL.MOVE,
      input: unparsedWire(input as WireBoundaryInput),
    }),
});
