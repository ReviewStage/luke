import assert from "node:assert/strict";
import test from "node:test";
import { heartbeatJob } from "@sidecar/runtime";
import { deleteScheduledJob, listScheduledJobs, putScheduledJob } from "./jobs-table.js";
import { NOW, openTestDatabase } from "./testing.js";

test("scheduled jobs are written whole, read back through the scheduler's own validator, and deleted by id", () => {
  const database = openTestDatabase();
  assert.deepEqual(listScheduledJobs(database), []);
  const job = heartbeatJob(NOW);
  assert.equal(putScheduledJob(database, job), true);
  assert.deepEqual(listScheduledJobs(database), [job]);
  const ran = { ...job, lastRunAt: NOW + 1 };
  assert.equal(putScheduledJob(database, ran), true);
  assert.deepEqual(listScheduledJobs(database), [ran]);
  database.prepare("UPDATE scheduled_jobs SET payload = 'not json' WHERE job_id = ?").run(job.id);
  assert.deepEqual(listScheduledJobs(database), []);
  assert.equal(deleteScheduledJob(database, job.id), true);
  assert.equal(deleteScheduledJob(database, job.id), false);
});
