/**
 * source-maps.ts -- whether a deployment's build writes and uploads source maps for Sentry.
 *
 * Only a production build that holds `SENTRY_AUTH_TOKEN` does: a Preview's
 * traces are rarely read, and writing and uploading the maps costs every
 * Preview build time. The web functions' bundler and both eve roots'
 * `nitro.config.ts` ask this, and `scripts/eve-source-maps.sh` holds the same
 * gate for the upload step it runs after `eve build`.
 */

/** The Sentry token to upload source maps with, or undefined where this build uploads none. */
export function sourceMapUploadToken(
  environment: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const token = environment.SENTRY_AUTH_TOKEN;
  return token && environment.VERCEL_ENV === "production" ? token : undefined;
}
