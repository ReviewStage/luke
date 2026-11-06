import { and, asc, eq } from "drizzle-orm";
import { type Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { automation, automationRun } from "../schemas/automation.js";
import { automationReadableBy } from "./automation-store.js";
import { InstantColumnSchema } from "./columns.js";

type RunAgentsEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

const RunAgentSchema = Schema.Struct({
  id: Schema.String,
  conversationId: Schema.String,
  title: Schema.NullOr(Schema.String),
  createdAt: InstantColumnSchema,
});

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
          title: agentTable.title,
          createdAt: agentTable.createdAt,
        })
        .from(agentTable)
        .innerJoin(automationRun, eq(automationRun.id, agentTable.automationRunId))
        .innerJoin(automation, eq(automation.id, automationRun.automationId))
        .where(and(eq(agentTable.automationRunId, runId), automationReadableBy(userId)))
        .orderBy(asc(agentTable.createdAt), asc(agentTable.id)),
    ),
});

export function readRunAgents(userId: string, runId: string): RunAgentsEffect<readonly RunAgent[]> {
  return findRunAgents({ userId, runId });
}
