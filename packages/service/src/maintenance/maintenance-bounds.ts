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

/** The rotation's rewrap of every stored provider key (`provider-key-rewrap.ts`), asked by hand under the same secret. */
export const MAINTENANCE_PROVIDER_KEYS_REWRAP_PATH = "/api/maintenance/provider-keys-rewrap";

/** The one-off keeping of every scheduled automation's Vercel schedule (`automation-schedules-backfill.ts`), asked by hand under the same secret. */
export const MAINTENANCE_AUTOMATION_SCHEDULES_PATH = "/api/maintenance/automation-schedules";

export const CRON_ENVIRONMENT = {
  /**
   * Vercel sends this as the bearer on every scheduled call once it is set.
   * It guards the maintenance routes alone, the sweep and the rewrap and the
   * schedules' backfill asked by hand.
   */
  CRON_SECRET: "CRON_SECRET",
} as const;

export const MAINTENANCE_SWEEP = {
  /**
   * The function duration the sweep's bundle declares. Note that it is the
   * Fluid default every Start's function runs under rather than the minute
   * the cron calls on, because an agent the sweep starts (an automation's
   * run, a queued message) launches past the sweep's answer under
   * this same bound (`after-response.ts`), and a sandbox can take most of a
   * minute to open: a launch cut off by the bound dies with nothing to say
   * so, and its agent reads as one that never started.
   */
  MAX_DURATION_SECONDS: 300,
  /** The schedule the root `vercel.json` calls the sweep on, which its Sentry monitor expects a check-in against. */
  CRONTAB: "* * * * *",
} as const;
