import type { ScheduledJob } from "@sidecar/runtime";
import { scheduledJobFromWire } from "@sidecar/runtime";
import type { UnparsedWireValue } from "@sidecar/wire";
import type { RuntimeDatabase } from "./database.js";

/**
 * The scheduler's jobs, one row each. The row's payload is the job as the
 * scheduler wrote it, read back through the same validator the scheduler
 * uses, so a row this build cannot read is left out rather than guessed at;
 * `last_run_at` is kept as a column as well because it is what a launch
 * consults first, to run a job that was due while the app was closed once
 * rather than once per missed occurrence.
 */

export function listScheduledJobs(database: RuntimeDatabase): readonly ScheduledJob[] {
  // SAFETY: the payload column is text; the validator decides what it holds.
  const rows = database
    .prepare("SELECT payload FROM scheduled_jobs ORDER BY created_at, job_id")
    .all() as { payload: string }[];
  const jobs: ScheduledJob[] = [];
  for (const row of rows) {
    let parsed: UnparsedWireValue;
    try {
      // SAFETY: JSON.parse returns a wire value; the reader is the validation.
      parsed = JSON.parse(row.payload) as UnparsedWireValue;
    } catch {
      continue;
    }
    const job = scheduledJobFromWire(parsed);
    if (job) jobs.push(job);
  }
  return jobs;
}

export function putScheduledJob(database: RuntimeDatabase, job: ScheduledJob): boolean {
  if (!scheduledJobFromWire(JSON.parse(JSON.stringify(job)))) return false;
  database
    .prepare(
      `INSERT INTO scheduled_jobs (job_id, session_key, created_at, last_run_at, enabled, payload)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(job_id) DO UPDATE SET
         session_key = excluded.session_key,
         last_run_at = excluded.last_run_at,
         enabled = excluded.enabled,
         payload = excluded.payload`,
    )
    .run(
      job.id,
      job.sessionKey,
      job.createdAt,
      job.lastRunAt ?? null,
      job.enabled ? 1 : 0,
      JSON.stringify(job),
    );
  return true;
}

export function deleteScheduledJob(database: RuntimeDatabase, id: string): boolean {
  const result = database.prepare("DELETE FROM scheduled_jobs WHERE job_id = ?").run(id);
  return Number(result.changes) > 0;
}
