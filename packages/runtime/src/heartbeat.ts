import { MAIN_SESSION_KEY, type SessionKey } from "@sidecar/runtime-contracts";
import { CRON_SCHEDULE_KIND, type ScheduledJob } from "./cron.js";

/**
 * The heartbeat: main's scheduled review, on the ordinary main conversation
 * and under its full prompt, whose instructions are the workspace's own
 * `HEARTBEAT.md`. It defaults to every thirty minutes for the initial OpenAI
 * configuration and normally produces no delivery: a review that finds
 * nothing worth the developer's attention says nothing.
 */

export const HEARTBEAT_DEFAULTS = {
  INTERVAL_MS: 30 * 60 * 1000,
  JOB_ID: "heartbeat",
  JOB_NAME: "Heartbeat",
} as const;

/** The standing heartbeat job for a conversation, main's by default. */
export function heartbeatJob(
  createdAt: number,
  sessionKey: SessionKey = MAIN_SESSION_KEY,
  intervalMs: number = HEARTBEAT_DEFAULTS.INTERVAL_MS,
): ScheduledJob {
  return {
    id: HEARTBEAT_DEFAULTS.JOB_ID,
    name: HEARTBEAT_DEFAULTS.JOB_NAME,
    sessionKey,
    schedule: { kind: CRON_SCHEDULE_KIND.EVERY, everyMs: intervalMs },
    enabled: true,
    createdAt,
  };
}
