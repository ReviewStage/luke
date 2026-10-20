import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { LOOK_AT_BOARD_TOOL, lookModelOutput } from "@luke/service/tasks/board-look";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineDynamic, defineTool } from "eve/tools";
import { offeredTaskTools, runBoardTool } from "../host.js";

/**
 * look_at_board.ts -- the agent looks at its task's whiteboard as the developer's Mac drew it.
 *
 * The brain's tool too, one implementation for both
 * (`packages/service/src/tasks/board-look.ts`). The call reaches the store
 * through the host's door (`../host.ts`), as `draw_on_board` does, and its
 * answer is shown to the model as the board's picture itself, never its
 * base64 as text; the transcript keeps only that it looked
 * (`storedLookOutput`, which the shared relay applies). It is offered at
 * each turn's start only to an agent on a task (`taskToolsOf`).
 */
export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) =>
      (await offeredTaskTools(ctx.session.auth, ctx.session.id)).has(CODER_TOOL.LOOK_AT_BOARD)
        ? defineTool({
            description: LOOK_AT_BOARD_TOOL.description,
            inputSchema: emitJsonSchema(LOOK_AT_BOARD_TOOL.inputSchema),
            // SAFETY: eve hands this the JSON the tool's own execute answered; the reader parses it as wire input.
            toModelOutput: (output) => lookModelOutput(unparsedWire(output as WireBoundaryInput)),
            execute: async (input, toolContext) =>
              // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
              runBoardTool(
                toolContext.session.auth,
                toolContext.session.id,
                CODER_TOOL.LOOK_AT_BOARD,
                unparsedWire(input as WireBoundaryInput),
              ),
          })
        : null,
  },
});
