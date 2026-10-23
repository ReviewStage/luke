import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { LIST_AGENTS_TOOL } from "@luke/service/agents/coding-agent-tools";
import { agentToolFor } from "../host.js";

/**
 * list_agents.ts -- the agent lists the other coding agents of its workspace, on any task, each with its task, archived ones marked.
 *
 * The planning model's own `list_agents` too, one implementation for both
 * (`packages/service/src/agents/coding-agent-tools.ts`). The call reaches the
 * store through the host's door (`../host.ts`), under the agent its session
 * was admitted to.
 */
export default agentToolFor(CODER_TOOL.LIST_AGENTS, LIST_AGENTS_TOOL);
