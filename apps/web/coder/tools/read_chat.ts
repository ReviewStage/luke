import { CHAT_TOOL } from "@luke/features/chat-wire";
import { CHAT_TOOLS } from "@luke/service/agents/coder-host/chat";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineTool } from "eve/tools";
import { runChatTool } from "../host.js";

/**
 * read_chat.ts -- the agent reads its workspace's chat: who is in it, its channels, and the messages.
 *
 * The call reaches the store through the host's door (`../host.ts`), as
 * `edit_plan` does, and answers the chat as the agent sees it
 * (`server/hosted/coder-host/chat.ts`).
 */
export default defineTool({
  description: CHAT_TOOLS.READ.description,
  inputSchema: emitJsonSchema(CHAT_TOOLS.READ.inputSchema),
  execute: async (input, ctx) =>
    runChatTool(ctx.session.auth, ctx.session.id, {
      tool: CHAT_TOOL.READ,
      // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
      input: unparsedWire(input as WireBoundaryInput),
    }),
});
