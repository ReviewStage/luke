import * as Client from "@effect/sql/SqlClient";
import type { SqlError } from "@effect/sql/SqlError";
import * as SqlSchema from "@effect/sql/SqlSchema";
import {
  type ChildCompletionRecord,
  type ChildRunRecord,
  childCompletionRecordFromWire,
  childRunRecordFromWire,
} from "@sidecar/runtime/vocabulary";
import type { UnparsedWireValue } from "@sidecar/wire";
import { Effect, Schema } from "effect";
import { changedRows, columnsDecoded } from "./rows.js";

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

const PayloadRow = Schema.Struct({ payload: Schema.String });

const childRunRows = SqlSchema.findAll({
  Request: Schema.Void,
  Result: PayloadRow,
  execute: () =>
    Effect.flatMap(
      Client.SqlClient,
      (sql) => sql`SELECT payload FROM child_runs ORDER BY accepted_at, child_id`,
    ),
});

export const listChildRunsEffect: Effect.Effect<
  readonly ChildRunRecord[],
  SqlError,
  Client.SqlClient
> = Effect.map(columnsDecoded(childRunRows()), (rows) => {
  const records: ChildRunRecord[] = [];
  for (const row of rows) {
    const record = childRunRecordFromWire(parsed(row.payload));
    if (record) records.push(record);
  }
  return records;
});

export const putChildRunEffect = (
  record: ChildRunRecord,
): Effect.Effect<boolean, SqlError, Client.SqlClient> =>
  Effect.gen(function* () {
    const payload = JSON.stringify(record);
    if (!childRunRecordFromWire(parsed(payload))) return false;
    const sql = yield* Client.SqlClient;
    yield* sql`INSERT INTO child_runs
                 (child_id, requester_session_key, child_session_key, status, accepted_at,
                  settled_at, archived_at, payload)
               VALUES (${record.childId}, ${record.requesterSessionKey}, ${record.childSessionKey},
                       ${record.status}, ${record.acceptedAt}, ${record.settledAt ?? null},
                       ${record.archivedAt ?? null}, ${payload})
               ON CONFLICT(child_id) DO UPDATE SET
                 status = excluded.status,
                 settled_at = excluded.settled_at,
                 archived_at = excluded.archived_at,
                 payload = excluded.payload`;
    return true;
  });

export const deleteChildRunEffect = (
  childId: string,
): Effect.Effect<boolean, SqlError, Client.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* Client.SqlClient;
    const changes = yield* changedRows(sql`DELETE FROM child_runs WHERE child_id = ${childId}`.raw);
    return changes > 0;
  });

const childCompletionRows = SqlSchema.findAll({
  Request: Schema.Void,
  Result: PayloadRow,
  execute: () =>
    Effect.flatMap(
      Client.SqlClient,
      (sql) => sql`SELECT payload FROM child_completions ORDER BY created_at, completion_id`,
    ),
});

export const listChildCompletionsEffect: Effect.Effect<
  readonly ChildCompletionRecord[],
  SqlError,
  Client.SqlClient
> = Effect.map(columnsDecoded(childCompletionRows()), (rows) => {
  const records: ChildCompletionRecord[] = [];
  for (const row of rows) {
    const record = childCompletionRecordFromWire(parsed(row.payload));
    if (record) records.push(record);
  }
  return records;
});

export const putChildCompletionEffect = (
  completion: ChildCompletionRecord,
): Effect.Effect<boolean, SqlError, Client.SqlClient> =>
  Effect.gen(function* () {
    const payload = JSON.stringify(completion);
    if (!childCompletionRecordFromWire(parsed(payload))) return false;
    const sql = yield* Client.SqlClient;
    yield* sql`INSERT INTO child_completions
                 (completion_id, child_id, destination_session_key, delivery_status, created_at,
                  next_attempt_at, payload)
               VALUES (${completion.completionId}, ${completion.childId}, ${completion.destination},
                       ${completion.delivery}, ${completion.createdAt},
                       ${completion.nextAttemptAt ?? null}, ${payload})
               ON CONFLICT(completion_id) DO UPDATE SET
                 delivery_status = excluded.delivery_status,
                 next_attempt_at = excluded.next_attempt_at,
                 payload = excluded.payload`;
    return true;
  });

export const deleteChildCompletionEffect = (
  completionId: string,
): Effect.Effect<boolean, SqlError, Client.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* Client.SqlClient;
    const changes = yield* changedRows(
      sql`DELETE FROM child_completions WHERE completion_id = ${completionId}`.raw,
    );
    return changes > 0;
  });
