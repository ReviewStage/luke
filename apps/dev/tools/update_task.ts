import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { UPDATE_TASK_TOOL } from "@luke/service/agents/coding-agent-tools";
import { agentToolFor } from "../host.js";

/**
 * update_task.ts -- the agent changes a task of its workspace on behalf of the member who started it: its name, repository, pin, or where it stands.
 *
 * The planning model's own `update_task` too, one implementation for both
 * (`packages/service/src/agents/coding-agent-tools.ts`). The call reaches the
 * store through the host's door (`../host.ts`) on the rule the developer's
 * own task menu keeps, for the member who started this agent, and a status
 * change stops no agent, as the menu's stops none; a change already standing
 * answers as done, so a call run again changes nothing.
 */
export default agentToolFor(CODER_TOOL.UPDATE_TASK, UPDATE_TASK_TOOL);
