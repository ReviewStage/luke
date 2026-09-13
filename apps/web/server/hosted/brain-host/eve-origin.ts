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

/** Vercel's own name for the deployment's host, present on every function of the deployment. */
const VERCEL_ENVIRONMENT = { URL: "VERCEL_URL" } as const;

/**
 * The origin eve answers on for a caller with no request in hand, which is
 * how the voice function composes its exchange once per instance: the one the
 * environment names, or the deployment's own host, or nothing on a machine
 * that is neither configured nor deployed.
 */
export function deploymentEveOrigin(): string | undefined {
  const own = process.env[VERCEL_ENVIRONMENT.URL]?.trim();
  return eveOrigin(own ? `https://${own}` : "") || undefined;
}
