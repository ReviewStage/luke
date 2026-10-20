import type { ToolSet } from "ai";
import { AGENT_ROLE, type AgentRole } from "../agents/agent-runtime/role.js";
import { toolsOf } from "../agents/agent-runtime/tools.js";
import { BRAIN_EXPLORE_ASK } from "../agents/brain-host/brain.js";
import { EVE_MOUNT, type EveMount } from "../agents/brain-host/eve-sessions.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import { HOSTED_TOOL_SET } from "../tasks/brain-tool-set.js";

/**
 * call-backend.ts -- who answers a call's delegations: the task's brain, or one agent of the task.
 *
 * A call about a task alone speaks into the task's own conversation, run by
 * the brain under eve's `/eve` mount; a call that names an agent speaks into
 * that agent's conversation, run by the coding-agent deployment under
 * `/eve/coder`. Everything the voice side does differently for the two is
 * read off here, so no module past the session's opening asks which it is:
 * the eve mount its spoken asks go to, every tool the conversation's rows may
 * name (which its journals are read and its rows written under), the ask a
 * fresh call sets the backend exploring with, and the role whose tools the
 * voice is told the backend holds (`agent-runtime/tools.ts`).
 */
export interface CallBackend {
  readonly mount: EveMount;
  readonly tools: ToolSet;
  /** The ask the call's first ask in a conversation explores with; none for a backend that is already at work. */
  readonly explore: string | undefined;
  readonly role: AgentRole;
}

export const CALL_BACKEND = {
  /** The task's own conversation, the brain's, which a plan's first call sets exploring. */
  TASK: {
    mount: EVE_MOUNT.TASKS,
    tools: HOSTED_TOOL_SET,
    explore: BRAIN_EXPLORE_ASK,
    role: AGENT_ROLE.BRAIN,
  },
  /**
   * An agent's conversation. Note that it explores nothing as a call starts,
   * because an agent was started on its own work and a call joins it there.
   */
  AGENT: {
    mount: EVE_MOUNT.CODER,
    tools: CODER_TOOL_SET,
    explore: undefined,
    role: AGENT_ROLE.CODER,
  },
} as const satisfies Record<string, CallBackend>;

/** The backend a call is answered by: the agent's where it names one, the task's otherwise. */
export function callBackendOf(agentId: string | undefined): CallBackend {
  return agentId === undefined ? CALL_BACKEND.TASK : CALL_BACKEND.AGENT;
}

/** The tools the voice is told its backend holds, in the registry's order. */
export function backendToolsOf(backend: CallBackend): readonly string[] {
  return [...toolsOf(backend.role)];
}
