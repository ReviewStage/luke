import type { GitHubTokenStatus } from "@repo/features/github-token-wire";
import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { user } from "./auth.js";

export const githubPersonalToken = pgTable("github_personal_token", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  keyVersion: integer("key_version").notNull(),
  sealedDataKey: text("sealed_data_key").notNull(),
  sealedToken: text("sealed_token").notNull(),
  hint: text("hint").notNull(),
  githubUserId: text("github_user_id").notNull(),
  githubLogin: text("github_login").notNull(),
  expiresAt: timestamptz("expires_at"),
  status: text("status").$type<GitHubTokenStatus>().notNull(),
  statusAt: timestamptz("status_at").notNull(),
  createdAt: timestamptz("created_at").notNull(),
});
