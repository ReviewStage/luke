import { bigint, pgTable, text } from "drizzle-orm/pg-core";
import type {
  GitHubAccountType,
  GitHubInstallationStatus,
} from "../github-installation-vocabulary.js";
import { timestamptz } from "./_helpers.js";
import { organization } from "./auth.js";

/**
 * The GitHub App installation a workspace stands for: one Better Auth
 * `organization` per installation, keyed on GitHub's own numeric ids for the
 * installation and the account it is on, never the login, which an account
 * can change. The login and the account's kind are refreshed by each sync
 * that reaches the installation; the status is the installation webhook's,
 * and a workspace whose installation is not active is listed as inactive
 * rather than deleted. The row leaves with its workspace.
 */
export const githubInstallation = pgTable("github_installation", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  installationId: bigint("installation_id", { mode: "number" }).notNull().unique(),
  accountId: bigint("account_id", { mode: "number" }).notNull().unique(),
  accountLogin: text("account_login").notNull(),
  accountType: text("account_type").$type<GitHubAccountType>().notNull(),
  status: text("status").$type<GitHubInstallationStatus>().notNull(),
  createdAt: timestamptz("created_at").notNull(),
  updatedAt: timestamptz("updated_at").notNull(),
});
