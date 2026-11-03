/**
 * deployment-origin.ts -- where this deployment answers for a caller with no request in hand: the address a native agent's runner reports its events to, reads its lines from, and reaches our MCP server at.
 *
 * The origin `APP_DEPLOYMENT_ORIGIN` names, or the project's production
 * domain where this deployment is the production one, or the deployment's
 * own host, or nothing on a machine that is neither configured nor deployed.
 * Production prefers the custom domain because the generated `*.vercel.app`
 * host carries the project's Vercel Authentication, which answers a
 * server-to-server POST with its own 401 at the edge; only a custom domain is
 * exempt. The preference is gated on `VERCEL_ENV`, so a preview's runners
 * report to the preview rather than to production.
 */

/** The variable that names the origin outright, ahead of anything Vercel says. */
const DEPLOYMENT_ORIGIN_VARIABLE = "APP_DEPLOYMENT_ORIGIN";

/** Vercel's own names for what a deployment is and where it answers, present on every function of it. */
const VERCEL_ENVIRONMENT = {
  ENVIRONMENT: "VERCEL_ENV",
  URL: "VERCEL_URL",
  PRODUCTION_URL: "VERCEL_PROJECT_PRODUCTION_URL",
} as const;

/** The environment a deployment runs as, as its own `VERCEL_ENV` names it. */
const DEPLOYMENT_ENVIRONMENT = { PRODUCTION: "production" } as const;

/** The deployment's own origin, as above, or nothing where none can be named. */
export function deploymentOrigin(): string | undefined {
  const named = process.env[DEPLOYMENT_ORIGIN_VARIABLE]?.trim();
  if (named) return named;
  const production =
    process.env[VERCEL_ENVIRONMENT.ENVIRONMENT]?.trim() === DEPLOYMENT_ENVIRONMENT.PRODUCTION
      ? process.env[VERCEL_ENVIRONMENT.PRODUCTION_URL]?.trim()
      : undefined;
  const own = production || process.env[VERCEL_ENVIRONMENT.URL]?.trim();
  return own ? `https://${own}` : undefined;
}
