/**
 * gates.ts -- what opens each of our narrowed tools to an agent, declared once, and where an agent stands against them.
 *
 * A tool of the catalog (`catalog.ts`) is offered every agent, or stands
 * behind one gate: the agent's repository, the sandbox of ours it runs in,
 * its workspace's Memory, or its workspace's Task descriptions. Each gate is
 * declared here once, with how it is read off the agent and the words a
 * call it shuts would be refused with, so the list an agent is offered and
 * a refusal of a call it makes anyway read the same rule. An agent's
 * standing is the gates open to it and its workspace's experiments, which
 * word the tools it is listed, read once per list or call; an agent whose
 * row is gone has every gate shut and every experiment off, since no gated
 * tool's door would carry out a call for an agent that no longer stands.
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
import type { AdmittedConversation } from "../eve-host/conversation.js";
import {
  EXPERIMENT_OFF_REFUSAL,
  type ExperimentsOn,
  experimentsOnIn,
  NO_EXPERIMENT_ON,
} from "../workspace-experiment-on.js";

/** The gates a tool may stand behind; each tool stands behind one at most. */
export const TOOL_GATE = {
  /** The agent works in a repository: a checkout to open a pull request from. */
  REPOSITORY: "repository",
  /** The agent runs in a sandbox of ours rather than on the developer's own machine. */
  SANDBOX: "sandbox",
  /** The agent's workspace has Memory on. */
  MEMORY: "memory",
  /** The agent's workspace has Task descriptions on. */
  DESCRIPTIONS: "descriptions",
} as const;

export type ToolGate = (typeof TOOL_GATE)[keyof typeof TOOL_GATE];

/** One gate: whether it opens to an agent, given its workspace's experiments, and the words a call it shuts is refused with. */
interface Gate {
  readonly opens: (agent: Agent, experiments: ExperimentsOn) => boolean;
  readonly refusal: string;
}

/**
 * Each gate as it is read and refused. Note that `SANDBOX` shuts on a
 * device alone, because a local agent's Mac runs no browser of ours, and it
 * already runs on one of the developer's own machines, where `run_on_mac`
 * would only reach itself. The refusals are the words each gate's doors
 * refused with before the catalog refused for them (`catalog.ts`'s
 * `callTool`), but `SANDBOX`'s, which no door said, and an experiment's,
 * which names none (`EXPERIMENT_OFF_REFUSAL`); a tool whose door answered
 * otherwise words its own (`CatalogTool`'s `refused`).
 */
export const GATES: { readonly [G in ToolGate]: Gate } = {
  [TOOL_GATE.REPOSITORY]: {
    opens: (agent) => hasRepository(agent),
    refusal: CODER_REFUSAL.NO_REPOSITORY,
  },
  [TOOL_GATE.SANDBOX]: {
    opens: (agent) => agent.machine !== AGENT_MACHINE.DEVICE,
    refusal:
      "Not run: you run on the developer's own machine, where this tool is not offered; do it from your shell instead.",
  },
  [TOOL_GATE.MEMORY]: {
    opens: (_agent, experiments) => experiments.memoryOn,
    refusal: EXPERIMENT_OFF_REFUSAL,
  },
  [TOOL_GATE.DESCRIPTIONS]: {
    opens: (_agent, experiments) => experiments.descriptionsOn,
    refusal: EXPERIMENT_OFF_REFUSAL,
  },
};

/** Where an agent stands against the gates: its row, where it still stands, the gates open to it, and its workspace's experiments, which word the tools it is listed. */
export interface AgentStanding {
  readonly agent: Option.Option<Agent>;
  readonly open: ReadonlySet<ToolGate>;
  readonly experiments: ExperimentsOn;
}

/** The standing of an agent's row, its workspace's experiments read once, or of none, whose every gate is shut and every experiment off. */
export function standingOfAgent(
  agent: Option.Option<Agent>,
): Effect.Effect<AgentStanding, never, DatabaseServices> {
  if (Option.isNone(agent)) {
    return Effect.succeed({ agent, open: new Set(), experiments: NO_EXPERIMENT_ON });
  }
  return Effect.map(experimentsOnIn(agent.value.organizationId), (experiments) => ({
    agent,
    open: new Set(
      Object.values(TOOL_GATE).filter((gate) => GATES[gate].opens(agent.value, experiments)),
    ),
    experiments,
  }));
}

/** The standing of the agent whose conversation the call was admitted to. */
export function standingOf(admitted: AdmittedConversation): AgentStoreEffect<AgentStanding> {
  const { userId, conversationId } = admitted.target;
  return Effect.flatMap(readAgentOfConversation(userId, conversationId), standingOfAgent);
}
