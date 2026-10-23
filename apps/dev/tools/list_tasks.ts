import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { LIST_TASKS_TOOL } from "@luke/service/agents/coding-agent-tools";
import { agentToolFor } from "../host.js";

/**
 * list_tasks.ts -- the agent lists the open tasks of its workspace, to start an agent on one or narrow its list of agents to one.
 *
 * The planning model's own `list_tasks` too, one implementation for both
 * (`packages/service/src/agents/coding-agent-tools.ts`). The call reaches the
 * store through the host's door (`../host.ts`), under the agent its session
 * was admitted to.
 */
export default agentToolFor(CODER_TOOL.LIST_TASKS, LIST_TASKS_TOOL);
