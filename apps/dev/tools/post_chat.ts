import { CHAT_TOOL } from "@luke/features/chat-wire";
import { pinnedState } from "@luke/service/agents/brain-host/pinned-state";
import { CHAT_TOOLS } from "@luke/service/agents/coder-host/chat";
import { reserveNotes, settleNotes, takenInTurn } from "@luke/service/agents/coder-host/plan-edit";
import { ACTION_RESULT_STATUS, unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineDynamic, defineTool } from "eve/tools";
import { offeredChatTools, runChatTool } from "../host.js";
import { chatPostsMade } from "../session-prompt.js";

/**
 * post_chat.ts -- the agent posts a message in its workspace's chat, told to the members it addresses.
 *
 * The call reaches the store through the host's door (`../host.ts`), as
 * `edit_plan` does, and answers the post's receipt
 * (`packages/service/src/agents/coder-host/chat.ts`). The call's own id is
 * the post's key, so a call eve replays posts once. The turn's count of
 * posts is the session's own state, pinned before anything awaits, and
 * reserved before the post goes out, as `edit_plan` reserves its notes,
 * because calls one step makes run at once and each must see the other's
 * reservation. It is offered at each turn's start only where the agent's
 * starter turned Chat on (`offeredChatTools`).
 */
export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) =>
      (await offeredChatTools(ctx.session.auth, ctx.session.id))
        ? defineTool({
            description: CHAT_TOOLS.POST.description,
            inputSchema: emitJsonSchema(CHAT_TOOLS.POST.inputSchema),
            execute: async (input, toolContext) => {
              const made = pinnedState(chatPostsMade);
              const turnId = toolContext.session.turn.id;
              const before = takenInTurn(made.get(), turnId);
              made.update((held) => reserveNotes(held, turnId, 1));
              const answer = await runChatTool(toolContext.session.auth, toolContext.session.id, {
                tool: CHAT_TOOL.POST,
                // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
                input: unparsedWire(input as WireBoundaryInput),
                clientKey: toolContext.callId,
                postsInTurn: before,
              });
              const posted = answer.status === ACTION_RESULT_STATUS.ACCEPTED ? 1 : 0;
              made.update((held) => settleNotes(held, turnId, 1, posted));
              return answer;
            },
          })
        : null,
  },
});
