/**
 * admin-activity-queries.ts -- the one definition of an account's meaningful
 * action, which every admin read that says "active" counts through.
 *
 * The Overview, the Users roster, the Account page, and the Day page each
 * read this union rather than a hosted-usage day: since the voice service
 * left, the hosted tier meters dictation alone, so an account working through
 * tasks and agents reads as idle there.
 */

import { queryBuilder } from "@repo/database/core/query";
import { agentTable } from "@repo/database/schemas/agent";
import { planRevision } from "@repo/database/schemas/plan-revision";
import { task } from "@repo/database/schemas/task";
import { PLAN_ACTOR } from "@repo/features/task-wire";
import { type AnyColumn, and, eq, gte, isNotNull, lt, type SQL, sql } from "drizzle-orm";
import { unionAll } from "drizzle-orm/pg-core";

/** The UTC day an instant falls on, as the YYYY-MM-DD key the builders zero-fill by. */
export function utcDay(instant: SQL | SQL.Aliased): SQL<string> {
  return sql<string>`to_char(${instant} at time zone 'UTC', 'YYYY-MM-DD')`;
}

/** The account a union's row is attributed to, under the one name every member selects it as. */
export function userIdOf(column: AnyColumn | SQL): SQL.Aliased<string> {
  return sql<string>`${column}`.as("user_id");
}

/** The instant a union's row is dated by, under the one name every member selects it as. */
export function atOf(column: AnyColumn | SQL): SQL.Aliased<Date> {
  return sql<Date>`${column}`.as("at");
}

/**
 * A union arm's bound on the instant it is dated by: from `since`, and before
 * `until` where one is given, so a read of one UTC day scans that day alone.
 */
export function within(column: AnyColumn, since: Date, until: Date | undefined) {
  return and(gte(column, since), until === undefined ? undefined : lt(column, until));
}

/**
 * Every meaningful action since `since`, one row per action: the account that
 * took it and when. This is the one definition of "active" on the admin
 * dashboard: the Overview's active-developer tiles, feature reach's base, the
 * most active accounts, and the meaningful retention grid, and the roster's
 * active days and ranking, all count through it. A plan revision counts only
 * as the developer's own, under their user id; the app's notes are the app's,
 * and an agent's revisions are the agent. `until`, where given, ends the
 * span, as the Day page's one UTC day does.
 */
export function meaningfulActions(since: Date, until?: Date) {
  return unionAll(
    queryBuilder
      .select({ userId: userIdOf(task.userId), at: atOf(task.createdAt) })
      .from(task)
      .where(within(task.createdAt, since, until)),
    queryBuilder
      .select({ userId: userIdOf(planRevision.userId), at: atOf(planRevision.at) })
      .from(planRevision)
      .where(
        and(
          eq(planRevision.actor, PLAN_ACTOR.DEVELOPER),
          isNotNull(planRevision.userId),
          within(planRevision.at, since, until),
        ),
      ),
    queryBuilder
      .select({ userId: userIdOf(agentTable.userId), at: atOf(agentTable.createdAt) })
      .from(agentTable)
      .where(within(agentTable.createdAt, since, until)),
  ).as("meaningful_action");
}
