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
  /** The models a coding agent may run on, as the service offers them now (GET). `models-wire.ts` declares the answer. */
  MODELS: "/api/models",
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

/** One plan's coding agents: list them with their status (GET), or start one (POST). `coding-agent-wire.ts` declares both. */
export function planAgentsPath(planId: string): string {
  return `${planPath(planId)}/agents`;
}

/**
 * One agent's messages: its transcript past a cursor (GET), held open while
 * the agent runs, or, with no cursor, a message sent to it (POST).
 * `coding-agent-wire.ts` declares the answer and the request.
 */
export function agentMessagesPath(agentId: string, after?: string): string {
  const path = `/api/agents/${encodeURIComponent(agentId)}/messages`;
  if (after === undefined) return path;
  const query = new URLSearchParams({ after });
  return `${path}?${query}`;
}

/** Stops one agent (POST): its turn is cancelled and its sandbox stopped; anything it pushed stays. */
export function agentStopPath(agentId: string): string {
  return `/api/agents/${encodeURIComponent(agentId)}/stop`;
}

/** What one agent published (GET): the branch it pushed and the pull request from it, as GitHub holds them; `coding-agent-wire.ts` declares the answer. */
export function agentPullRequestPath(agentId: string): string {
  return `/api/agents/${encodeURIComponent(agentId)}/pull-request`;
}
