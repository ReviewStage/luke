import { UPDATE_AUTOMATION_TOOL } from "@luke/service/agents/automation-tools";
import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { agentToolFor } from "../host.js";

/**
 * update_automation.ts -- the agent changes, pauses, or resumes an automation of its workspace.
 *
 * One implementation for every runtime
 * (`packages/service/src/agents/automation-tools.ts`). The call reaches the
 * store through the host's door (`../host.ts`), under the agent its session
 * was admitted to, and acts on the automations of its workspace as the
 * member who started it.
 */
export default agentToolFor(CODER_TOOL.UPDATE_AUTOMATION, UPDATE_AUTOMATION_TOOL);
