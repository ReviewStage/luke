import { BRAIN_HOST_ENVIRONMENT } from "./bounds.js";

/**
 * The origin eve answers on: the one the environment names, or the caller's
 * own, since eve answers behind this deployment's `/eve/v1/*` rewrite. The
 * ask route hands in its request's origin; the voice function hands in the
 * origin of the socket's upgrade, so both spell this once and drift never.
 */
export function eveOrigin(callerOrigin: string): string {
  return process.env[BRAIN_HOST_ENVIRONMENT.EVE_ORIGIN]?.trim() || callerOrigin;
}

/** Vercel's own names for what a deployment is and where it answers, present on every function of it. */
const VERCEL_ENVIRONMENT = {
  ENVIRONMENT: "VERCEL_ENV",
  URL: "VERCEL_URL",
  PRODUCTION_URL: "VERCEL_PROJECT_PRODUCTION_URL",
} as const;

/** The environment a deployment runs as, as its own `VERCEL_ENV` names it. */
const DEPLOYMENT_ENVIRONMENT = { PRODUCTION: "production" } as const;

/**
 * The origin eve answers on for a caller with no request in hand, which is
 * how the voice function composes its exchange once per instance: the one the
 * environment names, or the project's production domain where this deployment
 * is the production one, or the deployment's own host, or nothing on a machine
 * that is neither configured nor deployed.
 *
 * Production prefers the custom domain because the generated `*.vercel.app`
 * host carries the project's Vercel Authentication, which answers a
 * server-to-server POST with its own 401 at the edge and never reaches eve;
 * only a custom domain is exempt. The preference is gated on `VERCEL_ENV` so a
 * preview keeps dialling itself rather than sending its asks to production's
 * eve.
 */
export function deploymentEveOrigin(): string | undefined {
  const production =
    process.env[VERCEL_ENVIRONMENT.ENVIRONMENT]?.trim() === DEPLOYMENT_ENVIRONMENT.PRODUCTION
      ? process.env[VERCEL_ENVIRONMENT.PRODUCTION_URL]?.trim()
      : undefined;
  const own = production || process.env[VERCEL_ENVIRONMENT.URL]?.trim();
  return eveOrigin(own ? `https://${own}` : "") || undefined;
}
