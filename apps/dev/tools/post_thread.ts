import { INBOX_TOOL } from "@luke/features/inbox-wire";
import { INBOX_TOOLS } from "@luke/service/agents/coder-host/inbox";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineDynamic, defineTool } from "eve/tools";
import { runInboxTool, threadWords } from "../host.js";

/**
 * post_thread.ts -- the agent posts a message, perhaps ending with an ask, on its thread under a key in one of its workspace's channels.
 *
 * The call reaches the store through the host's door (`../host.ts`), as
 * `edit_plan` does, and answers with the agent's threads as they stand
 * (`packages/service/src/agents/coder-host/inbox.ts`). It is offered at each
 * turn's start in words listing the workspace's open channels and their
 * purposes (`threadWords`), for the agent to choose one by. A picture the
 * body draws by its path is read from the session's sandbox through the
 * same door eve hands every file tool, opened on first use, so a post with
 * no such picture opens none.
 */
export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) =>
      defineTool({
        description: await threadWords(ctx.session.auth, ctx.session.id),
        inputSchema: emitJsonSchema(INBOX_TOOLS.POST.inputSchema),
        execute: async (input, toolContext) =>
          // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
          runInboxTool(toolContext.session.auth, toolContext.session.id, {
            tool: INBOX_TOOL.POST,
            input: unparsedWire(input as WireBoundaryInput),
            sandbox: () => toolContext.getSandbox(),
          }),
      }),
  },
});
