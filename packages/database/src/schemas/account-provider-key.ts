import {
  type FastAccess,
  PROVIDER_KEY_KIND,
  type ProviderKeyKind,
  type ProviderKeyProvider,
  type ProviderKeyStatus,
} from "@luke/features/provider-key-wire";
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
     * When the access token a ChatGPT sign-in's sealed credentials hold
     * expires, so a refresh is due without opening them; null for every
     * other kind, whose credential carries no expiry Luke reads.
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
 * The account's own `ext_agent_host_id` for Luke's hosted runtime: the host
 * OpenAI's Sign in with ChatGPT names when the desktop signs in for the
 * service, minted once and kept across sign-outs, as OpenAI's guide asks a
 * host's id to be, so it outlives the credential row it signs in for. It is
 * an opaque identifier, not a credential, and leaves with the account.
 */
export const accountChatGptHost = pgTable("account_chatgpt_host", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  extAgentHostId: text("ext_agent_host_id").notNull(),
  createdAt: timestamptz("created_at").notNull(),
});
