import { CHAT_TOOL } from "@luke/features/chat-wire";
import { CHAT_TOOLS } from "@luke/service/agents/coder-host/chat";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineTool } from "eve/tools";
import { runChatTool } from "../host.js";

/**
 * resolve_ask.ts -- the agent resolves an ask of its own in chat, by its key, with why.
 *
 * The call reaches the store through the host's door (`../host.ts`), as
 * `edit_plan` does, and answers with the agent's asks as they stand
 * (`server/hosted/coder-host/chat.ts`).
 */
export default defineTool({
  description: CHAT_TOOLS.RESOLVE.description,
  inputSchema: emitJsonSchema(CHAT_TOOLS.RESOLVE.inputSchema),
  execute: async (input, ctx) =>
    runChatTool(ctx.session.auth, ctx.session.id, {
      tool: CHAT_TOOL.RESOLVE,
      // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
      input: unparsedWire(input as WireBoundaryInput),
    }),
});
