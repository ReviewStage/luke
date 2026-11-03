import { index, pgTable, text } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { organization } from "./auth.js";

/**
 * A slug a workspace stood under before its owner changed it, so a link
 * written under it still names that workspace (`workspace-slug-store.ts`).
 * A slug stands here once across every workspace and stays its workspace's
 * for good: no other workspace takes it, made or changed, and the workspace
 * itself takes it back, which leaves the row. Rows leave with the workspace.
 */
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
