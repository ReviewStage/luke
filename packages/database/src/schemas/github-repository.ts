import { bigint, pgTable, text } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";

/**
 * github-repository.ts -- every GitHub repository the service has seen, by GitHub's own id, with the name GitHub last gave it.
 *
 * Every other table names a repository by its `owner/name` text, which
 * GitHub changes on a rename or a transfer while the repository's id stays.
 * One row per id holds the name it was last seen under, from a webhook
 * delivery or a read of GitHub, and when GitHub said the repository last
 * changed as of that sighting; a newer sighting under another name relabels
 * every stored name in one transaction (`models/github-repositories.ts`), so
 * each one stays a label of the id it was written for, and an older one, a
 * delivery late or redelivered, moves nothing back. A row belongs to no
 * account: it holds nothing but what GitHub says of the repository itself.
 */
export const githubRepository = pgTable("github_repository", {
  /** GitHub's id for the repository, which a rename or a transfer keeps. */
  id: bigint("id", { mode: "number" }).primaryKey(),
  /** `owner/name` as GitHub last spelled it. */
  fullName: text("full_name").notNull(),
  /** When GitHub last saw the repository change, as the sighting that gave `full_name` said: its `updated_at`, which a rename or a transfer moves. */
  githubUpdatedAt: timestamptz("github_updated_at").notNull(),
});
