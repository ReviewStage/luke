import { SqlClient, SqlSchema } from "@effect/sql";
import type { SqlError } from "@effect/sql/SqlError";
import { Effect, Option, type ParseResult, Schema } from "effect";
import { EpochMillisColumnSchema, type UserSeal } from "./database.js";

/**
 * The latest roster an observation pass reported for a user, one row
 * replaced whole on every pass. The body is whatever the pass serialized —
 * titles, branches, error lines — and is sealed; the instant it was observed
 * stands clear, because it is what decides whether the snapshot is current.
 *
 * Every function here is an `Effect<A, SqlError | ParseResult.ParseError,
 * SqlClient.SqlClient>` over `@effect/sql`.
 */
export interface RosterSnapshotRecord {
  readonly body: string;
  readonly observedAt: number;
}

/**
 * What one pass found changed against the snapshot it replaced, as the pass
 * serialized it, waiting for the brain host to consume. The payload is
 * sealed; the two instants stand clear so a consumer can order and date it.
 */
export interface RosterDiffInsert {
  readonly id: string;
  readonly observedAt: number;
  readonly previousObservedAt: number;
  readonly payload: string;
}

export interface RosterDiffRecord extends RosterDiffInsert {
  readonly consumedAt?: number;
}

/**
 * How many diffs may wait unconsumed per user. The snapshot is the truth
 * the diffs were read from, so the oldest waiting diff goes when the bound
 * is passed rather than the table growing a row a minute for a user whose
 * brain host is not yet reading them.
 */
export const MAXIMUM_PENDING_ROSTER_DIFFS = 20;

/** How the last pass over one user's providers went. */
export interface ObservationPassRecord {
  readonly attemptedAt: number;
  /** When the whole roster was last read, or absent for a user never yet read whole. */
  readonly observedAt?: number;
  /** Why the last attempt kept the previous snapshot standing, or absent for one that read whole. */
  readonly failure?: string;
}

/** Who the scheduled observation still runs for: a key to one of the providers, and an account seen since the instant. */
export interface ObservationEligibility {
  readonly providerIds: readonly string[];
  /** The earliest device last-seen instant that still counts as the account being in use. */
  readonly seenAfter: number;
  /**
   * The accounts the sweep may reach; every account where absent, which is
   * the tick's call. A caller over a database other accounts are writing at
   * the same time — a test file beside others on one Postgres — names its
   * own, so an account that holds no key because nobody gave it one is not
   * swept out from under the file that made it.
   */
  readonly userIds?: readonly string[] | undefined;
}

/** How a statement here fails: the driver's own refusal, or a row this build could not decode. */
type RosterFailure = SqlError | ParseResult.ParseError;

/** A statement over the ambient client, so the query below reads as the query it is. */
const statement = <A, E>(build: (sql: SqlClient.SqlClient) => Effect.Effect<A, E>) =>
  Effect.flatMap(SqlClient.SqlClient, build);

const RosterSnapshotRowSchema = Schema.Struct({
  sealedBody: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("sealed_body")),
  observedAt: Schema.propertySignature(EpochMillisColumnSchema).pipe(Schema.fromKey("observed_at")),
});

const findRosterSnapshot = SqlSchema.findOne({
  Request: Schema.String,
  Result: RosterSnapshotRowSchema,
  execute: (userId) =>
    statement(
      (sql) => sql`select sealed_body, observed_at from roster_snapshot where user_id = ${userId}`,
    ),
});

export function readRosterSnapshot(
  seal: UserSeal,
  userId: string,
): Effect.Effect<RosterSnapshotRecord | undefined, RosterFailure, SqlClient.SqlClient> {
  return Effect.map(
    findRosterSnapshot(userId),
    Option.match({
      onNone: () => undefined,
      onSome: (row) => ({ body: seal.open(row.sealedBody), observedAt: row.observedAt }),
    }),
  );
}

const RosterSnapshotObservedAtRowSchema = Schema.Struct({
  observedAt: Schema.propertySignature(EpochMillisColumnSchema).pipe(Schema.fromKey("observed_at")),
});

