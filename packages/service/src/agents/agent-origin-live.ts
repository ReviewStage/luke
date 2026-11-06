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

export interface AgentOriginLiveStatements {
  readonly origin: LiveStatement;
}

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

export function agentOriginLiveStatements(
  userId: string,
  agentId: string,
): Option.Option<AgentOriginLiveStatements> {
  return Option.map(liveStatementOf(originStatement(userId, agentId)), (origin) => ({ origin }));
}
