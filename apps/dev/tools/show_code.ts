import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { SHOW_CODE_TOOL } from "@luke/service/tasks/show-code";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineDynamic, defineTool } from "eve/tools";
import { offeredRepositoryTools, runShowCodeTool } from "../host.js";

/**
 * show_code.ts -- the agent puts lines of its checkout on the developer's screen, in the task's Code tab.
 *
 * The brain's tool too, one implementation for both
 * (`packages/service/src/tasks/show-code.ts`). The call reaches the host's
 * door (`../host.ts`) and reads its lines from the checkout the session's
 * sandbox opened with, through the same door eve hands every file tool, so
 * a shallow checkout serves it and nothing is deepened. Its answer is
 * journaled with the call on the agent's own conversation, on any kind of
 * turn: on a spoken one the voice's follow carries it to the Mac as the
 * agent next speaks, and on a typed one it stands on the record for the
 * Code tab. It is offered at each turn's start only to an agent with a
 * repository (`repositoryToolsOf`).
 */
export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) =>
      (await offeredRepositoryTools(ctx.session.auth, ctx.session.id)).has(CODER_TOOL.SHOW_CODE)
        ? defineTool({
            description: SHOW_CODE_TOOL.description,
            inputSchema: emitJsonSchema(SHOW_CODE_TOOL.inputSchema),
            execute: async (input, toolContext) =>
              // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
              runShowCodeTool(
                toolContext.session.auth,
                toolContext.session.id,
                unparsedWire(input as WireBoundaryInput),
                () => toolContext.getSandbox(),
              ),
          })
        : null,
  },
});
