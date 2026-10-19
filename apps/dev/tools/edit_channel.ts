import { CHAT_TOOL } from "@luke/features/chat-wire";
import { pinnedState } from "@luke/service/agents/brain-host/pinned-state";
import { CHAT_TOOLS } from "@luke/service/agents/coder-host/chat";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineDynamic, defineTool } from "eve/tools";
import { offeredChatTools, runChatTool } from "../host.js";
import { sessionPrompt } from "../session-prompt.js";

/**
 * edit_channel.ts -- the agent renames a topic channel, says or clears what it is for, or archives it or brings it back.
 *
 * The call reaches the store through the host's door (`../host.ts`), as
 * `edit_plan` does, and answers with the channel as it then stands
 * (`packages/service/src/agents/coder-host/chat.ts`). It is offered at each
 * turn's start only where the agent's starter turned Chat on
 * (`offeredChatTools`).
 */
export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) =>
      (await offeredChatTools(ctx.session.auth, ctx.session.id, pinnedState(sessionPrompt).get()))
        ? defineTool({
            description: CHAT_TOOLS.EDIT_CHANNEL.description,
            inputSchema: emitJsonSchema(CHAT_TOOLS.EDIT_CHANNEL.inputSchema),
            execute: async (input, toolContext) =>
              runChatTool(toolContext.session.auth, toolContext.session.id, {
                tool: CHAT_TOOL.EDIT_CHANNEL,
                // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
                input: unparsedWire(input as WireBoundaryInput),
              }),
          })
        : null,
  },
});
