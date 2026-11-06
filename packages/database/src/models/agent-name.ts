import { type SQL, type SQLWrapper, sql } from "drizzle-orm";

export function agentAutomationNameSql(agent: {
  readonly automationOrigin: SQLWrapper;
}): SQL<string | null> {
  return sql<string | null>`${agent.automationOrigin} ->> 'name'`;
}

export function agentAutomationRunSql(agent: {
  readonly automationOrigin: SQLWrapper;
  readonly automationId: SQLWrapper;
}): SQL<boolean> {
  return sql<boolean>`(${agent.automationOrigin} is not null or ${agent.automationId} is not null)`;
}
