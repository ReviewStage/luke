import { pgTable, text } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { organization, user } from "./auth.js";

/**
 * An owner's or admin's intent to connect a GitHub organization to a
 * workspace: made when the Mac asks where to install the Luke GitHub App,
 * carried to GitHub and back as the install address's opaque `state`, and
 * spent the one time GitHub returns through the Setup URL. Only the state's
 * SHA-256 is stored, so the table holds nothing a browser could replay. An
 * intent past its expiry, or already spent, links nothing; it leaves with
 * its account or its workspace.
 */
export const githubInstallIntent = pgTable("github_install_intent", {
  /** The hex SHA-256 of the state the install address carried. */
  stateHash: text("state_hash").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  expiresAt: timestamptz("expires_at").notNull(),
  createdAt: timestamptz("created_at").notNull(),
});
