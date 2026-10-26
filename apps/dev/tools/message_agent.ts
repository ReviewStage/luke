import { MESSAGE_AGENT_TOOL } from "@luke/service/agents/coder-host/agent-message";
import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import { agentToolFor } from "../host.js";

/**
 * message_agent.ts -- the agent sends another coding agent of its workspace a message, shown in the two agents' transcripts alone.
 *
 * The call reaches the other agent through the host's door (`../host.ts`)
 * on the one path every line steered into an agent takes, under eve's id for the call, so a
 * call run again sends once; it answers once the other agent's session took
 * the message, never waiting for its reply
 * (`packages/service/src/agents/coder-host/agent-message.ts`).
 */
export default agentToolFor(CODER_TOOL.MESSAGE_AGENT, MESSAGE_AGENT_TOOL);
