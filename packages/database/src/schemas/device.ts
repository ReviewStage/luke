import type {
  DeviceArch,
  DeviceCapability,
  DevicePlatform,
  DeviceSetup,
  HostUpdate,
} from "@repo/features/device-agent-wire";
import { sql } from "drizzle-orm";
import { index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, timestamptz } from "./_helpers.js";
import { user } from "./auth.js";

export const device = pgTable(
  "device",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    platform: text("platform").$type<DevicePlatform>().notNull(),
    arch: text("arch").$type<DeviceArch>().notNull(),
    machineId: text("machine_id"),
    model: text("model"),
    home: text("home"),
    agentsFolder: text("agents_folder"),
    claudeExecutable: text("claude_executable"),
    codexExecutable: text("codex_executable"),
    capabilities: text("capabilities").$type<DeviceCapability>().array().notNull().default([]),
    setup: text("setup").$type<DeviceSetup>(),
    setupFailure: text("setup_failure"),
    updatePhase: text("update_phase").$type<HostUpdate>(),
    updateFailure: text("update_failure"),
    secretHash: text("secret_hash"),
    version: text("version"),
    removedAt: timestamptz("removed_at"),
    createdAt: createdAt(),
    lastSeenAt: timestamptz("last_seen_at").notNull(),
  },
  (table) => [
    index("device_user_seen").on(table.userId, table.lastSeenAt),
    uniqueIndex("device_secret_hash")
      .on(table.secretHash)
      .where(sql`${table.secretHash} is not null`),
  ],
);
