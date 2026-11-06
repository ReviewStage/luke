import { inArray } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { automationRun } from "../schemas/automation.js";

interface OwnedAgent {
  readonly taskId: string | null;
  readonly automationRunId: string | null;
}

export interface AgentOwnerFacts {
  readonly runAutomations: ReadonlyMap<string, string>;
}

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
