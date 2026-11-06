import type { DescriptionActor } from "@repo/features/task-wire";
import { integer, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { agentTable } from "./agent.js";
import { user } from "./auth.js";
import { task } from "./task.js";

export const descriptionRevision = pgTable(
  "description_revision",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    actor: text("actor").$type<DescriptionActor>().notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    agentId: uuid("agent_id").references(() => agentTable.id, { onDelete: "set null" }),
    document: text("document").notNull(),
    changes: integer("changes").notNull(),
    startedAt: timestamptz("started_at").notNull(),
    at: timestamptz("at").notNull(),
    restoredFrom: integer("restored_from"),
  },
  (table) => [primaryKey({ columns: [table.taskId, table.seq] })],
);