const findObservedAt = SqlSchema.findOne({
  Request: Schema.String,
  Result: RosterSnapshotObservedAtRowSchema,
  execute: (userId) =>
    statement((sql) => sql`select observed_at from roster_snapshot where user_id = ${userId}`),
});

/**
 * The instant of the snapshot standing, read without opening its body, so a
 * pass can replace a body this build cannot open or read — under a key the
 * ring no longer holds, or in a shape another build wrote — instead of
 * losing the compare-and-set against it forever.
 */
export function rosterSnapshotObservedAt(
  userId: string,
): Effect.Effect<number | undefined, RosterFailure, SqlClient.SqlClient> {
  return Effect.map(findObservedAt(userId), (row) =>
    Option.getOrUndefined(Option.map(row, (found) => found.observedAt)),
  );
}

const RosterSnapshotWriteSchema = Schema.Struct({
  userId: Schema.String,
  sealedBody: Schema.String,
  observedAt: Schema.Number,
});

const upsertSnapshot = SqlSchema.void({
  Request: RosterSnapshotWriteSchema,
  execute: (write) =>
    statement(
      (sql) => sql`
        insert into roster_snapshot (user_id, sealed_body, observed_at)
        values (${write.userId}, ${write.sealedBody}, ${write.observedAt})
        on conflict (user_id) do update
          set sealed_body = excluded.sealed_body, observed_at = excluded.observed_at
      `,
    ),
});

export function writeRosterSnapshot(
  seal: UserSeal,
  userId: string,
  snapshot: RosterSnapshotRecord,
): Effect.Effect<void, RosterFailure, SqlClient.SqlClient> {
  return upsertSnapshot({
    userId,
    sealedBody: seal.seal(snapshot.body),
    observedAt: snapshot.observedAt,
  });
}

const lockObservationPass = (userId: string) =>
  statement(
    (sql) => sql`select user_id from observation_pass where user_id = ${userId} for update`,
  );

const RosterDiffWriteSchema = Schema.Struct({
  userId: Schema.String,
  id: Schema.String,
  observedAt: Schema.Number,
  previousObservedAt: Schema.Number,
  sealedPayload: Schema.String,
});

const RosterDiffIdRowSchema = Schema.Struct({ id: Schema.String });

const insertDiffRow = SqlSchema.findAll({
  Request: RosterDiffWriteSchema,
  Result: RosterDiffIdRowSchema,
  execute: (write) =>
    statement(
      (sql) => sql`
        insert into roster_diff (user_id, id, observed_at, previous_observed_at, sealed_payload)
        values (${write.userId}, ${write.id}, ${write.observedAt}, ${write.previousObservedAt}, ${write.sealedPayload})
        on conflict (user_id, id) do nothing
        returning id
      `,
    ),
});

const deleteConsumedDiffs = SqlSchema.void({
  Request: Schema.String,
  execute: (userId) =>
    statement(
      (sql) => sql`delete from roster_diff where user_id = ${userId} and consumed_at is not null`,
    ),
});

const findKeptDiffIds = SqlSchema.findAll({
  Request: Schema.String,
  Result: RosterDiffIdRowSchema,
  execute: (userId) =>
    statement(
      (sql) => sql`
        select id from roster_diff
        where user_id = ${userId} and consumed_at is null
        order by observed_at desc, id desc
        limit ${MAXIMUM_PENDING_ROSTER_DIFFS}
      `,
    ),
});

const pruneDiffsBeyondBound = (userId: string, keptIds: readonly string[]) =>
  statement(
    (sql) => sql`
      delete from roster_diff
      where user_id = ${userId} and consumed_at is null and not (${sql.in("id", keptIds)})
    `,
  );

/**
 * Records one diff and holds the user's pending diffs to the bound, oldest
 * going first; a consumed diff has been read and is dropped on the next
 * insert rather than kept. An id already recorded is one diff.
 */
function insertRosterDiff(
  seal: UserSeal,
  userId: string,
  diff: RosterDiffInsert,
): Effect.Effect<boolean, RosterFailure, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const inserted = yield* insertDiffRow({
      userId,
      id: diff.id,
      observedAt: diff.observedAt,
      previousObservedAt: diff.previousObservedAt,
      sealedPayload: seal.seal(diff.payload),
    });
    yield* deleteConsumedDiffs(userId);
    const kept = yield* findKeptDiffIds(userId);
    yield* pruneDiffsBeyondBound(
      userId,
      kept.map((row) => row.id),
    );
    return inserted.length > 0;
  });
}

