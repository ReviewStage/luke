import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { RESOLVE_THREAD_TOOL } from "@luke/service/tasks/comment-tools";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineDynamic, defineTool } from "eve/tools";
import { offeredPlanTools, runCommentTool } from "../host.js";

/**
 * resolve_thread.ts -- `resolve_thread`, the agent resolves one of the plan's comment threads once what it asked is settled (`packages/service/src/tasks/comment-tools.ts`).
 *
 * Offered at each turn's start to an agent on a task alone, since one on
 * none has no comments. Note that its callbacks name nothing but module
 * imports, because eve keeps what a dynamic tool's callback closes over as
 * JSON, and a tool's schema is not.
 */
export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) =>
      (await offeredPlanTools(ctx.session.auth, ctx.session.id)).has(CODER_TOOL.RESOLVE_THREAD)
        ? defineTool({
            description: RESOLVE_THREAD_TOOL.description,
            inputSchema: emitJsonSchema(RESOLVE_THREAD_TOOL.inputSchema),
            execute: (input, toolContext) =>
              // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
              runCommentTool(
                toolContext.session.auth,
                toolContext.session.id,
                RESOLVE_THREAD_TOOL.name,
                unparsedWire(input as WireBoundaryInput),
              ),
          })
        : null,
  },
});
