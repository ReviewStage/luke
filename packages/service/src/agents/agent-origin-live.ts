import {
  type LiveStatement,
  liveSelection,
  liveStatementOf,
} from "@repo/database/core/live-statement";
import { queryBuilder } from "@repo/database/core/query";
import { agentVisibleTo } from "@repo/database/models/workspace-store";
import { agentTable } from "@repo/database/schemas/agent";
import { user } from "@repo/database/schemas/auth";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { Option } from "effect";

/**
 * agent-origin-live.ts -- the run of an automation that started one coding agent, written for Neon Realtime, so the agent's page holds it while it stands rather than reading the agent whole on every visit.
 *
 * The statement reads what the agent's page reads of its origin
 * (`status.ts`'s `agentPage`): the run as the agent's row kept it, and the
 * name of the member who asked for a run now as their account names them
 * now, under the agent's own rule of who may read it (`agentVisibleTo`), so
 * an agent the account does not reach, or one no run started, is no rows.
 * Each column is under the key `@repo/features/agent-origin-live` reads it
 * by. It reads no clock, as Realtime requires.
 */

/** The statement one agent's origin is followed by. */
export interface AgentOriginLiveStatements {
  readonly origin: LiveStatement;
}

/** The agent's origin as its row keeps it, with the name of the member a "Run now" names, where one does and their account stands. */
function originStatement(userId: string, agentId: string) {
  return queryBuilder
    .select(
      liveSelection({
        origin: agentTable.automationOrigin,
        runnerName: user.name,
      }),
    )
    .from(agentTable)
    .leftJoin(user, eq(user.id, sql`${agentTable.automationOrigin} -> 'firing' ->> 'userId'`))
    .where(
      and(
        eq(agentTable.id, agentId),
        isNotNull(agentTable.automationOrigin),
        agentVisibleTo(userId),
      ),
    );
}

/** The agent's origin written for Realtime; none where the statement names a value Realtime cannot carry. */
export function agentOriginLiveStatements(
  userId: string,
  agentId: string,
): Option.Option<AgentOriginLiveStatements> {
  return Option.map(liveStatementOf(originStatement(userId, agentId)), (origin) => ({ origin }));
}
