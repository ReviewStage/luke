import { bigint, pgTable, text } from "drizzle-orm/pg-core";

/**
 * github-repository.ts -- every GitHub repository the service has seen, by GitHub's own id, with the name GitHub last gave it.
 *
 * Every other table names a repository by its `owner/name` text, which
 * GitHub changes on a rename or a transfer while the repository's id stays.
 * One row per id holds the name it was last seen under, from a webhook
 * delivery or a read of GitHub; a sighting under another name relabels
 * every stored name in one transaction (`models/github-repositories.ts`), so
 * each one stays a label of the id it was written for. A row belongs to no
 * account: it holds nothing but what GitHub says of the repository itself.
 */
export const githubRepository = pgTable("github_repository", {
  /** GitHub's id for the repository, which a rename or a transfer keeps. */
  id: bigint("id", { mode: "number" }).primaryKey(),
  /** `owner/name` as GitHub last spelled it. */
  fullName: text("full_name").notNull(),
});
