import { DELETE_AUTOMATION_TOOL } from "@luke/service/agents/automation-tools";
import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { defineDynamic } from "eve/tools";
import { agentToolFor, offeredKindTools } from "../host.js";

/**
 * delete_automation.ts -- the agent deletes an automation of its workspace with its history of runs.
 *
 * One implementation for every runtime
 * (`packages/service/src/agents/automation-tools.ts`). The call reaches the
 * store through the host's door (`../host.ts`), under the agent its session
 * was admitted to, and acts on the automations of its workspace as the
 * member who started it. It is offered at each turn's start to every agent
 * but its member's operator, which deletes nothing (`kindToolsOf`).
 */
export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) =>
      (await offeredKindTools(ctx.session.auth, ctx.session.id)).has(CODER_TOOL.DELETE_AUTOMATION)
        ? agentToolFor(CODER_TOOL.DELETE_AUTOMATION, DELETE_AUTOMATION_TOOL)
        : null,
  },
});
