import { bigint, index, pgTable, text } from "drizzle-orm/pg-core";
import type {
  GitHubAccountType,
  GitHubInstallationStatus,
} from "../github-installation-vocabulary.js";
import { timestamptz } from "./_helpers.js";
import { organization } from "./auth.js";

/**
 * A GitHub App installation connected to a workspace: a Better Auth
 * `organization` may hold several, one per GitHub account, and each
 * installation stands for exactly one workspace. Keyed on GitHub's own
 * numeric ids for the installation and the account it is on, never the
 * login, which an account can change; the account is unique, so a reinstall
 * on it replaces its row's installation rather than adding a second. The
 * login and the account's kind are refreshed by each link that reaches the
 * installation; the status is the installation webhook's, and an
 * installation that is not active is listed as inactive rather than
 * deleted. The row leaves with its workspace.
 */
export const githubInstallation = pgTable(
  "github_installation",
  {
    installationId: bigint("installation_id", { mode: "number" }).primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    accountId: bigint("account_id", { mode: "number" }).notNull().unique(),
    accountLogin: text("account_login").notNull(),
    accountType: text("account_type").$type<GitHubAccountType>().notNull(),
    status: text("status").$type<GitHubInstallationStatus>().notNull(),
    /** When the account's row was first linked; a reinstall on the account keeps it, which is what orders a workspace's installations. */
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (t) => [index("github_installation_organization_id_idx").on(t.organizationId)],
);
