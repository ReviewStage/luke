import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { READ_TASK_TOOL } from "@luke/service/agents/task-tools";
import { agentToolFor } from "../host.js";

/**
 * read_task.ts -- the agent reads one task of its workspace by its id, its plan included.
 *
 * The planning model's own `read_task` too, one implementation for both
 * (`packages/service/src/agents/task-tools.ts`). The call reaches the store
 * through the host's door (`../host.ts`), under the agent its session was
 * admitted to, and reads as the member who started it.
 */
export default agentToolFor(CODER_TOOL.READ_TASK, READ_TASK_TOOL);
