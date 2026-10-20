import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { DRAW_ON_BOARD_TOOL } from "@luke/service/tasks/board-tool";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineDynamic, defineTool } from "eve/tools";
import { offeredTaskTools, runBoardTool } from "../host.js";

/**
 * draw_on_board.ts -- the agent draws a diagram on its task's whiteboard.
 *
 * The brain's tool too, one implementation for both
 * (`packages/service/src/tasks/board-tool.ts`). The call reaches the store
 * through the host's door (`../host.ts`), drawn as the member whose turn it
 * is on the agent's own task, never a task the model names. It is offered
 * at each turn's start only to an agent on a task (`taskToolsOf`), since
 * one on no task has no board.
 */
export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) =>
      (await offeredTaskTools(ctx.session.auth, ctx.session.id)).has(CODER_TOOL.DRAW_ON_BOARD)
        ? defineTool({
            description: DRAW_ON_BOARD_TOOL.description,
            inputSchema: emitJsonSchema(DRAW_ON_BOARD_TOOL.inputSchema),
            execute: async (input, toolContext) =>
              // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
              runBoardTool(
                toolContext.session.auth,
                toolContext.session.id,
                CODER_TOOL.DRAW_ON_BOARD,
                unparsedWire(input as WireBoundaryInput),
              ),
          })
        : null,
  },
});
