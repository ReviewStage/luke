/**
 * agent-owners.ts -- what an agent's owner is read from beside its own row: the automation its run belongs to, and whether an operator started it.
 *
 * An agent's row names its task and its run (`agent.automation_run_id`), and
 * the run's automation is read through the run, never from the agent's own
 * `automation_id`, which a run's child agent leaves null. An agent on no task
 * and no run is owned by Luke only where the operator started it
 * (`started_by_agent_id`), which the starter's row says.
 *
 * Note that these reads are keyed by ids alone, not an account, because a
 * teammate reads an agent's owner as they read who started it; the caller hands
 * them only the ids of agents it already read through their workspaces' gate,
 * and they answer an automation's id and a yes or no, nothing of either row.
 */

import { AGENT_KIND } from "@luke/features/agent-wire";
import { and, eq, inArray } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { automationRun } from "../schemas/automation.js";

/** The agents of a read an owner is read for: just what names the rows to look up. */
interface OwnedAgent {
  readonly taskId: string | null;
  readonly automationRunId: string | null;
  readonly startedByAgentId: string | null;
}

/** What the owners of a read's agents are read from, beside the agents' own rows. */
export interface AgentOwnerFacts {
  /** The automation each run belongs to, by the run's id. */
  readonly runAutomations: ReadonlyMap<string, string>;
  /** The operators among the agents that started the read's agents, by id. */
  readonly operatorStarters: ReadonlySet<string>;
}

/** No facts read: an agent owned by neither a run nor an operator's start reads as its row says. */
export const NO_AGENT_OWNER_FACTS: AgentOwnerFacts = {
  runAutomations: new Map(),
  operatorStarters: new Set(),
};

const findRunAutomations = SqlSchema.findAll({
  Request: Schema.Struct({ runIds: Schema.Array(Schema.String) }),
  Result: Schema.Struct({ id: Schema.String, automationId: Schema.String }),
  execute: ({ runIds }) =>
    Database.use((db) =>
      db
        .select({ id: automationRun.id, automationId: automationRun.automationId })
        .from(automationRun)
        .where(inArray(automationRun.id, [...runIds])),
    ),
});

const findOperators = SqlSchema.findAll({
  Request: Schema.Struct({ ids: Schema.Array(Schema.String) }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ ids }) =>
    Database.use((db) =>
      db
        .select({ id: agentTable.id })
        .from(agentTable)
        .where(and(inArray(agentTable.id, [...ids]), eq(agentTable.kind, AGENT_KIND.OPERATOR))),
    ),
});

/** The facts the owners of these agents are read from; none read for an agent on a task, which its task owns. */
export function agentOwnerFactsOf(
  agents: readonly OwnedAgent[],
): Effect.Effect<AgentOwnerFacts, StoreFailure, DatabaseServices> {
  const taskless = agents.filter((agent) => agent.taskId === null);
  const runIds = new Set(taskless.flatMap((agent) => agent.automationRunId ?? []));
  const starterIds = new Set(taskless.flatMap((agent) => agent.startedByAgentId ?? []));
  return Effect.gen(function* () {
    const runs = runIds.size === 0 ? [] : yield* findRunAutomations({ runIds: [...runIds] });
    const operators = starterIds.size === 0 ? [] : yield* findOperators({ ids: [...starterIds] });
    return {
      runAutomations: new Map(runs.map((run) => [run.id, run.automationId])),
      operatorStarters: new Set(operators.map((operator) => operator.id)),
    };
  });
}
