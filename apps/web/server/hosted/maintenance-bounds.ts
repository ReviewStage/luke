/**
 * The scheduled sweep's bounds, on their own so the modules every function
 * shares can read them without the sweep. `HostedEnvironment` names the cron
 * secret and `function-durations` the sweep's path and cap, and both are
 * inlined into every route's bundle; a value import of the sweep's group
 * from here would carry its graph into every function bundle, since esbuild
 * follows a value import where it would erase a type one. So the constants
 * live in this leaf and the sweep imports them like everyone else.
 */

/** Where Vercel's scheduler calls, fixed here so the cron entry can be checked against it. */
export const MAINTENANCE_SWEEP_PATH = "/api/maintenance/sweep";

export const CRON_ENVIRONMENT = {
  /**
   * Vercel sends this as the bearer on every scheduled call once it is set,
   * and the deployment acts for an account at eve's door under the same one.
   */
  CRON_SECRET: "CRON_SECRET",
} as const;

export const MAINTENANCE_SWEEP = {
  /** The function duration the sweep's bundle declares. */
  MAX_DURATION_SECONDS: 60,
} as const;
