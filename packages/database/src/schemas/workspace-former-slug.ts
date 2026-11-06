import { index, pgTable, text } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { organization } from "./auth.js";

export const workspaceFormerSlug = pgTable(
  "workspace_former_slug",
  {
    slug: text("slug").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [index("workspace_former_slug_organization_idx").on(table.organizationId)],
);
