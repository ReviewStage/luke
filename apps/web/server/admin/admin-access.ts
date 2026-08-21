/**
 * Who may open the admin dashboard is a row in the `admin_user` table, not a
 * constant in this file. The gate is a first-party browser session the
 * maintainer signed in for on this site — resolved through Better Auth, never
 * the desktop's bearer token — and then the presence of that account's admin
 * row. The gate fails closed: no session is a `401`, a session with no admin
 * row is a `403`, and the metrics are read only past both.
 *
 * The database is the source of truth; this file holds only the bootstrap.
 * `LUKE_ADMIN_EMAILS` names the accounts a deployment wants seeded as admins —
 * a comma-separated list read from the environment, never committed here — and
 * a matching account is granted an admin row when it signs in (and by the
 * `admin:seed` build step for accounts that already existed). After the grant
 * lands, the row stands on its own; clearing the env value does not revoke it,
 * and deleting the row is how access is withdrawn.
 */

/** The env name a deployment names the accounts to seed as admins under. */
export const ADMIN_SEED_EMAILS_ENVIRONMENT = "LUKE_ADMIN_EMAILS";

/**
 * The seed-admin email set, parsed from its comma-separated env value.
 * Case-folded and trimmed so a stored address matches however its provider
 * cased it; a blank or absent value is an empty set, never a wildcard.
 */
export function adminSeedEmailsFromEnv(value: string | undefined): ReadonlySet<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0),
  );
}

/** Whether one account's address is on the seed list, matched case-insensitively. */
export function isSeededAdminEmail(
  email: string | undefined,
  seedEmails: ReadonlySet<string>,
): boolean {
  const normalized = email?.trim().toLowerCase();
  return normalized !== undefined && normalized.length > 0 && seedEmails.has(normalized);
}

/**
 * The signed-in browser viewer a request resolves to. `isAdmin` is read from
 * the `admin_user` table, so nothing the request carries can assert it.
 */
export interface AdminViewer {
  userId: string;
  email: string | undefined;
  isAdmin: boolean;
}
