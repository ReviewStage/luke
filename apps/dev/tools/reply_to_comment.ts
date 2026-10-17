import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { REPLY_TO_COMMENT_TOOL } from "@luke/service/tasks/comment-tools";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineDynamic, defineTool } from "eve/tools";
import { offeredPlanTools, runCommentToolOf } from "../host.js";

/**
 * reply_to_comment.ts -- the agent answers one of the plan's comment threads, one a member sent it.
 *
 * The planning model's tool too, one implementation for both
 * (`packages/service/src/tasks/comment-tools.ts`), offered to an agent on a
 * task alone, since an agent on none has no comments.
 */
export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) =>
      (await offeredPlanTools(ctx.session.auth, ctx.session.id)).has(CODER_TOOL.REPLY_TO_COMMENT)
        ? defineTool({
            description: REPLY_TO_COMMENT_TOOL.description,
            inputSchema: emitJsonSchema(REPLY_TO_COMMENT_TOOL.inputSchema),
            execute: async (input, toolContext) =>
              // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
              runCommentToolOf(
                toolContext.session.auth,
                toolContext.session.id,
                REPLY_TO_COMMENT_TOOL.name,
                unparsedWire(input as WireBoundaryInput),
              ),
          })
        : null,
  },
});
