import { eq } from "drizzle-orm";
import type { createDatabase } from "../db/index.js";
import { user } from "../db/schema.js";
import { isSeededAdminEmail, USER_ROLE } from "./admin-access.js";

/**
 * The two writes that set an account's `role` to admin from `LUKE_ADMIN_EMAILS`.
 * This sits apart from the metrics aggregation so the auth module and the seed
 * script can reach the grant without pulling the whole metrics graph in behind
 * it. Reading the role is not here: it rides on the session Better Auth already
 * returns, so the dashboard needs no membership query of its own.
 */

type GrantDatabase = Pick<ReturnType<typeof createDatabase>, "select" | "update">;

/**
 * Promotes a signing-in account to the admin role when its address is on the
 * seed list. Idempotent: an account already admin, or one not seeded, is a
 * no-op, so this is safe to run on every sign-in. Called from the session-create
 * hook, where the write belongs — on the authentication event — rather than on
 * a dashboard read.
 */
export async function promoteSeededAdmin(
  database: GrantDatabase,
  input: { userId: string; seedEmails: ReadonlySet<string> },
): Promise<void> {
  if (input.seedEmails.size === 0) return;
  const [account] = await database
    .select({ email: user.email, role: user.role })
    .from(user)
    .where(eq(user.id, input.userId))
    .limit(1);
  if (!isSeededAdminEmail(account?.email, input.seedEmails)) return;
  if (account?.role === USER_ROLE.ADMIN) return;
  await database.update(user).set({ role: USER_ROLE.ADMIN }).where(eq(user.id, input.userId));
}

/**
 * Gives the admin role to every already-existing account whose address is on the
 * seed list, and answers how many accounts now hold it. Run by the `admin:seed`
 * build step so a maintainer who signed in before being seeded is promoted
 * without signing in again.
 */
export async function seedAdminsFromEnv(
  database: GrantDatabase,
  seedEmails: ReadonlySet<string>,
): Promise<number> {
  if (seedEmails.size === 0) return 0;
  const accounts = await database
    .select({ id: user.id, email: user.email, role: user.role })
    .from(user);
  let granted = 0;
  for (const account of accounts) {
    if (!isSeededAdminEmail(account.email, seedEmails)) continue;
    granted += 1;
    if (account.role === USER_ROLE.ADMIN) continue;
    await database.update(user).set({ role: USER_ROLE.ADMIN }).where(eq(user.id, account.id));
  }
  return granted;
}
