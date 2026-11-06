/**
 * gates.ts -- what opens each of our narrowed tools to an agent, declared once, and where an agent stands against them.
 *
 * A tool of the catalog (`catalog.ts`) is offered every agent, or stands
 * behind one gate: the agent's repository, the sandbox of ours it runs in,
 * its starter's Memory, or its starter's Task descriptions. Each gate is
 * declared here once, with how it is read off the agent and the words a
 * call it shuts would be refused with, so the list an agent is offered and
 * a refusal of a call it makes anyway read the same rule. An agent's
 * standing is the gates open to it, read once per list; an agent whose row
 * is gone has every gate shut, since no gated tool's door would carry out a
 * call for an agent that no longer stands.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import {
  type Agent,
  type AgentStoreEffect,
  hasRepository,
  readAgentOfConversation,
} from "@repo/database/models/agent-store";
import { AGENT_MACHINE } from "@repo/features/agent-wire";
import { Effect, Option } from "effect";
import { CODER_REFUSAL } from "../coder-host/bounds.js";
import { DESCRIPTION_EDIT_REFUSAL } from "../coder-host/description-edit.js";
import { descriptionsOnFor } from "../descriptions-on.js";
import type { AdmittedConversation } from "../eve-host/conversation.js";
import { MEMORY_REFUSAL, memoryOnFor } from "../memory-tools.js";

/** The gates a tool may stand behind; each tool stands behind one at most. */
export const TOOL_GATE = {
  /** The agent works in a repository: a checkout to open a pull request from. */
  REPOSITORY: "repository",
  /** The agent runs in a sandbox of ours rather than on the developer's own machine. */
  SANDBOX: "sandbox",
  /** The agent's starter has Memory on. */
  MEMORY: "memory",
  /** The agent's starter has Task descriptions on, or Pilot for a pilot. */
  DESCRIPTIONS: "descriptions",
} as const;

export type ToolGate = (typeof TOOL_GATE)[keyof typeof TOOL_GATE];

/** One gate: whether it opens to an agent, and the words a call it shuts is refused with. */
interface Gate {
  readonly opens: (agent: Agent) => Effect.Effect<boolean, never, DatabaseServices>;
  readonly refusal: string;
}

/**
 * Each gate as it is read and refused. Note that `SANDBOX` shuts on a
 * device alone, because a local agent's Mac runs no browser of ours, and it
 * already runs on one of the developer's own machines, where `run_on_mac`
 * would only reach itself. The refusals are each gate's door's own words,
 * but `SANDBOX`'s, which no door says today.
 */
const GATES: { readonly [G in ToolGate]: Gate } = {
  [TOOL_GATE.REPOSITORY]: {
    opens: (agent) => Effect.succeed(hasRepository(agent)),
    refusal: CODER_REFUSAL.NO_REPOSITORY,
  },
  [TOOL_GATE.SANDBOX]: {
    opens: (agent) => Effect.succeed(agent.machine !== AGENT_MACHINE.DEVICE),
    refusal:
      "Not run: you run on the developer's own machine, where this tool is not offered; do it from your shell instead.",
  },
  [TOOL_GATE.MEMORY]: {
    opens: (agent) => memoryOnFor(agent.userId),
    refusal: MEMORY_REFUSAL.OFF,
  },
  [TOOL_GATE.DESCRIPTIONS]: {
    opens: (agent) => descriptionsOnFor(agent.userId, agent.kind),
    refusal: DESCRIPTION_EDIT_REFUSAL.OFF,
  },
};

/** Where an agent stands against the gates: its row, where it still stands, and the gates open to it. */
export interface AgentStanding {
  readonly agent: Option.Option<Agent>;
  readonly open: ReadonlySet<ToolGate>;
}

/** The standing of an agent's row, or of none, whose every gate is shut. */
export function standingOfAgent(
  agent: Option.Option<Agent>,
): Effect.Effect<AgentStanding, never, DatabaseServices> {
  if (Option.isNone(agent)) return Effect.succeed({ agent, open: new Set() });
  const gates = Object.values(TOOL_GATE);
  return Effect.map(
    Effect.forEach(gates, (gate) => GATES[gate].opens(agent.value)),
    (opened) => ({ agent, open: new Set(gates.filter((_, index) => opened[index])) }),
  );
}

/** The standing of the agent whose conversation the call was admitted to. */
export function standingOf(admitted: AdmittedConversation): AgentStoreEffect<AgentStanding> {
  const { userId, conversationId } = admitted.target;
  return Effect.flatMap(readAgentOfConversation(userId, conversationId), standingOfAgent);
}
