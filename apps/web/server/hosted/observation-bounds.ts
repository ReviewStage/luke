/**
 * The tick's bounds, on their own so the modules every function shares can
 * read them without the tick. `HostedEnvironment` names the cron secret and
 * `function-durations` the tick's path and cap, and both are inlined into
 * every route's bundle; the tick module itself imports the opener, and the
 * opener the brain host, whose door imports the eve package. A value import
 * of the tick from here would carry that whole graph — eve included — into
 * every function bundle, which is what took production down once: esbuild
 * follows a value import where it would erase a type one. So the constants
 * live in this leaf, the tick imports them like everyone else, and the
 * bundle test asserts no function bundle reaches eve.
 */

/** Where Vercel's scheduler calls, fixed here so the cron entry can be checked against it. */
export const OBSERVATION_TICK_PATH = "/api/observation/tick";

export const OBSERVATION_ENVIRONMENT = {
  /** Vercel sends this as the bearer on every scheduled call once it is set. */
  CRON_SECRET: "CRON_SECRET",
} as const;

export const OBSERVATION_TICK = {
  /**
   * How long one tick may spend before leaving the rest for the next. A batch
   * starts only while a whole pass deadline still fits inside it, so the tick
   * settles under the function's own cap even when its last batch spends
   * every second a pass may.
   */
  BUDGET_MS: 50_000,
  /**
   * The longest one account's pass may run before the tick counts it failed
   * and moves on: the adapter's whole 429 budget and a request deadline
   * besides. The pass itself is not interrupted — a roster it still reads
   * whole is written down if the function lives to see it — but the tick no
   * longer waits on it, and the attempt the pass recorded at its start is
   * what keeps the account from heading the next tick's order.
   */
  PASS_DEADLINE_MS: 25_000,
  /** The function duration the tick's bundle declares; the budget leaves headroom under it. */
  MAX_DURATION_SECONDS: 60,
  /** The most accounts one tick lists; the least recently attempted come first, so nobody starves. */
  MAX_ACCOUNTS: 200,
  /** Accounts observed at once; each is a fan of provider requests of its own. */
  CONCURRENCY: 4,
  /** How recently an account must have been seen to be observed on the schedule. */
  ACCOUNT_SEEN_WITHIN_MS: 7 * 24 * 60 * 60 * 1000,
  /**
   * How far the brain's bookmark may trail the snapshot before what changed
   * between the two is history rather than news. The pass runs about once a
   * minute, a visit with nothing to wake keeps the bookmark level with the
   * snapshot, and one that could not hand its change over derives it again
   * the next minute, so a bookmark further behind than this means the
   * schedule or the brain was out for that long: a paused cron, a deploy
   * gap, a rotated secret, a provider that refused every pass, eve refusing
   * every turn. The opener then reseeds the bookmark from the snapshot as it
   * stands and wakes nothing, since the roster is every reader's to show and
   * a change that old is history arriving late, not a notification's to
   * announce. Measured on the two rows' own instants, never the clock.
   */
  STALE_GAP_MS: 5 * 60 * 1000,
} as const;
