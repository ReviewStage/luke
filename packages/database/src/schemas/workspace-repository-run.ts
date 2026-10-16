import { pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { organization, user } from "./auth.js";

/**
 * workspace-repository-run.ts -- how one repository of a workspace is set up and run on a Mac, shared by every member.
 *
 * Run on this Mac, from a pull request's menu, checks the pull request out on
 * the developer's Mac and runs `setup_command` once (again only when a
 * lockfile changes), then `run_command`, from the checkout's root. The
 * commands are the workspace's, so whoever sets them sets them for the
 * team; any member may change them. A pull request never supplies them.
 * The row leaves with its workspace; who last changed it is set null when
 * that account goes.
 */
export const workspaceRepositoryRun = pgTable(
  "workspace_repository_run",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** The repository's full name, lowercased, as GitHub reads it without case: `reviewstage/luke`. */
    repository: text("repository").notNull(),
    /** What prepares a fresh checkout, such as `pnpm install`; null where nothing does. */
    setupCommand: text("setup_command"),
    /** What starts the app, such as `pnpm dev`; null where none is set yet. */
    runCommand: text("run_command"),
    /** The member who last changed either command; null once that account is deleted. */
    updatedByUserId: text("updated_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("workspace_repository_run_organization_id_repository_unique").on(
      table.organizationId,
      table.repository,
    ),
  ],
);
