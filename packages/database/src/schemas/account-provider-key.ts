import type {
  FastAccess,
  ProviderKeyProvider,
  ProviderKeyStatus,
} from "@sidecar/features/provider-key-wire";
import { integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { user } from "./auth.js";

/**
 * One of an account's own provider API keys, at most one per provider,
 * sealed by `models/provider-key-seal.ts`: no column holds the key or the
 * data key in the clear. The hint is the one part of the key kept readable,
 * its prefix and last four characters, so the account can tell its keys
 * apart. Saving a key for a provider that holds one replaces the row whole,
 * removing one deletes it, and every row leaves with the account.
 */
export const accountProviderKey = pgTable(
  "account_provider_key",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").$type<ProviderKeyProvider>().notNull(),
    /** The version of the deployment's key-encryption key the data key is wrapped under. */
    keyVersion: integer("key_version").notNull(),
    /** base64 of nonce, ciphertext, and tag: the data key under the key-encryption key. */
    sealedDataKey: text("sealed_data_key").notNull(),
    /** base64 of nonce, ciphertext, and tag: the provider key under the data key. */
    sealedKey: text("sealed_key").notNull(),
    hint: text("hint").notNull(),
    status: text("status").$type<ProviderKeyStatus>().notNull(),
    statusAt: timestamptz("status_at").notNull(),
    /** Whether the key's organization may run Anthropic's fast mode, as a fast request on the key last settled; null where none has. */
    fastAccess: text("fast_access").$type<FastAccess>(),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.provider] })],
);
