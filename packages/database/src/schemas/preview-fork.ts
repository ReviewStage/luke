import { pgTable, text } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";

/**
 * preview-fork.ts -- when a Preview's database, a branch of production's, was made the Preview's own.
 *
 * Nothing reads or writes this table at the moment: the run that wrote it
 * (#3666) was reverted while the team decides on it, and the table stays
 * declared rather than dropped, since a drop has to wait out every
 * deployment that could still name it (the `db-migrations` skill's "Expand,
 * migrate, contract"). It is either written again when that work returns or
 * dropped in a later migration marked `-- contract`.
 *
 * Neon branches a Preview's database off production with every row production
 * held at that instant, so a Preview starts holding every account and every
 * run that was in flight. The Preview build's first run of
 * `models/preview-fork.ts` cuts that copy down to the team's workspaces and
 * settles what was in flight, then writes this one row, which is what tells a
 * later build of the same branch that the work is done. Production's table
 * stays empty, so a branch taken from it, or one reset onto it, has no row and
 * is made the Preview's own again. The row names the instant and nothing of
 * any account.
 */
export const previewFork = pgTable("preview_fork", {
  /** The one row's key, `PREVIEW_FORK_ROW`, so a second write lands on the first. */
  id: text("id").primaryKey(),
  /** When the copy was cut down and settled. */
  preparedAt: timestamptz("prepared_at").notNull(),
});
