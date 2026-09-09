import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth-schema.js";

/**
 * One row per app installation on every platform Luke runs on: the Mac, the
 * iPhone, and the watch. The installation id is the key the client minted
 * once and keeps on the device, so a device that signs into a different
 * account carries its one row to that account in the same upsert rather than
 * leaving a second, and a notice for the old account can never land on a
 * device now signed in as someone else. The id is the service's own, minted
 * once for the row and answered back so a heartbeat can name it without
 * repeating the installation id. Presence (`active_until`) is written only by a
 * platform that can read its own input activity; the Mac begins to in a later
 * change and nothing writes it today. A push token is not a credential:
 * nothing but this deployment's own Apple key can address it. Every row goes
 * with the account, at sign-out, and when Apple reports its token gone.
 */
export const devices = pgTable("devices", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  /** The client's stable key: minted on the device once, kept in its own state, unique across accounts. */
  installationId: text("installation_id").notNull().unique(),
  platform: text("platform").notNull(),
  /** Refreshed by every registration and heartbeat, so a row unseen for long can be retired. */
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  /** The instant the device's reported presence holds until; null for one that reports none. */
  activeUntil: timestamp("active_until"),
  /** Apple issues one per installation, so the same token never stands on two rows. */
  pushToken: text("push_token").unique(),
  /** Which of Apple's two push gateways issued the token: sandbox or production. Null without a token. */
  pushEnvironment: text("push_environment"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
