import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { CREATE_TASK_TOOL } from "@luke/service/agents/task-tools";
import { agentToolFor } from "../host.js";

/**
 * create_task.ts -- the agent makes a task in its workspace, for the member who started it, with no agent on it.
 *
 * The planning model's own `create_task` too, one implementation for both
 * (`packages/service/src/agents/task-tools.ts`). The call reaches the store
 * and GitHub through the host's door (`../host.ts`), under the agent its
 * session was admitted to, and makes the task as the member who started it,
 * once under the call's key.
 */
export default agentToolFor(CODER_TOOL.CREATE_TASK, CREATE_TASK_TOOL);
