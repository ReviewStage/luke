import { bigint, index, pgTable, text } from "drizzle-orm/pg-core";
import type {
  GitHubAccountType,
  GitHubInstallationStatus,
} from "../github-installation-vocabulary.js";
import { timestamptz } from "./_helpers.js";
import { organization } from "./auth.js";

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
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (t) => [index("github_installation_organization_id_idx").on(t.organizationId)],
);
