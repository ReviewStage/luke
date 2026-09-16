import { eq, gte, inArray, lte, notInArray, or, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { devices } from "../../db/devices-schema.js";
import { db } from "../../db/query.js";
import { observationPass, rosterSnapshot, transcriptMark } from "../../db/roster-schema.js";
import { providerKey } from "../../db/vault-schema.js";
import { EpochMillisColumnSchema, type UserSeal } from "./database.js";

/**
 * The latest roster an observation pass reported for a user, one row
 * replaced whole on every pass. The body is whatever the pass serialized —
 * titles, branches, error lines — and is sealed; the instant it was observed
 * stands clear, because it is what decides whether the snapshot is current.
 *
 * Every function here is an `Effect<A, SqlError | Schema.SchemaError,
 * SqlClient.SqlClient>` over `effect/unstable/sql`, its statement a Drizzle
 * builder over the tables `db/roster-schema.ts` declares.
 */
export interface RosterSnapshotRecord {
  readonly body: string;
  readonly observedAt: number;
}

/** How the last scheduled pass went for a user: when it was tried, when it last read whole, and why it failed if it did. */
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
}

/** How a statement here fails: the driver's own refusal, or a row this build could not decode. */
type RosterFailure = SqlError | Schema.SchemaError;

const RosterSnapshotRowSchema = Schema.Struct({
  sealedBody: Schema.String,
  observedAt: EpochMillisColumnSchema,
});

const findRosterSnapshot = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: RosterSnapshotRowSchema,
  execute: (userId) =>
    db
      .select({ sealedBody: rosterSnapshot.sealedBody, observedAt: rosterSnapshot.observedAt })
      .from(rosterSnapshot)
      .where(eq(rosterSnapshot.userId, userId)),
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
  observedAt: EpochMillisColumnSchema,
});

const findObservedAt = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: RosterSnapshotObservedAtRowSchema,
  execute: (userId) =>
    db
      .select({ observedAt: rosterSnapshot.observedAt })
      .from(rosterSnapshot)
      .where(eq(rosterSnapshot.userId, userId)),
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

/**
 * Note that the conflicting update sets the values the insert carried rather
 * than reading them back out of `excluded`, because a single-row insert's
 * `excluded` row is exactly those values.
 */
const upsertSnapshot = SqlSchema.void({
  Request: RosterSnapshotWriteSchema,
  execute: (write) =>
    db
      .insert(rosterSnapshot)
      .values({
        userId: write.userId,
        sealedBody: write.sealedBody,
        observedAt: write.observedAt,
      })
      .onConflictDoUpdate({
        target: rosterSnapshot.userId,
        set: { sealedBody: write.sealedBody, observedAt: write.observedAt },
      }),
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
  db
    .select({ userId: observationPass.userId })
    .from(observationPass)
    .where(eq(observationPass.userId, userId))
    .for("update");

/**
 * Replaces the snapshot, in one transaction under the user's pass row lock,
 * only while the snapshot standing is still the one the pass read against:
 * a compare-and-set on the observed-at instant, so one transition is
 * recorded once however many passes saw it. No change is derived from it;
 * the opener wakes on transcript changes, kept under its own mark.
 */
export function advanceRosterSnapshot(
  seal: UserSeal,
  userId: string,
  snapshot: RosterSnapshotRecord,
  previousObservedAt: number | undefined,
): Effect.Effect<boolean, RosterFailure, SqlClient.SqlClient> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
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
  attemptedAt: EpochMillisColumnSchema,
  observedAt: Schema.NullOr(EpochMillisColumnSchema),
  failure: Schema.NullOr(Schema.String),
});

const findObservationPass = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: ObservationPassRowSchema,
  execute: (userId) =>
    db
      .select({
        attemptedAt: observationPass.attemptedAt,
        observedAt: observationPass.observedAt,
        failure: observationPass.failure,
      })
      .from(observationPass)
      .where(eq(observationPass.userId, userId)),
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

/**
 * A failed pass carries no whole read, and the instant of the last one is
 * left standing on the row already there; the builder has no operator for
 * that, so the fallback is a fragment naming the column beside the value the
 * insert carried, still inside the one rendered statement.
 */
const standingObservedAt = (observedAt: number | null) =>
  sql`coalesce(${observedAt}, ${observationPass.observedAt})`;

const upsertObservationPass = SqlSchema.void({
  Request: ObservationPassWriteSchema,
  execute: (write) =>
    db
      .insert(observationPass)
      .values({
        userId: write.userId,
        attemptedAt: write.attemptedAt,
        observedAt: write.observedAt,
        failure: write.failure,
      })
      .onConflictDoUpdate({
        target: observationPass.userId,
        set: {
          attemptedAt: write.attemptedAt,
          failure: write.failure,
          observedAt: standingObservedAt(write.observedAt),
        },
        setWhere: lte(observationPass.attemptedAt, write.attemptedAt),
      }),
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

/**
 * Who the observation no longer runs for, as a predicate over one table's own
 * account column: no key to one of the named providers, or no device seen
 * since the instant. Each half is the account read out of another table, which
 * the builder renders as the subquery it is.
 */
function ineligible(userId: PgColumn, eligibility: ObservationEligibility) {
  return or(
    notInArray(
      userId,
      db
        .select({ userId: providerKey.userId })
        .from(providerKey)
        .where(inArray(providerKey.providerId, [...eligibility.providerIds])),
    ),
    notInArray(
      userId,
      db
        .select({ userId: devices.userId })
        .from(devices)
        .where(gte(devices.lastSeenAt, new Date(eligibility.seenAfter))),
    ),
  );
}

/**
 * Drops everything the scheduled observation keeps for every user it no
 * longer runs for — no key to one of the named providers, or no device seen
 * since the instant: the snapshot, the transcript mark, and the pass record go
 * together, so a user whose key or account went, or who has not been seen
 * within the window, stops being observed and keeps no roster on record.
 */
export function forgetObservationIneligible(
  eligibility: ObservationEligibility,
): Effect.Effect<void, RosterFailure, SqlClient.SqlClient> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        yield* db.delete(rosterSnapshot).where(ineligible(rosterSnapshot.userId, eligibility));
        yield* db.delete(transcriptMark).where(ineligible(transcriptMark.userId, eligibility));
        yield* db.delete(observationPass).where(ineligible(observationPass.userId, eligibility));
      }),
    ),
  );
}
