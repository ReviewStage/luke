import type { WorkspaceEnvironmentKind } from "@luke/features/workspace-environment-wire";
import { integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { organization, user } from "./auth.js";

/**
 * workspace-environment.ts -- one of a workspace's environment variables or secrets, which its coding agents' sandboxes run every command with.
 *
 * A row per name a workspace sets, of either kind, its value sealed by
 * `models/provider-key-seal.ts` under the deployment's ring whatever its
 * kind, so no column holds a value in the clear: a variable is opened to be
 * shown to a member, a secret only into a sandbox. The hint is the one part
 * of a secret kept readable, its last characters. Saving a name the
 * workspace holds replaces the row whole, of whichever kind, and removing
 * one deletes it. Who saved it last is kept, and set null when that account
 * goes, since the value is the workspace's and outlives them. Every row
 * leaves with its workspace.
 */
export const workspaceEnvironmentVariable = pgTable(
  "workspace_environment_variable",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").$type<WorkspaceEnvironmentKind>().notNull(),
    /** The version of the deployment's key-encryption key the data key is wrapped under. */
    keyVersion: integer("key_version").notNull(),
    /** base64 of nonce, ciphertext, and tag: the data key under the key-encryption key. */
    sealedDataKey: text("sealed_data_key").notNull(),
    /** base64 of nonce, ciphertext, and tag: the value under the data key. */
    sealedValue: text("sealed_value").notNull(),
    /** A secret's last characters, as `…abcd`; empty for a variable, which is shown whole. */
    hint: text("hint").notNull(),
    /** The owner or admin who saved it last; null once that account is deleted. */
    updatedByUserId: text("updated_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.name] })],
);