/**
 * Replaces the snapshot and records the diff the pass read against the one
 * it replaced, in one transaction, so no reader finds a new snapshot with
 * no diff behind it or a diff ahead of the snapshot it describes. The write
 * is a compare-and-set on the instant of the snapshot the pass read: under
 * the user's pass row lock it checks that the snapshot standing is still
 * the one the diff was taken against, and answers false without writing
 * when another pass — the schedule, a fresh read, a seeding action — landed
 * first, so one transition is recorded once however many passes saw it. A
 * pass that found nothing changed hands no diff and only the snapshot moves.
 */
export function advanceRosterSnapshot(
  seal: UserSeal,
  userId: string,
  snapshot: RosterSnapshotRecord,
  diff: RosterDiffInsert | undefined,
  previousObservedAt: number | undefined,
): Effect.Effect<boolean, RosterFailure, SqlClient.SqlClient> {
  return Effect.flatMap(SqlClient.SqlClient, (sql) =>
    sql.withTransaction(
      Effect.gen(function* () {
        yield* lockObservationPass(userId);
        const standing = yield* rosterSnapshotObservedAt(userId);
        if (standing !== previousObservedAt) return false;
        yield* writeRosterSnapshot(seal, userId, snapshot);
        if (diff !== undefined) yield* insertRosterDiff(seal, userId, diff);
        return true;
      }),
    ),
  );
}

const RosterDiffRowSchema = Schema.Struct({
  id: Schema.String,
  observedAt: Schema.propertySignature(EpochMillisColumnSchema).pipe(Schema.fromKey("observed_at")),
  previousObservedAt: Schema.propertySignature(EpochMillisColumnSchema).pipe(
    Schema.fromKey("previous_observed_at"),
  ),
  sealedPayload: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("sealed_payload")),
});

const findPendingDiffs = SqlSchema.findAll({
  Request: Schema.String,
  Result: RosterDiffRowSchema,
  execute: (userId) =>
    statement(
      (sql) => sql`
        select id, observed_at, previous_observed_at, sealed_payload
        from roster_diff
        where user_id = ${userId} and consumed_at is null
        order by observed_at asc, id asc
      `,
    ),
});

/** The diffs still waiting to be consumed, oldest first; a row the ring cannot open is dropped, not the list. */
export function listPendingRosterDiffs(
  seal: UserSeal,
  userId: string,
): Effect.Effect<readonly RosterDiffRecord[], RosterFailure, SqlClient.SqlClient> {
  return Effect.map(findPendingDiffs(userId), (rows) =>
    rows.flatMap((row) => {
      let payload: string;
      try {
        payload = seal.open(row.sealedPayload);
      } catch {
        return [];
      }
      return [
        {
          id: row.id,
          observedAt: row.observedAt,
          previousObservedAt: row.previousObservedAt,
          payload,
        },
      ];
    }),
  );
}

const ConsumeDiffSchema = Schema.Struct({
  userId: Schema.String,
  id: Schema.String,
  now: Schema.Number,
});

const consumeDiffRow = SqlSchema.findAll({
  Request: ConsumeDiffSchema,
  Result: RosterDiffIdRowSchema,
  execute: (write) =>
    statement(
      (sql) => sql`
        update roster_diff set consumed_at = ${write.now}
        where user_id = ${write.userId} and id = ${write.id} and consumed_at is null
        returning id
      `,
    ),
});

/** Marks one diff read; only a diff still pending can be, and only once. */
export function consumeRosterDiff(
  userId: string,
  id: string,
  now: number,
): Effect.Effect<boolean, RosterFailure, SqlClient.SqlClient> {
  return Effect.map(consumeDiffRow({ userId, id, now }), (rows) => rows.length > 0);
}

