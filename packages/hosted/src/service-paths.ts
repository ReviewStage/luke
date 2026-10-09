/**
 * Where Luke's hosted service answers, rooted at the service origin. The
 * addresses alone: what each endpoint takes and answers with is declared in
 * the wire module for its own domain, and a client that only needs to know
 * where to knock imports nothing else.
 */

export const HOSTED_SERVICE_PATH = {
  ACCOUNT_DELETE: "/api/account/delete",
  EVENTS: "/api/events",
  /**
   * Store and read account preferences (GET, PUT). Only settings named by
   * `@sidecar/settings` as cross-device preferences belong here.
   */
  ACCOUNT_PREFERENCES: "/api/account/preferences",
  /**
   * The account's named feature plans: list them, newest started first
   * (GET), or start one (POST) with its name and, where one is chosen, the
   * GitHub repository it is about. `plan-wire.ts` declares both.
   */
  PLANS: "/api/plans",
  /**
   * The repositories the signed-in account reaches through the Luke GitHub
   * App, most recently updated first (GET), with whether the App is
   * installed anywhere for them and where to install it.
   * `github-repositories-wire.ts` declares the answer.
   */
  GITHUB_REPOSITORIES: "/api/github/repositories",
  /**
   * Sends the browser to GitHub to install the Luke GitHub App, or to change
   * which repositories it reaches (GET). GitHub returns the browser to
   * `GITHUB_INSTALLED` afterwards.
   */
  GITHUB_INSTALL: "/api/github/install",
  /**
   * The App's Setup URL (GET): GitHub lands here after an install or an
   * update with the installation's id, and the route confirms it before
   * sending the browser on to the landing page `github-install-wire.ts`
   * names.
   */
  GITHUB_INSTALLED: "/api/github/installed",
} as const;

/**
 * Where the hosted voice service answers: a Vercel Function of the same
 * service, reached at `HOSTED_VOICE_SERVICE_ORIGIN`, the socket form of the
 * service's own origin. The path is a WebSocket upgrade; one connection
 * carries one session, or one attachment to a session that stands.
 */
export const VOICE_SERVICE_PATH = {
  /** A signed-in Mac's WebRTC voice session; the account bearer travels on the handshake. */
  SESSIONS: "/api/voice/sessions",
} as const;

/** One plan the caller owns: open it with its saved document (GET), change its name or its repository (PATCH), or delete it (DELETE). */
export function planPath(planId: string): string {
  return `${HOSTED_SERVICE_PATH.PLANS}/${encodeURIComponent(planId)}`;
}

/** One plan's whiteboard: read it with Luke's latest drawing (GET), or write its scene whole (PUT). */
export function planBoardPath(planId: string): string {
  return `${planPath(planId)}/board`;
}

/** What was said on one plan's calls (GET). */
export function planTranscriptPath(planId: string): string {
  return `${planPath(planId)}/transcript`;
}

/** The Mac claiming the plan's next command (POST), held open until one arrives or the hold runs out. */
export function planCommandClaimPath(planId: string): string {
  return `${planPath(planId)}/commands/claim`;
}

/** The Mac posting what one claimed command answered (POST). */
export function planCommandPath(planId: string, commandId: string): string {
  return `${planPath(planId)}/commands/${encodeURIComponent(commandId)}`;
}
