import { RUN_AUTOMATION_TOOL } from "@luke/service/agents/automation-tools";
import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { agentToolFor } from "../host.js";

/**
 * run_automation.ts -- the agent runs an automation of its workspace now, as its Run now would.
 *
 * One implementation for every runtime
 * (`packages/service/src/agents/automation-tools.ts`). The call reaches the
 * store through the host's door (`../host.ts`), under the agent its session
 * was admitted to, and acts on the automations of its workspace as the
 * member who started it.
 */
export default agentToolFor(CODER_TOOL.RUN_AUTOMATION, RUN_AUTOMATION_TOOL);
