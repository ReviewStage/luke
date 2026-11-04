/**
 * run-tasks.ts -- whether a task is one an automation's run made for itself alone.
 *
 * A run of an automation that starts a new agent each run makes a task of
 * its own and names it (`automation_run.task_id`). A same-agent automation's
 * runs name their agent's standing task too, which is every run's and no
 * one run's, so it is not one; nor is any task a member or an agent made.
 * The task's finish (`task-finish.ts`) and the task list (`task-store.ts`,
 * `task-list-live.ts`) read it by this one rule.
 */

import { AUTOMATION_TARGET } from "@repo/features/automation-wire";
import { and, eq, exists, type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { queryBuilder } from "../core/query.js";
import { automation, automationRun } from "../schemas/automation.js";

/** Whether a run of a new-agent automation made the task whose id stands in `taskId`. */
export function taskMadeByRun(taskId: PgColumn | SQL): SQL {
  return exists(
    queryBuilder
      .select({ one: sql`1` })
      .from(automationRun)
      .innerJoin(automation, eq(automation.id, automationRun.automationId))
      .where(
        and(
          eq(automationRun.taskId, taskId),
          eq(automation.targetKind, AUTOMATION_TARGET.NEW_AGENT),
        ),
      ),
  );
}
