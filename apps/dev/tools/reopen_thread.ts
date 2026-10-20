import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { REOPEN_THREAD_TOOL } from "@luke/service/tasks/comment-tools";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineDynamic, defineTool } from "eve/tools";
import { offeredPlanTools, runCommentTool } from "../host.js";

/**
 * reopen_thread.ts -- `reopen_thread`, the agent reopens one of the plan's resolved comment threads (`packages/service/src/tasks/comment-tools.ts`).
 *
 * Offered at each turn's start to an agent on a task alone, since one on
 * none has no comments. Note that its callbacks name nothing but module
 * imports, because eve keeps what a dynamic tool's callback closes over as
 * JSON, and a tool's schema is not.
 */
export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) =>
      (await offeredPlanTools(ctx.session.auth, ctx.session.id)).has(CODER_TOOL.REOPEN_THREAD)
        ? defineTool({
            description: REOPEN_THREAD_TOOL.description,
            inputSchema: emitJsonSchema(REOPEN_THREAD_TOOL.inputSchema),
            execute: (input, toolContext) =>
              // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
              runCommentTool(
                toolContext.session.auth,
                toolContext.session.id,
                REOPEN_THREAD_TOOL.name,
                unparsedWire(input as WireBoundaryInput),
              ),
          })
        : null,
  },
});
