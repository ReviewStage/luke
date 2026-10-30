import type { DeviceArch, DevicePlatform } from "@luke/features/device-agent-wire";
import { index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { user } from "./auth.js";
import { device } from "./device.js";

/**
 * host-pairing.ts -- the pairings a box started to join a member's devices with a code, and how many codes each account guessed wrong.
 *
 * A box starts a pairing with no credential: the service keeps the box's
 * name, platform, architecture, and daemon version, the address the start
 * came from, the user code it shows, and the SHA-256 of the poll secret it
 * answered, never the secret. A signed-in member who opens the code's link
 * approves it, which makes their host row (`./device.ts`, kind host) with no
 * secret and names it here, or denies it; either is the pairing's one
 * settle, and keeps who settled it. The box's next poll after an approve is
 * handed the host's device secret once, which deletes the row. A pairing
 * lasts ten minutes from its start (`expires_at`), an approve leaving the box
 * a minute past it to collect; the maintenance sweep deletes it once it
 * lapsed, the address with it, and an approved host whose box never
 * collected its secret. The row goes with its settler's account.
 *
 * A guess is a read, an approve, or a deny by user code; each account's
 * guesses that named no pending pairing are counted per window in
 * `host_pairing_guess`, shared by every function instance, so an account
 * past the limit is refused until its window ends. Its row goes with the
 * account, and the sweep deletes it once its window ended.
 */

/** Where a pairing stands: waiting for a member, approved and waiting for its box to collect its secret, or denied. */
export const HOST_PAIRING_STATUS = {
  PENDING: "pending",
  APPROVED: "approved",
  DENIED: "denied",
} as const;

export type HostPairingStatus = (typeof HOST_PAIRING_STATUS)[keyof typeof HOST_PAIRING_STATUS];

export const hostPairing = pgTable(
  "host_pairing",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The poll secret's SHA-256 in hex, which a poll is looked up by. */
    pollSecretHash: text("poll_secret_hash").notNull(),
    /** The code the box shows, as its eight letters with no dash. */
    userCode: text("user_code").notNull(),
    /** The box's name, as it named itself. */
    name: text("name").notNull(),
    platform: text("platform").$type<DevicePlatform>().notNull(),
    arch: text("arch").$type<DeviceArch>().notNull(),
    /** The daemon version the start called with, which the host row is made with. */
    version: text("version").notNull(),
    /** The address the start came from, as the platform named it; null where it named none. */
    ip: text("ip"),
    status: text("status").$type<HostPairingStatus>().notNull(),
    createdAt: timestamptz("created_at").notNull(),
    /** When the code stops being approved, and the row is swept. */
    expiresAt: timestamptz("expires_at").notNull(),
    /** When the box last polled and was answered; null before its first poll. */
    polledAt: timestamptz("polled_at"),
    /** The account that approved or denied it; null while it is pending. */
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    /** The host row its approve made; null until it is approved. */
    deviceId: uuid("device_id").references(() => device.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("host_pairing_poll_secret_hash").on(table.pollSecretHash),
    uniqueIndex("host_pairing_user_code").on(table.userCode),
    index("host_pairing_expires_at").on(table.expiresAt),
    index("host_pairing_device").on(table.deviceId),
  ],
);

export const hostPairingGuess = pgTable("host_pairing_guess", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  /** The account's guesses in this window that named no pending pairing. */
  misses: integer("misses").notNull(),
  /** When this window ends, and its count with it. */
  windowEndsAt: timestamptz("window_ends_at").notNull(),
});
