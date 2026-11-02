/**
 * agent-name.ts -- what names an agent apart from its title, as a query
 * reads it: the name of the automation whose run started it, which
 * `@luke/features/model-label`'s `agentName` names one by until it has a
 * title, and whether such a run started it, so a query and a window never
 * name or sort one agent two ways.
 */

import { type SQL, type SQLWrapper, sql } from "drizzle-orm";

/** The name of the automation whose run started the agent of `agent`'s row, as the run kept it; null for one started by hand. */
export function agentAutomationNameSql(agent: {
  readonly automationOrigin: SQLWrapper;
}): SQL<string | null> {
  return sql<string | null>`${agent.automationOrigin} ->> 'name'`;
}

/**
 * Whether an automation's run started the agent of `agent`'s row, as
 * `@luke/features/model-label`'s `automationRun` answers in code: by the run's
 * origin, which outlives the automation, whose `automation_id` goes null once
 * it is deleted.
 */
export function agentAutomationRunSql(agent: {
  readonly automationOrigin: SQLWrapper;
  readonly automationId: SQLWrapper;
}): SQL<boolean> {
  // The id covers agents from before the origin column, which name no run.
  return sql<boolean>`(${agent.automationOrigin} is not null or ${agent.automationId} is not null)`;
}
