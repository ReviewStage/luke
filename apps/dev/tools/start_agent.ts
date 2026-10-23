import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { START_AGENT_TOOL } from "@luke/service/agents/coding-agent-tools";
import { agentToolFor } from "../host.js";

/**
 * start_agent.ts -- the agent starts a new coding agent on its own task or another of its workspace, as the Start button would.
 *
 * The planning model's own `start_agent` too, one implementation for both
 * (`packages/service/src/agents/coding-agent-tools.ts`). The call reaches the
 * Start path through the host's door (`../host.ts`), under eve's id for the
 * call, so a call run again starts no second agent, and the agent it starts
 * is told which agent started it and how to report back. An agent on no
 * task names the task by its id (`list_tasks`).
 */
export default agentToolFor(CODER_TOOL.START_AGENT, START_AGENT_TOOL);
