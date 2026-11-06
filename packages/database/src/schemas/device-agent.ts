import type {
  DeviceAgentLineKind,
  DeviceAgentObject,
  DeviceAgentRequestKind,
  DeviceLaunchStep,
} from "@repo/features/device-agent-wire";
import { sql } from "drizzle-orm";
import { bigint, index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { bytea, createdAt, timestamptz } from "./_helpers.js";
import { agentTable } from "./agent.js";
import { user } from "./auth.js";
import { device } from "./device.js";

export const deviceAgentLine = pgTable(
  "device_agent_line",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agentTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => device.id, { onDelete: "cascade" }),
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity().notNull(),
    kind: text("kind").$type<DeviceAgentLineKind>().notNull(),
    payload: jsonb("payload").$type<DeviceAgentObject>().notNull(),
    sealedSecrets: text("sealed_secrets"),
    createdAt: createdAt(),
    claimedAt: timestamptz("claimed_at"),
    claimToken: uuid("claim_token"),
    settledAt: timestamptz("settled_at"),
    exitCode: integer("exit_code"),
    launchStep: text("launch_step").$type<DeviceLaunchStep>(),
  },
  (table) => [
    index("device_agent_line_device_waiting")
      .on(table.deviceId, table.seq)
      .where(sql`${table.claimedAt} is null`),
    index("device_agent_line_user_created").on(table.userId, table.createdAt),
    index("device_agent_line_open_launch")
      .on(table.deviceId, table.seq)
      .where(sql`${table.kind} = 'launch' and ${table.settledAt} is null`),
  ],
);

export const deviceAgentRequest = pgTable(
  "device_agent_request",
  {
    id: uuid("id").primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agentTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => device.id, { onDelete: "cascade" }),
    kind: text("kind").$type<DeviceAgentRequestKind>().notNull(),
    args: jsonb("args").$type<DeviceAgentObject>().notNull(),
    bytes: bytea("bytes"),
    createdAt: createdAt(),
    claimedAt: timestamptz("claimed_at"),
    settledAt: timestamptz("settled_at"),
  },
  (table) => [
    index("device_agent_request_device_waiting")
      .on(table.deviceId, table.createdAt)
      .where(sql`${table.claimedAt} is null`),
    index("device_agent_request_user_created").on(table.userId, table.createdAt),
  ],
);
