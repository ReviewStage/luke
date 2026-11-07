import { pgTable, text } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { organization, user } from "./auth.js";

/**
 * Which workspace was made for an account when it first needed one: the
 * Better Auth `organization` its tasks start in until it names another, and
 * otherwise a workspace like any other. One row per account and one account
 * per workspace, so two Macs ensuring it at once settle on the same row. The
 * workspace's metadata reads `{"personal":true}` as well, stored only. The
 * row leaves with the account or the workspace, whichever goes first; the
 * workspace is deleted with the account where the account is its only member
 * and owner, as any workspace is (`auth-policy.ts`'s `accountDeletion`), and
 * otherwise stands.
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
