/**
 * agent-owners.ts -- what an agent's owner is read from beside its own row: the automation its run belongs to.
 *
 * An agent's row names its task and its run (`agent.automation_run_id`), and
 * the run's automation is read through the run, never from the agent's own
 * `automation_id`, which a run's child agent leaves null.
 *
 * Note that these reads are keyed by ids alone, not an account, because a
 * teammate reads an agent's owner as they read who started it; the caller hands
 * them only the ids of agents it already read through their workspaces' gate,
 * and they answer an automation's id, nothing of either row.
 */

import { inArray } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { automationRun } from "../schemas/automation.js";

/** The agents of a read an owner is read for: just what names the rows to look up. */
interface OwnedAgent {
  readonly taskId: string | null;
  readonly automationRunId: string | null;
}

/** What the owners of a read's agents are read from, beside the agents' own rows. */
export interface AgentOwnerFacts {
  /** The automation each run belongs to, by the run's id. */
  readonly runAutomations: ReadonlyMap<string, string>;
}

/** No facts read: an agent owned by no run reads as its row says. */
export const NO_AGENT_OWNER_FACTS: AgentOwnerFacts = {
  runAutomations: new Map(),
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

/** The facts the owners of these agents are read from; none read for an agent on a task, which its task owns. */
export function agentOwnerFactsOf(
  agents: readonly OwnedAgent[],
): Effect.Effect<AgentOwnerFacts, StoreFailure, DatabaseServices> {
  const taskless = agents.filter((agent) => agent.taskId === null);
  const runIds = new Set(taskless.flatMap((agent) => agent.automationRunId ?? []));
  return Effect.gen(function* () {
    const runs = runIds.size === 0 ? [] : yield* findRunAutomations({ runIds: [...runIds] });
    return { runAutomations: new Map(runs.map((run) => [run.id, run.automationId])) };
  });
}
