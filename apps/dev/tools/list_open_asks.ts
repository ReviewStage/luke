import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { LIST_OPEN_ASKS_TOOL } from "@luke/service/agents/operator-desk";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { defineDynamic, defineTool } from "eve/tools";
import { offeredKindTools, runAgentTool } from "../host.js";

/**
 * list_open_asks.ts -- the operator lists every thread waiting on its member in their inbox, across all their own agents.
 *
 * It only reads (`packages/service/src/agents/operator-desk.ts`). The call
 * reaches the store through the host's door (`../host.ts`), under the agent
 * its session was admitted to, and is offered at each turn's start to the
 * member's operator alone (`kindToolsOf`).
 */
export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) =>
      (await offeredKindTools(ctx.session.auth, ctx.session.id)).has(CODER_TOOL.LIST_OPEN_ASKS)
        ? defineTool({
            description: LIST_OPEN_ASKS_TOOL.description,
            inputSchema: emitJsonSchema(LIST_OPEN_ASKS_TOOL.inputSchema),
            execute: async (input, toolContext) =>
              // SAFETY: eve hands a tool the JSON object the model emitted; the host parses it as wire input.
              runAgentTool(toolContext.session.auth, toolContext.session.id, {
                tool: CODER_TOOL.LIST_OPEN_ASKS,
                input: unparsedWire(input as WireBoundaryInput),
                callId: toolContext.callId,
              }),
          })
        : null,
  },
});
