import {
  type ChatGptDeviceSettled,
  type FastAccess,
  PROVIDER_KEY_KIND,
  type ProviderKeyKind,
  type ProviderKeyProvider,
  type ProviderKeyStatus,
} from "@repo/features/provider-key-wire";
import { boolean, integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { user } from "./auth.js";

export const accountProviderKey = pgTable(
  "account_provider_key",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").$type<ProviderKeyProvider>().notNull(),
    kind: text("kind").$type<ProviderKeyKind>().notNull().default(PROVIDER_KEY_KIND.API_KEY),
    keyVersion: integer("key_version").notNull(),
    sealedDataKey: text("sealed_data_key").notNull(),
    sealedKey: text("sealed_key").notNull(),
    hint: text("hint").notNull(),
    status: text("status").$type<ProviderKeyStatus>().notNull(),
    statusAt: timestamptz("status_at").notNull(),
    fastAccess: text("fast_access").$type<FastAccess>(),
    accessExpiresAt: timestamptz("access_expires_at"),
    forAgents: boolean("for_agents").notNull().default(true),
    limitResetsAt: timestamptz("limit_resets_at"),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    primaryKey({
      name: "account_provider_key_pkey",
      columns: [table.userId, table.provider, table.kind],
    }),
  ],
);

export const accountChatGptDeviceLogin = pgTable("account_chatgpt_device_login", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  loginId: text("login_id").notNull(),
  sealedCodes: text("sealed_codes"),
  outcome: text("outcome").$type<ChatGptDeviceSettled>(),
  expiresAt: timestamptz("expires_at").notNull(),
  createdAt: timestamptz("created_at").notNull(),
});
