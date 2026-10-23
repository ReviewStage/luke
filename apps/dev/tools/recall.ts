import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { RECALL_TOOL } from "@luke/service/agents/memory-tools";
import { defineDynamic } from "eve/tools";
import { agentToolFor, memoryOffered } from "../host.js";

/**
 * recall.ts -- the agent searches its workspace's shared memory for what the workspace's agents kept.
 *
 * One implementation for every harness (`packages/service/src/agents/memory-tools.ts`),
 * reached through the host's door (`../host.ts`): the workspace and the member
 * whose words it keeps are read from the service's record of the agent, never
 * from the input.
 * It is offered at each turn's start only where the agent's starter turned
 * Memory on (`memoryOffered`).
 */
export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) =>
      (await memoryOffered(ctx.session.auth, ctx.session.id))
        ? agentToolFor(CODER_TOOL.RECALL, RECALL_TOOL)
        : null,
  },
});
