import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, timestamptz } from "./_helpers.js";
import { agentTable } from "./agent.js";
import { device } from "./device.js";

/**
 * agent-state.ts -- the generations of a device agent's saved state, and the sealed key each agent's bundles are encrypted with.
 *
 * At the end of every turn a device agent's host packs what no one can
 * rebuild of it (its work, its harness's session files, its attachments),
 * encrypts the bundle under the agent's own key, uploads it to Luke's blob
 * store, and commits it here as the agent's next generation. The bytes live
 * in the store; a row is the record of one committed bundle: where it is,
 * its size and SHA-256, the commit its work applies to, and the device that
 * saved it. A cold launch restores the agent's newest generation.
 *
 * A generation row names its agent, and the agent's own conversation, by
 * id and holds no foreign key to either, on purpose: deleting an agent or
 * its task deletes the agent's row at once and stamps its conversation for
 * the purge seven days on (`models/soft-delete.ts`), deleting the account
 * deletes both at once, and the row of each generation is the only record
 * of the blob it names, so it must outlive both for the sweep to delete that
 * blob before the row (`models/agent-state-store.ts`). The sweep takes a
 * deleted agent's generations once its conversation is gone, so its saved
 * state goes when its transcript goes. Every read and commit joins the
 * agent's row on its account, so a generation whose agent is gone is reached
 * by the sweep alone.
 *
 * The key is 32 random bytes made the first time the agent's state is asked
 * for, kept sealed under the deployment's key ring as
 * `models/provider-key-seal.ts` seals a provider key, bound to the agent and
 * its account, and never in the clear. It does go with its agent, so a
 * deleted agent's blobs are unreadable from the moment its row goes, before
 * the sweep reaches them.
 */
export const agentStateGeneration = pgTable(
  "agent_state_generation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The agent whose state this is; no foreign key, so the row outlives the agent until the sweep deletes its blob. */
    agentId: uuid("agent_id").notNull(),
    /** The agent's own conversation, its transcript, as the commit found it; no foreign key, so the sweep sees it go. */
    conversationId: uuid("conversation_id").notNull(),
    /** Rises by one with each commit of the agent's, from 1. */
    generation: integer("generation").notNull(),
    /** Where the bundle stands in the blob store. */
    path: text("path").notNull(),
    /** The bundle's size in bytes, as uploaded: encrypted, and at most the host's bound. */
    bytes: integer("bytes").notNull(),
    /** Lowercase hex of the SHA-256 of the bundle's bytes as uploaded. */
    sha256: text("sha256").notNull(),
    /** The commit the bundle's work applies to, from the shared clone; null for an agent with no repository. */
    baseCommit: text("base_commit"),
    /** The device that saved the bundle; null once that device's row is gone. */
    deviceId: uuid("device_id").references(() => device.id, { onDelete: "set null" }),
    /** When the commit was accepted; the generation expires seven days on, the newest included. */
    savedAt: timestamptz("saved_at").notNull(),
  },
  (table) => [
    // One row per generation of an agent, which is what refuses the second of two commits
    // from the same generation; the newest generation is the last entry of the agent's.
    uniqueIndex("agent_state_generation_agent_generation").on(table.agentId, table.generation),
    // Lowercase hex, so a digest compares as the bytes it names.
    check("agent_state_generation_sha256_hex", sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const agentStateKey = pgTable("agent_state_key", {
  agentId: uuid("agent_id")
    .primaryKey()
    .references(() => agentTable.id, { onDelete: "cascade" }),
  /** The version of the deployment's key-encryption key the data key is wrapped under. */
  keyVersion: integer("key_version").notNull(),
  /** base64 of nonce, ciphertext, and tag: the data key under the key-encryption key. */
  sealedDataKey: text("sealed_data_key").notNull(),
  /** base64 of nonce, ciphertext, and tag: the agent's state key under the data key. */
  sealedKey: text("sealed_key").notNull(),
  createdAt: createdAt(),
});
