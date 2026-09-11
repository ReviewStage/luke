import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth-schema.js";
import { instant } from "./instant.js";

/**
 * One row per app installation on every platform Luke runs on: the Mac, the
 * iPhone, and the watch. The installation id is the key the client minted
 * once and keeps on the device, so a device that signs into a different
 * account carries its one row to that account in the same upsert rather than
 * leaving a second, and no notice for the old account is addressed to that
 * device afterwards. The window this leaves is one push already handed to
 * Apple when the row moved: it still arrives, nothing in its payload can
 * stop the display, and it carries only a briefing no device of the old
 * account had claimed. The id is the service's own, minted once for the row
 * and answered back so a heartbeat can name it without repeating the
 * installation id. Presence (`active_until`) is written by a platform
 * reporting on its own input activity or its Conversation screen standing
 * in the foreground, and the meeting hold (`quiet_until`) by one that reads a
 * calendar; both arrive on the change-signal poll, which the Mac sends once
 * a minute with both and the phone and the watch send with presence alone
 * while their Conversation screen is open. Which platforms' presence delays
 * a push is `speech-push.ts`'s `SPEAKING_PLATFORMS`, not this column. A push
 * token is not a credential: nothing but this deployment's own Apple key can
 * address it.
 * Every row goes with the account, at sign-out, and when Apple reports its
 * token gone.
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
  lastSeenAt: instant("last_seen_at").notNull().defaultNow(),
  /** The instant the device's reported presence holds until; null for one that reports none. */
  activeUntil: instant("active_until"),
  /**
   * The instant a meeting hold the device observes ends, reported by the Mac
   * from its calendar intervals on the change-signal poll; null for a device
   * that reports none. It holds speech and nothing more: a delivery reads it
   * to wait, never to decide, reword, or act.
   */
  quietUntil: instant("quiet_until"),
  /** Apple issues one per installation, so the same token never stands on two rows. */
  pushToken: text("push_token").unique(),
  /** Which of Apple's two push gateways issued the token: sandbox or production. Null without a token. */
  pushEnvironment: text("push_environment"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
