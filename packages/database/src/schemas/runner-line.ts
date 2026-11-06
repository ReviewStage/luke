import { sql } from "drizzle-orm";
import { bigint, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, timestamptz } from "./_helpers.js";
import { agentTable } from "./agent.js";
import { user } from "./auth.js";

export const runnerLine = pgTable(
  "runner_line",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agentTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity().notNull(),
    launch: bigint("launch", { mode: "number" }).notNull(),
    text: text("text").notNull(),
    lineId: uuid("line_id"),
    createdAt: createdAt(),
    acceptedAt: timestamptz("accepted_at"),
  },
  (table) => [
    index("runner_line_agent_seq").on(table.agentId, table.seq),
    uniqueIndex("runner_line_agent_line")
      .on(table.agentId, table.lineId)
      .where(sql`${table.lineId} is not null`),
  ],
);
