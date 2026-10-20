import { CHAT_TOOL } from "@luke/features/chat-wire";
import { pinnedState } from "@luke/service/agents/brain-host/pinned-state";
import { CHAT_TOOLS } from "@luke/service/agents/coder-host/chat";
import { reserveNotes, settleNotes, takenInTurn } from "@luke/service/agents/coder-host/plan-edit";
import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { ACTION_RESULT_STATUS, unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineDynamic, defineTool } from "eve/tools";
import { offeredChatTools, runChatTool } from "../host.js";
import { chatPostsMade, sessionPrompt } from "../session-prompt.js";

/**
 * chat.ts -- the agent's tools in its workspace's chat: post a message, told to the members it addresses; read the chat; resolve an ask of its own; and edit a topic channel.
 *
 * Each call reaches the store through the host's door (`../host.ts`) and
 * answers as `packages/service/src/agents/coder-host/chat.ts` says. They
 * are offered at each turn's start only where the agent's starter turned
 * Chat on and its session's prompt told of chat (`offeredChatTools`).
 *
 * A post's call id is its key, so a call eve replays posts once. The turn's
 * count of posts is the session's own state, pinned before anything awaits,
 * and reserved before the post goes out, as `edit_plan` reserves its notes,
 * because calls one step makes run at once and each must see the other's
 * reservation. An image block's picture is read from the session's sandbox
 * through the same door eve hands every file tool, opened on first use, so
 * a post with no image opens none. One file for all four, each tool named
 * by its key, for the reason `workspace.ts` gives, so the turn asks the
 * host once whether it is offered them rather than once a tool.
 */
export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) =>
      (await offeredChatTools(ctx.session.auth, ctx.session.id, pinnedState(sessionPrompt).get()))
        ? {
            [CODER_TOOL.EDIT_CHANNEL]: defineTool({
              description: CHAT_TOOLS.EDIT_CHANNEL.description,
              inputSchema: emitJsonSchema(CHAT_TOOLS.EDIT_CHANNEL.inputSchema),
              execute: async (input, toolContext) =>
                runChatTool(toolContext.session.auth, toolContext.session.id, {
                  tool: CHAT_TOOL.EDIT_CHANNEL,
                  // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
                  input: unparsedWire(input as WireBoundaryInput),
                }),
            }),
            [CODER_TOOL.POST_CHAT]: defineTool({
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
                  sandbox: () => toolContext.getSandbox(),
                });
                const posted = answer.status === ACTION_RESULT_STATUS.ACCEPTED ? 1 : 0;
                made.update((held) => settleNotes(held, turnId, 1, posted));
                return answer;
              },
            }),
            [CODER_TOOL.READ_CHAT]: defineTool({
              description: CHAT_TOOLS.READ.description,
              inputSchema: emitJsonSchema(CHAT_TOOLS.READ.inputSchema),
              execute: async (input, toolContext) =>
                runChatTool(toolContext.session.auth, toolContext.session.id, {
                  tool: CHAT_TOOL.READ,
                  // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
                  input: unparsedWire(input as WireBoundaryInput),
                }),
            }),
            [CODER_TOOL.RESOLVE_ASK]: defineTool({
              description: CHAT_TOOLS.RESOLVE.description,
              inputSchema: emitJsonSchema(CHAT_TOOLS.RESOLVE.inputSchema),
              execute: async (input, toolContext) =>
                runChatTool(toolContext.session.auth, toolContext.session.id, {
                  tool: CHAT_TOOL.RESOLVE,
                  // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
                  input: unparsedWire(input as WireBoundaryInput),
                }),
            }),
          }
        : null,
  },
});