const ObservationPassRowSchema = Schema.Struct({
  attemptedAt: Schema.propertySignature(EpochMillisColumnSchema).pipe(
    Schema.fromKey("attempted_at"),
  ),
  observedAt: Schema.propertySignature(Schema.NullOr(EpochMillisColumnSchema)).pipe(
    Schema.fromKey("observed_at"),
  ),
  failure: Schema.propertySignature(Schema.NullOr(Schema.String)).pipe(Schema.fromKey("failure")),
});

const findObservationPass = SqlSchema.findOne({
  Request: Schema.String,
  Result: ObservationPassRowSchema,
  execute: (userId) =>
    statement(
      (sql) =>
        sql`select attempted_at, observed_at, failure from observation_pass where user_id = ${userId}`,
    ),
});

export function readObservationPass(
  userId: string,
): Effect.Effect<ObservationPassRecord | undefined, RosterFailure, SqlClient.SqlClient> {
  return Effect.map(
    findObservationPass(userId),
    Option.match({
      onNone: () => undefined,
      onSome: (row) => ({
        attemptedAt: row.attemptedAt,
        ...(row.observedAt !== null ? { observedAt: row.observedAt } : undefined),
        ...(row.failure !== null ? { failure: row.failure } : undefined),
      }),
    }),
  );
}

const ObservationPassWriteSchema = Schema.Struct({
  userId: Schema.String,
  attemptedAt: Schema.Number,
  observedAt: Schema.NullOr(Schema.Number),
  failure: Schema.NullOr(Schema.String),
});

const upsertObservationPass = SqlSchema.void({
  Request: ObservationPassWriteSchema,
  execute: (write) =>
    statement(
      (sql) => sql`
        insert into observation_pass (user_id, attempted_at, observed_at, failure)
        values (${write.userId}, ${write.attemptedAt}, ${write.observedAt}, ${write.failure})
        on conflict (user_id) do update
          set attempted_at = excluded.attempted_at,
              failure = excluded.failure,
              observed_at = coalesce(excluded.observed_at, observation_pass.observed_at)
          where observation_pass.attempted_at <= excluded.attempted_at
      `,
    ),
});

/**
 * Records how a pass went. A whole read moves both instants and clears the
 * failure; a failed one moves the attempt, names the failure, and leaves the
 * last whole read standing, since that is still when the snapshot is from —
 * `coalesce` is what leaves it standing on the row already there. The record
 * only ever moves forward: an attempt older than the one on record — a pass
 * that ran long and reports after a later one — writes nothing, so no writer
 * can put an account back at the head of the schedule's order.
 */
export function recordObservationPass(
  userId: string,
  attempt: { attemptedAt: number; failure?: string },
): Effect.Effect<void, RosterFailure, SqlClient.SqlClient> {
  const failure = attempt.failure ?? null;
  const observedAt = failure === null ? attempt.attemptedAt : null;
  return upsertObservationPass({ userId, attemptedAt: attempt.attemptedAt, observedAt, failure });
}

function ineligibleWhere(sql: SqlClient.SqlClient, eligibility: ObservationEligibility) {
  return sql`
    (
      user_id not in (select user_id from provider_key where ${sql.in("provider_id", eligibility.providerIds)})
      or user_id not in (select user_id from devices where last_seen_at >= ${new Date(eligibility.seenAfter)})
    )
    ${eligibility.userIds !== undefined ? sql`and ${sql.in("user_id", eligibility.userIds)}` : sql``}
  `;
}

/**
 * Drops everything the scheduled observation keeps for every user it no
 * longer runs for — no key to one of the named providers, or no device seen
 * since the instant: the snapshot, the waiting diffs, and the pass record go
 * together, so a user whose key or account went, or who has not been seen
 * within the window, stops being observed and keeps no roster on record.
 */
export function forgetObservationIneligible(
  eligibility: ObservationEligibility,
): Effect.Effect<void, RosterFailure, SqlClient.SqlClient> {
  return statement((sql) =>
    sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`delete from roster_snapshot where ${ineligibleWhere(sql, eligibility)}`;
        yield* sql`delete from roster_diff where ${ineligibleWhere(sql, eligibility)}`;
        yield* sql`delete from observation_pass where ${ineligibleWhere(sql, eligibility)}`;
      }),
    ),
  ).pipe(Effect.asVoid);
}
