/**
 * Who may open the admin dashboard, and nothing wider. The dashboard reads the
 * service's own operational tables — signups, active sessions, hosted-tier
 * usage — so its gate is not the desktop's bearer token but a browser session
 * the maintainer signed in for on this site, checked here against a fixed
 * allowlist.
 *
 * The two maintainers are named by their GitHub account ids. Those ids are
 * public and immutable, which an email is neither, and committing them keeps
 * the gate from depending on a deployment remembering to configure it — the
 * same reason the desktop OAuth client is compiled in rather than read from the
 * environment. A deployment may name further admins by email through
 * `LUKE_ADMIN_EMAILS`, which is how an account that signed in with Google
 * rather than GitHub, or a maintainer added later, is recognised without a
 * code change. The gate fails closed: an unmatched viewer is refused, and a
 * deployment that sets no env allowlist still admits exactly the two ids below.
 */

export const ADMIN_GITHUB_ACCOUNT = {
  DEAN: "29683763",
  CHARLES: "30245070",
} as const;

export const ADMIN_GITHUB_ACCOUNT_IDS: ReadonlySet<string> = new Set(
  Object.values(ADMIN_GITHUB_ACCOUNT),
);

/** The env name a deployment names further admins by email under. */
export const ADMIN_EMAILS_ENVIRONMENT = "LUKE_ADMIN_EMAILS";

/**
 * The admin email allowlist, parsed from its comma-separated env value.
 * Case-folded and trimmed so a stored address matches however the provider
 * cased it; a blank or absent value is an empty allowlist, not a wildcard.
 */
export function adminEmailsFromEnv(value: string | undefined): ReadonlySet<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0),
  );
}

/**
 * The signed-in browser viewer a request resolves to: the account id, the
 * address the account is keyed by, and the GitHub account ids linked to it.
 * A viewer with none of these matching the allowlist is not an admin.
 */
export interface AdminViewer {
  userId: string;
  email: string | undefined;
  githubAccountIds: readonly string[];
}

/**
 * Whether a resolved viewer may see the dashboard. A committed GitHub id is the
 * primary key; the env email allowlist is the escape hatch for an account that
 * did not sign in with GitHub. Either alone is enough, and neither is inferred
 * from anything the request itself carried — the ids come from the account's
 * own linked-provider rows, and the email from its own user row.
 */
export function isAdminViewer(viewer: AdminViewer, adminEmails: ReadonlySet<string>): boolean {
  if (viewer.githubAccountIds.some((id) => ADMIN_GITHUB_ACCOUNT_IDS.has(id))) {
    return true;
  }
  const email = viewer.email?.trim().toLowerCase();
  return email !== undefined && email.length > 0 && adminEmails.has(email);
}
