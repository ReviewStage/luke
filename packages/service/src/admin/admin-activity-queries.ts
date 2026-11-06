import { queryBuilder } from "@repo/database/core/query";
import { agentTable } from "@repo/database/schemas/agent";
import { descriptionRevision } from "@repo/database/schemas/description-revision";
import { task } from "@repo/database/schemas/task";
import { MEANINGFUL_ACTION, type MeaningfulAction } from "@repo/features/admin-overview-vocabulary";
import { DESCRIPTION_ACTOR } from "@repo/features/task-wire";
import { type AnyColumn, and, eq, gte, isNotNull, lt, type SQL, sql } from "drizzle-orm";
import { unionAll } from "drizzle-orm/pg-core";

export function utcDay(instant: SQL | SQL.Aliased): SQL<string> {
  return sql<string>`to_char(${instant} at time zone 'UTC', 'YYYY-MM-DD')`;
}

export function userIdOf(column: AnyColumn | SQL): SQL.Aliased<string> {
  return sql<string>`${column}`.as("user_id");
}

export function atOf(column: AnyColumn | SQL): SQL.Aliased<Date> {
  return sql<Date>`${column}`.as("at");
}

function kindOf(kind: MeaningfulAction): SQL.Aliased<MeaningfulAction> {
  return sql<MeaningfulAction>`${kind}::text`.as("kind");
}

export function within(column: AnyColumn, since: Date, until: Date | undefined) {
  return and(gte(column, since), until === undefined ? undefined : lt(column, until));
}

export function meaningfulActions(since: Date, until?: Date) {
  return unionAll(
    queryBuilder
      .select({
        userId: userIdOf(task.userId),
        at: atOf(task.createdAt),
        kind: kindOf(MEANINGFUL_ACTION.TASKS_CREATED),
      })
      .from(task)
      .where(within(task.createdAt, since, until)),
    queryBuilder
      .select({
        userId: userIdOf(descriptionRevision.userId),
        at: atOf(descriptionRevision.at),
        kind: kindOf(MEANINGFUL_ACTION.DESCRIPTION_REVISIONS),
      })
      .from(descriptionRevision)
      .where(
        and(
          eq(descriptionRevision.actor, DESCRIPTION_ACTOR.DEVELOPER),
          isNotNull(descriptionRevision.userId),
          within(descriptionRevision.at, since, until),
        ),
      ),
    queryBuilder
      .select({
        userId: userIdOf(agentTable.userId),
        at: atOf(agentTable.createdAt),
        kind: kindOf(MEANINGFUL_ACTION.AGENTS_STARTED),
      })
      .from(agentTable)
      .where(within(agentTable.createdAt, since, until)),
  ).as("meaningful_action");
}
