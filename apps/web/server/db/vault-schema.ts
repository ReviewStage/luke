import { pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth-schema.js";

/**
 * One encrypted provider API key per (user, provider). Storing a key for an
 * already-stored provider replaces the previous ciphertext atomically. The
 * plaintext never leaves the server: there is no read-back endpoint, and no
 * code path returns a decrypted key to a caller.
 */
export const providerKey = pgTable(
  "provider_key",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    /**
     * AES-256-GCM ciphertext encoded as base64(nonce || ciphertext || authTag).
     * The nonce is random per write; the auth tag provides integrity.
     */
    ciphertext: text("ciphertext").notNull(),
    /** Last four characters of the plaintext key, for display only. */
    hint: text("hint").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.providerId] })],
);
