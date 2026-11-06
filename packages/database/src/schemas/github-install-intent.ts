import { bigint, pgTable, text } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { organization, user } from "./auth.js";

export const githubInstallIntent = pgTable("github_install_intent", {
  stateHash: text("state_hash").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  installationId: bigint("installation_id", { mode: "number" }),
  codeVerifier: text("code_verifier"),
  expiresAt: timestamptz("expires_at").notNull(),
  createdAt: timestamptz("created_at").notNull(),
});
