import { pathToFileURL } from "node:url";
import { ADMIN_SEED_EMAILS_ENVIRONMENT, adminSeedEmailsFromEnv } from "./admin/admin-access.js";
import { seedAdminsFromEnv } from "./admin/admin-grants.js";
import { getDatabase } from "./db/index.js";

/**
 * Ensures every account named in `LUKE_ADMIN_EMAILS` that already has a user row
 * holds the admin role, and reports how many. Run in the deployment build after
 * the migration and the desktop-client seed, so a maintainer who signed in
 * before being added to the list is promoted without signing in again. It is
 * idempotent and a no-op with no list, the same posture the desktop-client seed
 * keeps.
 */
const executedPath = process.argv[1];
if (executedPath && import.meta.url === pathToFileURL(executedPath).href) {
  const seedEmails = adminSeedEmailsFromEnv(process.env[ADMIN_SEED_EMAILS_ENVIRONMENT]);
  const granted = await seedAdminsFromEnv(getDatabase(), seedEmails);
  process.stdout.write(`Admin seed: ${granted} account(s) hold the admin role.\n`);
}
