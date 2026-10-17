import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { RESOLVE_THREAD_TOOL } from "@luke/service/tasks/comment-tools";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineDynamic, defineTool } from "eve/tools";
import { offeredPlanTools, runCommentToolOf } from "../host.js";

/**
 * resolve_thread.ts -- the agent resolves one of the plan's comment threads once what it asked is settled.
 *
 * The planning model's tool too, one implementation for both
 * (`packages/service/src/tasks/comment-tools.ts`), offered to an agent on a
 * task alone, since an agent on none has no comments.
 */
export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) =>
      (await offeredPlanTools(ctx.session.auth, ctx.session.id)).has(CODER_TOOL.RESOLVE_THREAD)
        ? defineTool({
            description: RESOLVE_THREAD_TOOL.description,
            inputSchema: emitJsonSchema(RESOLVE_THREAD_TOOL.inputSchema),
            execute: async (input, toolContext) =>
              // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
              runCommentToolOf(
                toolContext.session.auth,
                toolContext.session.id,
                RESOLVE_THREAD_TOOL.name,
                unparsedWire(input as WireBoundaryInput),
              ),
          })
        : null,
  },
});
