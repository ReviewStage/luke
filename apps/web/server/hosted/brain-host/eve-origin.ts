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
