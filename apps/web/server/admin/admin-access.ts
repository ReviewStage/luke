/**
 * Who may open the admin dashboard is the account's `role`, a plain-text column
 * on the `user` table that Better Auth manages — declared as an additional user
 * field in `auth.ts`, generated into `auth-schema.ts`, and returned on the
 * session — not a constant in this file. The gate is a first-party browser
 * session the maintainer signed in for on this site (resolved through Better
 * Auth, never the desktop's bearer token) whose account carries the admin role.
 *
 * The database is the source of truth; this file holds the role vocabulary and
 * the bootstrap. `LUKE_ADMIN_EMAILS` names the accounts a deployment wants given
 * the admin role — a comma-separated list read from the environment, never
 * committed here — and a matching account is promoted when it signs in (and by
 * the `admin:seed` build step for accounts that already existed). Once the role
 * is set it stands on its own; clearing the env value does not demote it, and
 * setting the role back to `user` is how access is withdrawn.
 */

/** The user roles this build knows. Plain-text in the column, a fixed set here. */
export const USER_ROLE = {
  USER: "user",
  ADMIN: "admin",
} as const;

export type UserRole = (typeof USER_ROLE)[keyof typeof USER_ROLE];

/** Whether a stored role string is the admin role — the whole authorization decision. */
export function isAdminRole(role: string | null | undefined): boolean {
  return role === USER_ROLE.ADMIN;
}

/** The env name a deployment names the accounts to promote to admin under. */
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
 * The signed-in browser viewer a request resolves to. `role` is read from the
 * account's own `user` row on the session, so nothing the request carries can
 * assert it.
 */
export interface AdminViewer {
  userId: string;
  email: string | undefined;
  role: string | null | undefined;
}
