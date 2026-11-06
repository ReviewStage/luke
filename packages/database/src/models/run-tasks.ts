import { AUTOMATION_TARGET } from "@repo/features/automation-wire";
import { and, eq, exists, type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { queryBuilder } from "../core/query.js";
import { automation, automationRun } from "../schemas/automation.js";

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
