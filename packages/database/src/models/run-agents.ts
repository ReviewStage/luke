/**
 * run-agents.ts -- the agents an automation's run made, read for an account that may read the run's automation.
 *
 * An agent names the run it belongs to (`agent.automation_run_id`): the run
 * that started it, or the run whose agent started it, so a run reads every
 * agent it made rather than the one `automation_run.agent_id` keeps. The
 * read is gated as the run's history is (`automation-store.ts`'s
 * `automationReadableBy`): an account that may not read the automation,
 * or is no longer a member of its workspace, reads none of its runs'
 * agents.
 */

import { and, asc, eq, sql } from "drizzle-orm";
import { type Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { automation, automationRun } from "../schemas/automation.js";
import { agentGivenNameSql } from "./agent-name.js";
import { automationReadableBy } from "./automation-store.js";
import { InstantColumnSchema } from "./columns.js";

type RunAgentsEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

const RunAgentSchema = Schema.Struct({
  id: Schema.String,
  conversationId: Schema.String,
  title: Schema.NullOr(Schema.String),
  createdAt: InstantColumnSchema,
});

/** One agent a run made: its id, its conversation, the name it goes by, and when it was started. */
export type RunAgent = typeof RunAgentSchema.Type;

const findRunAgents = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, runId: Schema.String }),
  Result: RunAgentSchema,
  execute: ({ userId, runId }) =>
    Database.use((db) =>
      db
        .select({
          id: agentTable.id,
          conversationId: agentTable.conversationId,
          // The name the agent goes by: Luke for an operator, else its title.
          title: sql<
            string | null
          >`coalesce(${agentGivenNameSql(agentTable)}, ${agentTable.title})`,
          createdAt: agentTable.createdAt,
        })
        .from(agentTable)
        .innerJoin(automationRun, eq(automationRun.id, agentTable.automationRunId))
        .innerJoin(automation, eq(automation.id, automationRun.automationId))
        .where(and(eq(agentTable.automationRunId, runId), automationReadableBy(userId)))
        .orderBy(asc(agentTable.createdAt), asc(agentTable.id)),
    ),
});

/** The agents the run made, in the order they were started; none for a run the account may not read. */
export function readRunAgents(userId: string, runId: string): RunAgentsEffect<readonly RunAgent[]> {
  return findRunAgents({ userId, runId });
}
