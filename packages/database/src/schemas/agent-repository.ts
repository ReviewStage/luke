import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { agentTable, type StoredPublishedRead, type StoredPullRequest } from "./agent.js";

export const agentRepository = pgTable(
  "agent_repository",
  {
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agentTable.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    repository: text("repository").notNull(),
    baseBranch: text("base_branch"),
    headBranch: text("head_branch"),
    published: jsonb("published").$type<StoredPullRequest>(),
    publishedRead: jsonb("published_read").$type<StoredPublishedRead>(),
  },
  (table) => [
    primaryKey({ columns: [table.agentId, table.position] }),
    index("agent_repository_on_head").on(sql`lower(${table.repository})`, table.headBranch),
    index("agent_repository_on_pull_request").on(
      sql`lower(${table.repository})`,
      sql`((${table.published}->>'number')::int)`,
    ),
  ],
);
