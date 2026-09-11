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

const ConsumedRosterRowSchema = Schema.Struct({
  sealedBody: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("sealed_body")),
  observedAt: Schema.propertySignature(EpochMillisColumnSchema).pipe(Schema.fromKey("observed_at")),
});

const findConsumedRoster = SqlSchema.findOne({
  Request: Schema.String,
  Result: ConsumedRosterRowSchema,
  execute: (userId) =>
    statement(
      (sql) => sql`select sealed_body, observed_at from roster_consumed where user_id = ${userId}`,
    ),
});

/** How the opener's bookmark stands: none yet, one this build cannot open, or one opened whole. */
export const CONSUMED_ROSTER = {
  ABSENT: "absent",
  UNREADABLE: "unreadable",
  STANDING: "standing",
} as const;

export type ConsumedRosterRead =
  | { readonly state: typeof CONSUMED_ROSTER.ABSENT }
  /** A row stands that this seal cannot open; its instant is what a replacement must be kept over. */
  | { readonly state: typeof CONSUMED_ROSTER.UNREADABLE; readonly observedAt: number }
  | { readonly state: typeof CONSUMED_ROSTER.STANDING; readonly roster: RosterSnapshotRecord };

/**
 * The roster as of the last change the opener handed the brain. A row that
 * stands but cannot be opened is answered as such rather than as absent,
 * because the two call for different writes: an absent bookmark is first
 * kept where none stands, while an unreadable one must be replaced over its
 * own instant, or the replacement loses to the row it meant to replace and
 * every later visit adopts in silence.
 */
export function readConsumedRoster(
  seal: UserSeal,
  userId: string,
): Effect.Effect<ConsumedRosterRead, RosterFailure, SqlClient.SqlClient> {
  return Effect.map(findConsumedRoster(userId), (row) => {
    if (Option.isNone(row)) return { state: CONSUMED_ROSTER.ABSENT };
    try {
      return {
        state: CONSUMED_ROSTER.STANDING,
        roster: { body: seal.open(row.value.sealedBody), observedAt: row.value.observedAt },
      };
    } catch {
      return { state: CONSUMED_ROSTER.UNREADABLE, observedAt: row.value.observedAt };
    }
  });
}

const ConsumedRosterWriteSchema = Schema.Struct({
  userId: Schema.String,
  sealedBody: Schema.String,
  observedAt: Schema.Number,
});

const KeptRowSchema = Schema.Struct({
  userId: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("user_id")),
});

/** A first bookmark: lands only where none stands. */
const insertConsumedRoster = SqlSchema.findAll({
  Request: ConsumedRosterWriteSchema,
  Result: KeptRowSchema,
  execute: (write) =>
    statement(
      (sql) => sql`
        insert into roster_consumed (user_id, sealed_body, observed_at)
        values (${write.userId}, ${write.sealedBody}, ${write.observedAt})
        on conflict (user_id) do nothing
        returning user_id
      `,
    ),
});

/** A later bookmark: lands only over the one observed at `from`. */
const updateConsumedRoster = SqlSchema.findAll({
  Request: Schema.Struct({ ...ConsumedRosterWriteSchema.fields, from: Schema.Number }),
  Result: KeptRowSchema,
  execute: (write) =>
    statement(
      (sql) => sql`
        update roster_consumed
        set sealed_body = ${write.sealedBody}, observed_at = ${write.observedAt}
        where user_id = ${write.userId} and observed_at = ${write.from}
        returning user_id
      `,
    ),
});

/**
 * Moves the brain's bookmark over the roster, and only over the one the
 * read began from: a compare-and-set on the consumed roster's instant, so a
 * tick that ran long cannot put a later tick's bookmark back, and a first
 * bookmark lands only where none stands. Answers whether it landed; a keep
 * that did not leaves the change to re-derive on the next visit, which is
 * the direction this bookmark fails in.
 */
export function keepConsumedRoster(
  seal: UserSeal,
  userId: string,
  roster: RosterSnapshotRecord,
  from: number | undefined,
): Effect.Effect<boolean, RosterFailure, SqlClient.SqlClient> {
  const write = { userId, sealedBody: seal.seal(roster.body), observedAt: roster.observedAt };
  return Effect.map(
    from === undefined ? insertConsumedRoster(write) : updateConsumedRoster({ ...write, from }),
    (rows) => rows.length > 0,
  );
}

/**
 * Replaces the snapshot, in one transaction under the user's pass row lock,
 * only while the snapshot standing is still the one the pass read against:
 * a compare-and-set on the observed-at instant, so one transition is
 * recorded once however many passes saw it. The change itself is not
 * recorded here; the opener derives it against the consumed roster.
 */
export function advanceRosterSnapshot(
  seal: UserSeal,
  userId: string,
  snapshot: RosterSnapshotRecord,
  previousObservedAt: number | undefined,
): Effect.Effect<boolean, RosterFailure, SqlClient.SqlClient> {
  return Effect.flatMap(SqlClient.SqlClient, (sql) =>
    sql.withTransaction(
      Effect.gen(function* () {
        yield* lockObservationPass(userId);
        const standing = yield* rosterSnapshotObservedAt(userId);
        if (standing !== previousObservedAt) return false;
        yield* writeRosterSnapshot(seal, userId, snapshot);
        return true;
      }),
    ),
  );
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
        yield* sql`delete from roster_consumed where ${ineligibleWhere(sql, eligibility)}`;
        yield* sql`delete from observation_pass where ${ineligibleWhere(sql, eligibility)}`;
      }),
    ),
  ).pipe(Effect.asVoid);
}
