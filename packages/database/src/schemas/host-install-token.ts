import { index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, timestamptz } from "./_helpers.js";
import { user } from "./auth.js";

/**
 * host-install-token.ts -- the install tokens an account minted to add its hosts, each kept as a hash.
 *
 * A member mints one in Settings › Agents › Hosts, and it enrolls any number
 * of boxes under that member (`./device.ts`, kind host) until it expires,
 * twenty-four hours after it was minted, or the member revokes it. Each box
 * trades it once for a device secret of its own, so an expired or revoked
 * token stops new boxes and touches none already enrolled. The row keeps
 * the token's SHA-256 in hex, never the token, and when a box last enrolled
 * with it. The row belongs to the account and leaves with it.
 */
export const hostInstallToken = pgTable(
  "host_install_token",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The token's SHA-256 in hex, which an enroll is looked up by. */
    tokenHash: text("token_hash").notNull(),
    createdAt: createdAt(),
    /** When it stops enrolling boxes. */
    expiresAt: timestamptz("expires_at").notNull(),
    /** When a box last enrolled with it; null until one has. */
    lastUsedAt: timestamptz("last_used_at"),
    /** When the account revoked it; null while it stands. */
    revokedAt: timestamptz("revoked_at"),
  },
  (table) => [
    uniqueIndex("host_install_token_hash").on(table.tokenHash),
    index("host_install_token_user").on(table.userId),
  ],
);
