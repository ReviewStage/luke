/**
 * agent-name.ts -- the name an agent goes by, as a query reads it: Luke for
 * a member's operator, the human name it was given for any other agent,
 * and null for an agent from before names were given, as
 * `@luke/features/model-label`'s `agentGivenName` names one in code, so a
 * query and a window never name one agent two ways.
 */

import { CODING_AGENT_KIND } from "@luke/features/coding-agent-wire";
import { OPERATOR_NAME } from "@luke/features/model-label";
import { type SQL, type SQLWrapper, sql } from "drizzle-orm";

/** The columns of a coding agent's row, or of an alias of it, that name it. */
interface NamingColumns {
  readonly kind: SQLWrapper;
  readonly personaName: SQLWrapper;
}

/** The name the agent of `agent`'s row goes by, as above; null where the row is a left join's missing one. */
export function agentGivenNameSql(agent: NamingColumns): SQL<string | null> {
  return sql<
    string | null
  >`case when ${agent.kind} = ${CODING_AGENT_KIND.OPERATOR}::text then ${OPERATOR_NAME}::text else ${agent.personaName} end`;
}
