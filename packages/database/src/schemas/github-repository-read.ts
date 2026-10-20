import { boolean, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { user } from "./auth.js";

/**
 * github-repository-read.ts -- whether a member's own GitHub token reads a repository, as GitHub last answered it.
 *
 * One row per member and repository, kept for a task or a coding agent
 * reached on another member's own token (`github_access = 'token'`), which
 * a teammate sees only where their own verified token reads its repository.
 * The service asks GitHub (`github/repository-reads.ts`) and writes the
 * answer here; every task and agent read gates on it in SQL
 * (`models/workspace-store.ts`), so no read asks GitHub itself. A row is
 * asked again an hour after it was checked, and a token saved or removed
 * takes every row of its member with it. The repository is `owner/name`
 * lowercased, since GitHub's names are case-insensitive. Each row leaves
 * with its account.
 */
export const githubRepositoryRead = pgTable(
  "github_repository_read",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** `owner/name`, lowercased. */
    repository: text("repository").notNull(),
    /** Whether GitHub answered the member's token with the repository (2xx), rather than 403 or 404. */
    readable: boolean("readable").notNull(),
    checkedAt: timestamptz("checked_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.repository] })],
);
