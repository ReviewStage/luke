import type { ToolSet } from "ai";
import { AGENT_ROLE, type AgentRole } from "../agents/agent-runtime/role.js";
import { toolsOf } from "../agents/agent-runtime/tools.js";
import { EVE_MOUNT, type EveMount } from "../agents/brain-host/eve-sessions.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";

/**
 * call-backend.ts -- who answers a call's delegations: the agent the call speaks into.
 *
 * Every call names an agent and speaks into that agent's conversation, run
 * by the coding-agent deployment under `/eve/coder`. What the voice side
 * reads of it is read off here: the eve mount its spoken asks go to, every
 * tool the conversation's rows may name (which its journals are read and its
 * rows written under), and the role whose tools the voice is told the agent
 * holds (`agent-runtime/tools.ts`). A call explores nothing as it starts,
 * because an agent was started on its own work and a call joins it there.
 */
export interface CallBackend {
  readonly mount: EveMount;
  readonly tools: ToolSet;
  readonly role: AgentRole;
}

/** The agent's conversation, which every call speaks into. */
export const CALL_BACKEND = {
  mount: EVE_MOUNT.CODER,
  tools: CODER_TOOL_SET,
  role: AGENT_ROLE.CODER,
} as const satisfies CallBackend;

/** The tools the voice is told its backend holds, in the registry's order. */
export function backendToolsOf(backend: CallBackend): readonly string[] {
  return [...toolsOf(backend.role)];
}
