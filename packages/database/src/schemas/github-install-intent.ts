import { bigint, pgTable, text } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { organization, user } from "./auth.js";

/**
 * An owner's or admin's intent to connect GitHub to a workspace: made when
 * the Mac asks where to install the Luke GitHub App, carried to GitHub and
 * back as the install address's opaque `state`. When GitHub returns through
 * the Setup URL, the installation it names and a PKCE code verifier are
 * written on the row, and the browser goes on to authorize the App once
 * under the same `state`; the intent is spent the one time GitHub returns
 * through that authorization's callback. Only the state's SHA-256 is
 * stored, so the table holds nothing a browser could replay. An intent past
 * its expiry, or already spent, links nothing; it leaves with its account or
 * its workspace.
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
  /** The installation GitHub named on the Setup URL; null until GitHub returns there. */
  installationId: bigint("installation_id", { mode: "number" }),
  /** The PKCE code verifier of the authorization that confirms the installer; null until GitHub returns to the Setup URL. */
  codeVerifier: text("code_verifier"),
  expiresAt: timestamptz("expires_at").notNull(),
  createdAt: timestamptz("created_at").notNull(),
});
