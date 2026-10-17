import { CHAT_TOOL } from "@luke/features/chat-wire";
import { CHAT_TOOLS } from "@luke/service/agents/coder-host/chat";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineDynamic, defineTool } from "eve/tools";
import { offeredChatTools, runChatTool } from "../host.js";

/**
 * read_chat.ts -- the agent reads its workspace's chat: who is in it, its channels, and the messages.
 *
 * The call reaches the store through the host's door (`../host.ts`), as
 * `edit_plan` does, and answers the chat as the agent sees it
 * (`packages/service/src/agents/coder-host/chat.ts`). It is offered at each
 * turn's start only where the agent's starter turned Chat on
 * (`offeredChatTools`).
 */
export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) =>
      (await offeredChatTools(ctx.session.auth, ctx.session.id))
        ? defineTool({
            description: CHAT_TOOLS.READ.description,
            inputSchema: emitJsonSchema(CHAT_TOOLS.READ.inputSchema),
            execute: async (input, toolContext) =>
              runChatTool(toolContext.session.auth, toolContext.session.id, {
                tool: CHAT_TOOL.READ,
                // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
                input: unparsedWire(input as WireBoundaryInput),
              }),
          })
        : null,
  },
});
