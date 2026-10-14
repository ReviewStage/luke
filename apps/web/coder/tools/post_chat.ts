import { CHAT_TOOL } from "@luke/features/chat-wire";
import { pinnedState } from "@luke/service/agents/brain-host/pinned-state";
import { CHAT_TOOLS } from "@luke/service/agents/coder-host/chat";
import { reserveNotes, settleNotes, takenInTurn } from "@luke/service/agents/coder-host/plan-edit";
import { ACTION_RESULT_STATUS, unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineTool } from "eve/tools";
import { runChatTool } from "../host.js";
import { chatPostsMade } from "../session-prompt.js";

/**
 * post_chat.ts -- the agent posts a message in its workspace's chat, told to the members it addresses.
 *
 * The call reaches the store through the host's door (`../host.ts`), as
 * `edit_plan` does, and answers the post's receipt
 * (`server/hosted/coder-host/chat.ts`). The call's own id is the post's
 * key, so a call eve replays posts once. The turn's count of posts is the
 * session's own state, pinned before anything awaits, and reserved before
 * the post goes out, as `edit_plan` reserves its notes, because calls one
 * step makes run at once and each must see the other's reservation. An
 * image block's picture is read from the session's sandbox through the
 * same door eve hands every file tool, opened on first use, so a post with
 * no image opens none.
 */
export default defineTool({
  description: CHAT_TOOLS.POST.description,
  inputSchema: emitJsonSchema(CHAT_TOOLS.POST.inputSchema),
  execute: async (input, ctx) => {
    const made = pinnedState(chatPostsMade);
    const turnId = ctx.session.turn.id;
    const before = takenInTurn(made.get(), turnId);
    made.update((held) => reserveNotes(held, turnId, 1));
    const answer = await runChatTool(ctx.session.auth, ctx.session.id, {
      tool: CHAT_TOOL.POST,
      // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
      input: unparsedWire(input as WireBoundaryInput),
      clientKey: ctx.callId,
      postsInTurn: before,
      sandbox: () => ctx.getSandbox(),
    });
    const posted = answer.status === ACTION_RESULT_STATUS.ACCEPTED ? 1 : 0;
    made.update((held) => settleNotes(held, turnId, 1, posted));
    return answer;
  },
});
