import { sql } from "drizzle-orm";
import { pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { organization, user } from "./auth.js";

export const workspaceTokenRepository = pgTable(
  "workspace_token_repository",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    repository: text("repository").notNull(),
    addedByUserId: text("added_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    addedAt: timestamptz("added_at").notNull(),
  },
  (table) => [
    uniqueIndex("workspace_token_repository_organization_repository").on(
      table.organizationId,
      sql`lower(${table.repository})`,
    ),
  ],
);
