import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { timestamptz, updatedAt } from "./_helpers.js";

/**
 * github-rate-hold.ts -- the holds GitHub's rate limits put on the deployment's requests, shared by every instance.
 *
 * One row per identity GitHub limits a request under, as the rate gate names
 * it (`packages/service/src/github/github-rate-gate.ts`): `app` for the App's
 * own JWT and its installations' tokens, `anonymous`, or a member token's
 * sha256 digest, never the token itself. A refusal on one instance writes the
 * instant every instance asks nothing more of GitHub under that identity
 * until, and how many refusals in a row it follows; the first answer GitHub
 * sends once it lifts lets the row go. Nothing of an account is kept here.
 */
export const githubRateHold = pgTable("github_rate_hold", {
  identity: text("identity").primaryKey(),
  /** The instant requests under the identity may be sent again; moved on by a refusal, never back. */
  heldUntil: timestamptz("held_until").notNull(),
  /** How many refusals in a row the hold follows, refusals while it stood counting as one. */
  strikes: integer("strikes").notNull(),
  updatedAt: updatedAt(),
});
