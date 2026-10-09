/**
 * github-install-wire.ts -- where a developer lands once the Luke GitHub App is installed, and the one word the landing carries.
 *
 * GitHub returns the browser from an install to the App's Setup URL, which
 * is the service's `GITHUB_INSTALLED` route; that route confirms the
 * installation and sends the browser on to this page with a status. The
 * status is the whole of what travels: a word from the fixed set below,
 * never a login, an id, or a count, so the page interpolates nothing the
 * address brought it.
 */

export const GITHUB_INSTALL_LANDING = {
  PATH: "/github-installed.html",
  STATUS_PARAM: "status",
} as const;

export const GITHUB_INSTALL_STATUS = {
  /** The App was installed, and the installation is this App's own. */
  INSTALLED: "installed",
  /** An existing installation changed which repositories it reaches. */
  UPDATED: "updated",
  /** The developer asked an organization's owner to install the App; nothing is installed yet. */
  REQUESTED: "requested",
  /** GitHub named no installation, or one that is not this App's. */
  NOT_FOUND: "not-found",
  /** The deployment has no App configured, or GitHub could not be asked. */
  UNAVAILABLE: "unavailable",
} as const;

export type GitHubInstallStatus =
  (typeof GITHUB_INSTALL_STATUS)[keyof typeof GITHUB_INSTALL_STATUS];

const STATUSES: ReadonlySet<string> = new Set(Object.values(GITHUB_INSTALL_STATUS));

/** The landing's status as the address spells it; anything else is no status. */
export function githubInstallStatusFromWire(value: string | null): GitHubInstallStatus | undefined {
  // SAFETY: membership in the set built from GITHUB_INSTALL_STATUS's values is what the union names.
  return value !== null && STATUSES.has(value) ? (value as GitHubInstallStatus) : undefined;
}

/** The landing page's path for one status, relative so it lands on whichever host the browser is on. */
export function githubInstallLandingPath(status: GitHubInstallStatus): string {
  return `${GITHUB_INSTALL_LANDING.PATH}?${GITHUB_INSTALL_LANDING.STATUS_PARAM}=${status}`;
}
