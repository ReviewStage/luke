import { index, pgTable, text } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { user } from "./auth.js";

/**
 * One request from a signed-in Mac to connect the account's GitHub, waiting
 * for the browser to carry it out. The Mac holds an OAuth access token, not
 * the browser session Better Auth's `linkSocial` needs, so the Mac asks for
 * an intent and opens the web page with its opaque id; the page claims it on
 * the browser's own session, which must be the same account's. An intent is
 * claimed once, by deleting it, and is worth nothing after it expires. The
 * row leaves with its account.
 */
export const githubConnectIntent = pgTable(
  "github_connect_intent",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: timestamptz("expires_at").notNull(),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [index("github_connect_intent_user_id_idx").on(table.userId)],
);
