import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { READ_COMMENTS_TOOL } from "@luke/service/tasks/comment-tools";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineDynamic, defineTool } from "eve/tools";
import { offeredPlanTools, runCommentTool } from "../host.js";

/**
 * read_comments.ts -- `read_comments`, the agent reads the plan's comment threads, open or resolved, for context; reading asks nothing of it (`packages/service/src/tasks/comment-tools.ts`).
 *
 * Offered at each turn's start to an agent on a task alone, since one on
 * none has no comments. Note that its callbacks name nothing but module
 * imports, because eve keeps what a dynamic tool's callback closes over as
 * JSON, and a tool's schema is not.
 */
export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) =>
      (await offeredPlanTools(ctx.session.auth, ctx.session.id)).has(CODER_TOOL.READ_COMMENTS)
        ? defineTool({
            description: READ_COMMENTS_TOOL.description,
            inputSchema: emitJsonSchema(READ_COMMENTS_TOOL.inputSchema),
            execute: (input, toolContext) =>
              // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
              runCommentTool(
                toolContext.session.auth,
                toolContext.session.id,
                READ_COMMENTS_TOOL.name,
                unparsedWire(input as WireBoundaryInput),
              ),
          })
        : null,
  },
});
