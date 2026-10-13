import { pgTable, text } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { organization, user } from "./auth.js";

/**
 * Which workspace is an account's own: the one Better Auth `organization`
 * made for it alone, which its plans start in until it names another. One
 * row per account and one account per workspace, so two Macs ensuring it at
 * once settle on the same row. The workspace's metadata reads
 * `{"personal":true}` as well, but this row is what a read joins on, and it
 * leaves with the account or the workspace, whichever goes first.
 */
export const personalWorkspace = pgTable("personal_workspace", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  organizationId: text("organization_id")
    .notNull()
    .unique()
    .references(() => organization.id, { onDelete: "cascade" }),
  createdAt: timestamptz("created_at").notNull(),
});
