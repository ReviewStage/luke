import type { DeviceArch, DevicePlatform } from "@repo/features/device-agent-wire";
import { index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { user } from "./auth.js";
import { device } from "./device.js";

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
    pollSecretHash: text("poll_secret_hash").notNull(),
    userCode: text("user_code").notNull(),
    name: text("name").notNull(),
    platform: text("platform").$type<DevicePlatform>().notNull(),
    arch: text("arch").$type<DeviceArch>().notNull(),
    version: text("version").notNull(),
    ip: text("ip"),
    status: text("status").$type<HostPairingStatus>().notNull(),
    createdAt: timestamptz("created_at").notNull(),
    expiresAt: timestamptz("expires_at").notNull(),
    polledAt: timestamptz("polled_at"),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
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
  misses: integer("misses").notNull(),
  windowEndsAt: timestamptz("window_ends_at").notNull(),
});
