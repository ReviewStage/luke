import { eq } from "drizzle-orm";
import type { createDatabase } from "../db/index.js";
import { adminUser, user } from "../db/schema.js";
import { isSeededAdminEmail } from "./admin-access.js";

/**
 * Admin membership as the database holds it: reading whether an account has an
 * admin row, and the two writes that seed one from `LUKE_ADMIN_EMAILS`. This
 * sits apart from the metrics aggregation so the auth module and the seed
 * script can reach the grant without pulling the whole metrics graph in behind
 * it.
 */

type MembershipDatabase = Pick<ReturnType<typeof createDatabase>, "select">;
type GrantDatabase = Pick<ReturnType<typeof createDatabase>, "select" | "insert">;

/** Whether this account has an admin row — the whole authorization decision. */
export async function isAdminUser(database: MembershipDatabase, userId: string): Promise<boolean> {
  const rows = await database
    .select({ userId: adminUser.userId })
    .from(adminUser)
    .where(eq(adminUser.userId, userId))
    .limit(1);
  return rows.length > 0;
}

/**
 * Grants the admin row to a signing-in account when its address is on the seed
 * list. Idempotent: an account already admin, or one not seeded, is a no-op, so
 * this is safe to run on every sign-in. Called from the session-create hook,
 * where the write belongs — on the authentication event — rather than on a
 * dashboard read.
 */
export async function promoteSeededAdmin(
  database: GrantDatabase,
  input: { userId: string; seedEmails: ReadonlySet<string> },
): Promise<void> {
  if (input.seedEmails.size === 0) return;
  const [account] = await database
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, input.userId))
    .limit(1);
  if (!isSeededAdminEmail(account?.email, input.seedEmails)) return;
  await database.insert(adminUser).values({ userId: input.userId }).onConflictDoNothing();
}

/**
 * Ensures every already-existing account whose address is on the seed list has
 * an admin row, and answers how many rows now exist for the list. Run by the
 * `admin:seed` build step so a maintainer who signed in before being seeded is
 * promoted without having to sign in again.
 */
export async function seedAdminsFromEnv(
  database: GrantDatabase,
  seedEmails: ReadonlySet<string>,
): Promise<number> {
  if (seedEmails.size === 0) return 0;
  const accounts = await database.select({ id: user.id, email: user.email }).from(user);
  let granted = 0;
  for (const account of accounts) {
    if (!isSeededAdminEmail(account.email, seedEmails)) continue;
    await database.insert(adminUser).values({ userId: account.id }).onConflictDoNothing();
    granted += 1;
  }
  return granted;
}
