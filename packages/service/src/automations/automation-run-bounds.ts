/**
 * automation-run-bounds.ts -- the automation-runs consumer's topic, path, and bound, on their own so the build can read them without the consumer's graph.
 *
 * The function plan (`apps/web/server/function-durations.ts`) and the build
 * that writes the consumer's trigger read these, and the cadence that
 * publishes to the topic reads the topic; a value import of the consumer
 * from either would carry its graph with it.
 */

export const AUTOMATION_RUNS = {
  /** The queue topic every automation's firing is published to, which the consumer's trigger subscribes to. */
  TOPIC: "automation-runs",
  /** The consumer's route, a function of its own that the queue alone invokes, with no rewrite and no public path. */
  PATH: "/api/automations/runs",
  /** The consumer's duration, the Fluid default every Start's function runs under, since a sandbox can take most of a minute to open. */
  MAX_DURATION_SECONDS: 300,
} as const;
