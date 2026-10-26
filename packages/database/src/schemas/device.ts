import type {
  DeviceArch,
  DeviceCapability,
  DeviceKind,
  DevicePlatform,
  DeviceSignedIn,
} from "@luke/features/device-agent-wire";
import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, timestamptz } from "./_helpers.js";
import { user } from "./auth.js";

/**
 * device.ts -- one of an account's devices that can run its local agents, and when it last said it was there.
 *
 * A device is the desktop app on a member's Mac today (`DEVICE_KIND`), and
 * says which platform and architecture it runs on, and which lines beyond
 * the first its follower takes (`DEVICE_CAPABILITY`). The desktop mints the id
 * once and keeps it, and registers it under the account it is signed in to;
 * an id another account registered first is never moved onto this one. While the desktop runs local agents it beats
 * the row, so `last_seen_at` is what the service reads as the Mac being
 * there to take a new agent. It registers again on every start, so `home`,
 * `claude_executable`, and `codex_executable` follow the account's home
 * folder and the harnesses the app runs, which move with every update. A
 * local agent is pinned to one of these
 * (`coding_agent.device_id`), and every line and request for it names the
 * same Mac (`./device-agent.ts`). The row belongs to the account and leaves
 * with it.
 *
 * A host (`DEVICE_KIND.HOST`) joins instead by trading an install token
 * (`./host-install-token.ts`) for a device secret of its own, which the row
 * keeps only as its SHA-256 in `secret_hash` and which every later call of
 * the host carries as its bearer. Until the host first registers, it has no
 * `home` or `claude_executable`, and no agent is offered or launched on it.
 * Removing a host stamps `removed_at` and clears its secret, so the box is
 * refused at once while its agents keep the name they ran under; enrolling
 * that id again under the same account brings it back with a new secret,
 * and a standing host's id is never enrolled again.
 */
export const device = pgTable(
  "device",
  {
    /** Minted by the desktop, once per install. */
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The Mac's own name, as the desktop read it from the system, for the agent's label. */
    name: text("name").notNull(),
    /** What program the device runs local agents through (`DEVICE_KIND`). */
    kind: text("kind").$type<DeviceKind>().notNull(),
    /** The device's operating system, as it last registered. */
    platform: text("platform").$type<DevicePlatform>().notNull(),
    /** The device's CPU architecture, as it last registered. */
    arch: text("arch").$type<DeviceArch>().notNull(),
    /** The Mac's home folder, absolute, as the desktop read it: where a local agent's folder is (`~/.luke/agents/<agent>`); null for a host that has not registered yet. */
    home: text("home"),
    /** The Claude Code CLI the desktop bundles, by its absolute path, which a local agent's launch names; null for a host that has not registered yet. */
    claudeExecutable: text("claude_executable"),
    /**
     * The Codex binary the desktop runs local agents' Codex with, by its
     * absolute path, once it checked that build against the pin, bundled or
     * fetched; null for a Mac that has none checked yet, which runs no Codex
     * agent.
     */
    codexExecutable: text("codex_executable"),
    /**
     * Which harnesses the Mac is signed in to by itself, as its register and
     * beats last said, never the credential: a local agent on one launches on
     * the Mac's own login rather than the account's saved credential.
     */
    signedIn: jsonb("signed_in").$type<DeviceSignedIn>().notNull().default({}),
    /**
     * What the device's follower takes beyond the first lines, as it last
     * registered (`DEVICE_CAPABILITY`): a line that needs one is queued only
     * for a device that has it. Empty for a row from before the column, as
     * every desktop then took none.
     */
    capabilities: text("capabilities").$type<DeviceCapability>().array().notNull().default([]),
    /** A host's device secret as its SHA-256 in hex, never the secret; null for a desktop, which calls on its sign-in, and for a removed host. */
    secretHash: text("secret_hash"),
    /** The daemon version a host last called with; null for a desktop. */
    version: text("version"),
    /** When the account removed the host; null while it stands. */
    removedAt: timestamptz("removed_at"),
    createdAt: createdAt(),
    /** When the desktop last beat, or registered, the Mac. */
    lastSeenAt: timestamptz("last_seen_at").notNull(),
  },
  (table) => [
    // Start reads the account's Macs that beat lately.
    index("device_user_seen").on(table.userId, table.lastSeenAt),
    // A host's call is resolved by its secret's hash alone.
    uniqueIndex("device_secret_hash")
      .on(table.secretHash)
      .where(sql`${table.secretHash} is not null`),
  ],
);
