/**
 * agent-name.ts -- what names an agent apart from its title, as a query
 * reads it: Luke for a member's operator and null for any other agent, as
 * `@luke/features/model-label`'s `agentGivenName` names one in code, and
 * the name of the automation whose run started it, which `agentName` names
 * one by until it has a title, so a query and a window never name one agent
 * two ways.
 */

import { CODING_AGENT_KIND } from "@luke/features/coding-agent-wire";
import { OPERATOR_NAME } from "@luke/features/model-label";
import { type SQL, type SQLWrapper, sql } from "drizzle-orm";

/** The column of a coding agent's row, or of an alias of it, that names it apart from its title. */
interface NamingColumns {
  readonly kind: SQLWrapper;
}

/** The name the agent of `agent`'s row goes by, as above; null where the row is a left join's missing one. */
export function agentGivenNameSql(agent: NamingColumns): SQL<string | null> {
  return sql<
    string | null
  >`case when ${agent.kind} = ${CODING_AGENT_KIND.OPERATOR}::text then ${OPERATOR_NAME}::text else null end`;
}

/** The name of the automation whose run started the agent of `agent`'s row, as the run kept it; null for one started by hand. */
export function agentAutomationNameSql(agent: {
  readonly automationOrigin: SQLWrapper;
}): SQL<string | null> {
  return sql<string | null>`${agent.automationOrigin} ->> 'name'`;
}
