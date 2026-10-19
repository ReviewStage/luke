import type { GitHubTokenStatus } from "@luke/features/github-token-wire";
import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { user } from "./auth.js";

/**
 * A member's own classic GitHub personal access token, at most one per
 * member, sealed by `models/provider-key-seal.ts` under the same ring as the
 * provider keys (`account_provider_key`) with purposes of its own: no column
 * holds the token or the data key in the clear. The hint is the one part of
 * the token kept readable, its prefix and last four characters. What GitHub
 * answered of the token at its save — whose it is and when it expires — is
 * kept beside it, so the member is
 * shown it without the token being opened. Saving a token replaces the row
 * whole, removing it deletes it, and the row leaves with the account.
 */
export const githubPersonalToken = pgTable("github_personal_token", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  /** The version of the deployment's key-encryption key the data key is wrapped under. */
  keyVersion: integer("key_version").notNull(),
  /** base64 of nonce, ciphertext, and tag: the data key under the key-encryption key. */
  sealedDataKey: text("sealed_data_key").notNull(),
  /** base64 of nonce, ciphertext, and tag: the token under the data key. */
  sealedToken: text("sealed_token").notNull(),
  /** The token's prefix and last four characters, as `ghp_…abcd`. */
  hint: text("hint").notNull(),
  /** GitHub's numeric id of the user the token belongs to, as `account.account_id` spells it, e.g. `"583231"`. */
  githubUserId: text("github_user_id").notNull(),
  /** That user's login as GitHub answered it at the save. */
  githubLogin: text("github_login").notNull(),
  /** When GitHub said the token expires (`github-authentication-token-expiration`); null for one that never does. */
  expiresAt: timestamptz("expires_at"),
  status: text("status").$type<GitHubTokenStatus>().notNull(),
  statusAt: timestamptz("status_at").notNull(),
  createdAt: timestamptz("created_at").notNull(),
});
