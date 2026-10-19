// bundle-budget.mjs -- the gzipped size a renderer bundle may reach before the build fails.

/**
 * A bundle's ceiling: its recorded baseline plus the budget's slack, and, for a build with
 * Sentry's plugin, never less than a fixed floor above the baseline. Note that the floor
 * exists because the plugin adds its debug-id snippet, about 400 gzipped bytes, to every
 * file: more than 5% of a bundle of a few kilobytes, and nothing a build without it records.
 */
export function bundleCeiling(baseline, budget, withSentry) {
  const proportional = Math.floor(baseline * (1 + budget.slack));
  return withSentry ? Math.max(proportional, baseline + budget.sentrySlackBytes) : proportional;
}
