import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { CODER_READ_AGENT_TOOL } from "@luke/service/agents/coding-agent-tools";
import { agentToolFor } from "../host.js";

/**
 * read_agent.ts -- the agent reads another coding agent of its workspace: where it stands, what it published, and the tail of its transcript.
 *
 * The planning model's own `read_agent` too, one implementation for both
 * (`packages/service/src/agents/coding-agent-tools.ts`), in words of its own
 * and with a longer tail it may ask for. The call reaches the store through
 * the host's door (`../host.ts`) on the standing of the member who started
 * this agent, and finds an agent of its workspace alone.
 */
export default agentToolFor(CODER_TOOL.READ_AGENT, CODER_READ_AGENT_TOOL);
