import {
  type ChildCompletionRecord,
  type ChildRunRecord,
  childCompletionRecordFromWire,
  childRunRecordFromWire,
} from "@sidecar/runtime-contracts";
import type { UnparsedWireValue } from "@sidecar/wire";
import { nullable, type RuntimeDatabase } from "./database.js";

/**
 * Child runs and their completions, one row each. The payload is the record
 * as the child service wrote it, read back through the contracts' own
 * validators so a row this build cannot read is left out rather than guessed
 * at; the columns beside it are what a launch and a list consult without
 * parsing every payload. A completion stands in its own table, written before
 * any delivery is tried, so a child's result outlives the delivery that owes it.
 */

function parsed(payload: string): UnparsedWireValue | undefined {
  try {
    // SAFETY: JSON.parse returns a wire value; the reader is the validation.
    return JSON.parse(payload) as UnparsedWireValue;
  } catch {
    return undefined;
  }
}

export function listChildRuns(database: RuntimeDatabase): readonly ChildRunRecord[] {
  // SAFETY: the payload column is text; the validator decides what it holds.
  const rows = database
    .prepare("SELECT payload FROM child_runs ORDER BY accepted_at, child_id")
    .all() as { payload: string }[];
  const records: ChildRunRecord[] = [];
  for (const row of rows) {
    const record = childRunRecordFromWire(parsed(row.payload));
    if (record) records.push(record);
  }
  return records;
}

export function putChildRun(database: RuntimeDatabase, record: ChildRunRecord): boolean {
  const payload = JSON.stringify(record);
  if (!childRunRecordFromWire(parsed(payload))) return false;
  database
    .prepare(
      `INSERT INTO child_runs (child_id, requester_session_key, child_session_key, status, accepted_at, settled_at, archived_at, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(child_id) DO UPDATE SET
         status = excluded.status,
         settled_at = excluded.settled_at,
         archived_at = excluded.archived_at,
         payload = excluded.payload`,
    )
    .run(
      record.childId,
      record.requesterSessionKey,
      record.childSessionKey,
      record.status,
      record.acceptedAt,
      nullable(record.settledAt),
      nullable(record.archivedAt),
      payload,
    );
  return true;
}

export function deleteChildRun(database: RuntimeDatabase, childId: string): boolean {
  const result = database.prepare("DELETE FROM child_runs WHERE child_id = ?").run(childId);
  return Number(result.changes) > 0;
}

export function listChildCompletions(database: RuntimeDatabase): readonly ChildCompletionRecord[] {
  // SAFETY: the payload column is text; the validator decides what it holds.
  const rows = database
    .prepare("SELECT payload FROM child_completions ORDER BY created_at, completion_id")
    .all() as { payload: string }[];
  const records: ChildCompletionRecord[] = [];
  for (const row of rows) {
    const record = childCompletionRecordFromWire(parsed(row.payload));
    if (record) records.push(record);
  }
  return records;
}

export function putChildCompletion(
  database: RuntimeDatabase,
  completion: ChildCompletionRecord,
): boolean {
  const payload = JSON.stringify(completion);
  if (!childCompletionRecordFromWire(parsed(payload))) return false;
  database
    .prepare(
      `INSERT INTO child_completions (completion_id, child_id, destination_session_key, delivery_status, created_at, next_attempt_at, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(completion_id) DO UPDATE SET
         delivery_status = excluded.delivery_status,
         next_attempt_at = excluded.next_attempt_at,
         payload = excluded.payload`,
    )
    .run(
      completion.completionId,
      completion.childId,
      completion.destination,
      completion.delivery,
      completion.createdAt,
      nullable(completion.nextAttemptAt),
      payload,
    );
  return true;
}

export function deleteChildCompletion(database: RuntimeDatabase, completionId: string): boolean {
  const result = database
    .prepare("DELETE FROM child_completions WHERE completion_id = ?")
    .run(completionId);
  return Number(result.changes) > 0;
}
