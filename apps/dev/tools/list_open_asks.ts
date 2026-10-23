import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { LIST_OPEN_ASKS_TOOL } from "@luke/service/agents/operator-desk";
import { defineDynamic } from "eve/tools";
import { agentToolFor, offeredKindTools } from "../host.js";

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
        ? agentToolFor(CODER_TOOL.LIST_OPEN_ASKS, LIST_OPEN_ASKS_TOOL)
        : null,
  },
});
