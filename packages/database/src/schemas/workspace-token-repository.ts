import { pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { organization, user } from "./auth.js";

/**
 * workspace-token-repository.ts -- the repositories a member added to a workspace through their own GitHub token.
 *
 * A repository the workspace's GitHub App installation does not reach may be
 * added by a member whose own personal access token can push to it, so every
 * member's repository picker in the workspace lists it. The row names the
 * repository as GitHub spelled it at the add and who added it, nothing of
 * the token: each member's own token is read again at each use. A workspace
 * whose installation comes to reach the repository keeps the row and lists
 * it no longer, since the App wins. The row leaves with its workspace, or
 * with the account that added it.
 */
export const workspaceTokenRepository = pgTable(
  "workspace_token_repository",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** `owner/name` as GitHub spelled it when it was added, e.g. `"acme/relay"`. */
    repository: text("repository").notNull(),
    addedByUserId: text("added_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    addedAt: timestamptz("added_at").notNull(),
  },
  (table) => [
    uniqueIndex("workspace_token_repository_organization_repository").on(
      table.organizationId,
      table.repository,
    ),
  ],
);
