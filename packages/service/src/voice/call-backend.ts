import type { ToolSet } from "ai";
import { AGENT_TOOL, type AgentTool } from "../agents/agent-runtime/tools.js";
import { EVE_MOUNT, type EveMount } from "../agents/brain-host/eve-sessions.js";
import {
  CODER_TOOL_SET,
  type CoderOfferedTo,
  offeredCoderTools,
} from "../agents/coder-host/tool-set.js";

/**
 * call-backend.ts -- who answers a call's delegations: the agent the call speaks into.
 *
 * Every call names an agent and speaks into that agent's conversation, run
 * by the coding-agent deployment under `/eve/coder`. What the voice side
 * reads of it is read off here: the eve mount its spoken asks go to, every
 * tool the conversation's rows may name (which its journals are read and its
 * rows written under), and the tools the voice is told the agent holds,
 * those eve offers that agent (`offeredCoderTools`). A call explores nothing
 * as it starts, because an agent was started on its own work and a call
 * joins it there.
 */
export interface CallBackend {
  readonly mount: EveMount;
  readonly tools: ToolSet;
}

/** The agent's conversation, which every call speaks into. */
export const CALL_BACKEND = {
  mount: EVE_MOUNT.CODER,
  tools: CODER_TOOL_SET,
} as const satisfies CallBackend;

/**
 * The tools the voice is told the agent holds, in the registry's order:
 * those eve offers it, but `sleep`, which a spoken turn is told never to
 * call (`../agents/coder-host/turn-context.ts`), since speech never waits.
 */
export function backendToolsOf(agent: CoderOfferedTo, memoryOn: boolean): readonly AgentTool[] {
  return offeredCoderTools(agent, memoryOn).filter((tool) => tool !== AGENT_TOOL.SLEEP);
}
