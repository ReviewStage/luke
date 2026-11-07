import { integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./_helpers.js";
import { organization } from "./auth.js";

/**
 * workspace-environment-variable.ts -- the environment variables a workspace shares with every member's cloud agents, each one's value sealed.
 *
 * One row per variable, its name held once per workspace. The value is
 * sealed by `models/provider-key-seal.ts` under the same ring as the
 * provider keys, with purposes of its own and the workspace and the name
 * bound beside them, so no column holds the value or its data key in the
 * clear and a sealed value moved onto another row fails to open. Setting a
 * variable replaces its value, removing it deletes the row, and every row
 * goes with its workspace.
 */
export const workspaceEnvironmentVariable = pgTable(
  "workspace_environment_variable",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** A POSIX environment name, such as `DATABASE_URL`. */
    name: text("name").notNull(),
    /** The version of the deployment's key-encryption key the data key is wrapped under. */
    keyVersion: integer("key_version").notNull(),
    /** base64 of nonce, ciphertext, and tag: the data key under the key-encryption key. */
    sealedDataKey: text("sealed_data_key").notNull(),
    /** base64 of nonce, ciphertext, and tag: the value under the data key. */
    sealedValue: text("sealed_value").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // One variable of a name per workspace; a workspace's variables are read by it.
    uniqueIndex("workspace_environment_variable_name").on(table.organizationId, table.name),
  ],
);
