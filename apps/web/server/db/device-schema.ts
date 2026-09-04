import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth-schema.js";

/**
 * One phone's push token, owned by the account it last signed in under. The
 * token is the key rather than the account: Apple issues one per app
 * installation, and a phone that signs into a different account carries its
 * token to that account in the same upsert, so a notice for the old account
 * can never land on a phone now signed in as someone else. The token is not a
 * credential — nothing but this deployment's own Apple key can address it —
 * and it is deleted with the account, at sign-out, and when Apple reports it
 * gone.
 */
export const deviceToken = pgTable("device_token", {
  token: text("token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  /** Which of Apple's two push gateways issued the token: sandbox or production. */
  environment: text("environment").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  /** Refreshed every time the phone re-registers, so a token unseen for long can be retired. */
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
