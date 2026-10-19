/**
 * nitro.config.ts -- the source maps a deployment's build writes for Sentry, read by the Nitro build `eve build` runs.
 *
 * Note that this is Nitro's own config file, which Nitro loads from the eve
 * root because eve sets no `sourcemap` of its own. Only a production build
 * that holds `SENTRY_AUTH_TOKEN` writes maps, so a build without the token,
 * and `eve dev` always, are as before. They are hidden, named by no comment in
 * the bundle, and keep their sources, so Sentry can show the lines;
 * `scripts/eve-source-maps.sh` uploads them after the build and deletes them,
 * and the function is not told to look for maps it will never ship with.
 */

const SENTRY_SOURCE_MAPS = {
  sourcemap: "hidden",
  experimental: { sourcemapMinify: false },
  vercel: { functions: { shouldAddSourcemapSupport: false } },
};

export default {
  $production: process.env.SENTRY_AUTH_TOKEN ? SENTRY_SOURCE_MAPS : {},
};
