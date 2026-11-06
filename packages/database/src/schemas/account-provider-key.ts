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

/**
 * One of an account's own provider credentials, an API key or a
 * subscription's credential as its kind says, at most one of each kind per
 * provider, so a provider's API key and its subscription stand side by side,
 * sealed by `models/provider-key-seal.ts`: no column holds the key or the
 * data key in the clear. The hint is the one part of the key kept readable,
 * its prefix and last four characters, so the account can tell its keys
 * apart. Saving a key of a kind the provider holds replaces that row whole,
 * removing one deletes it, and every row leaves with the account.
 */
export const accountProviderKey = pgTable(
  "account_provider_key",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").$type<ProviderKeyProvider>().notNull(),
    /** What the credential is; every row from before kinds is an API key. */
    kind: text("kind").$type<ProviderKeyKind>().notNull().default(PROVIDER_KEY_KIND.API_KEY),
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
    /**
     * When the access token a ChatGPT plan's sealed credentials hold
     * expires, so a refresh is due without opening them; null for every
     * other kind, whose credential carries no expiry we read.
     */
    accessExpiresAt: timestamptz("access_expires_at"),
    /**
     * Whether a subscription credential pays for the account's coding agents
     * by default ("Use my Claude plan for coding agents"): on as the plan is
     * connected, kept across a replaced token, and gone with the row on a
     * disconnect, so connecting again turns it back on. Start may pick
     * another payer for one agent whatever it says. An API key's row keeps
     * the default and nothing reads it.
     */
    forAgents: boolean("for_agents").notNull().default(true),
    /** When a plan's reached usage limit resets, where its provider said; null for every other status. */
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

/**
 * The account's pending connection of a ChatGPT plan through Codex's
 * device-code login: at most one per account, a new one replacing it, so
 * none outlives the next start. The device authorization and its user code,
 * which together claim the sign-in at OpenAI, are held only as the service
 * sealed them (`models/provider-key-seal.ts`'s `sealChatGptDeviceCodes`),
 * bound to the account and the login, never in the clear and never in the
 * panel, and leave the row once it settles. `outcome` is how it settled,
 * null while it is pending, so a poll after the one that settled it answers
 * the same. The row leaves with its account.
 */
export const accountChatGptDeviceLogin = pgTable("account_chatgpt_device_login", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  /** The opaque id the panel polls and cancels the login by, minted afresh at every start. */
  loginId: text("login_id").notNull(),
  /** The device authorization and user code as the service sealed them; null once the login settled. */
  sealedCodes: text("sealed_codes"),
  /** How the login settled; null while it is pending. */
  outcome: text("outcome").$type<ChatGptDeviceSettled>(),
  /** When OpenAI stops taking the user code, fifteen minutes after the start. */
  expiresAt: timestamptz("expires_at").notNull(),
  createdAt: timestamptz("created_at").notNull(),
});
