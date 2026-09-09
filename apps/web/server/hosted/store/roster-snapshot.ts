import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  notInArray,
  or,
} from "drizzle-orm";
import {
  devices,
  observationPass,
  providerKey,
  rosterDiff,
  rosterSnapshot,
} from "../../db/schema.js";
import type { HostedStoreDatabase, UserSeal } from "./database.js";

/**
 * The latest roster an observation pass reported for a user, one row
 * replaced whole on every pass. The body is whatever the pass serialized —
 * titles, branches, error lines — and is sealed; the instant it was observed
 * stands clear, because it is what decides whether the snapshot is current.
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

export async function readRosterSnapshot(
  db: HostedStoreDatabase,
  seal: UserSeal,
  userId: string,
): Promise<RosterSnapshotRecord | undefined> {
  const [row] = await db.select().from(rosterSnapshot).where(eq(rosterSnapshot.userId, userId));
  if (!row) return undefined;
  return { body: seal.open(row.sealedBody), observedAt: row.observedAt };
}

export async function writeRosterSnapshot(
  db: HostedStoreDatabase,
  seal: UserSeal,
  userId: string,
  snapshot: RosterSnapshotRecord,
): Promise<void> {
  const sealedBody = seal.seal(snapshot.body);
  await db
    .insert(rosterSnapshot)
    .values({ userId, sealedBody, observedAt: snapshot.observedAt })
    .onConflictDoUpdate({
      target: rosterSnapshot.userId,
      set: { sealedBody, observedAt: snapshot.observedAt },
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
  db: HostedStoreDatabase,
  seal: UserSeal,
  userId: string,
  snapshot: RosterSnapshotRecord,
  diff: RosterDiffInsert | undefined,
  previousObservedAt: number | undefined,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx
      .select({ userId: observationPass.userId })
      .from(observationPass)
      .where(eq(observationPass.userId, userId))
      .for("update");
    const [standing] = await tx
      .select({ observedAt: rosterSnapshot.observedAt })
      .from(rosterSnapshot)
      .where(eq(rosterSnapshot.userId, userId));
    if (standing?.observedAt !== previousObservedAt) return false;
    await writeRosterSnapshot(tx, seal, userId, snapshot);
    if (diff) await insertRosterDiff(tx, seal, userId, diff);
    return true;
  });
}

/**
 * Records one diff and holds the user's pending diffs to the bound, oldest
 * going first; a consumed diff has been read and is dropped on the next
 * insert rather than kept. An id already recorded is one diff.
 */
export async function insertRosterDiff(
  db: HostedStoreDatabase,
  seal: UserSeal,
  userId: string,
  diff: RosterDiffInsert,
): Promise<boolean> {
  const inserted = await db
    .insert(rosterDiff)
    .values({
      userId,
      id: diff.id,
      observedAt: diff.observedAt,
      previousObservedAt: diff.previousObservedAt,
      sealedPayload: seal.seal(diff.payload),
    })
    .onConflictDoNothing()
    .returning({ id: rosterDiff.id });
  await db
    .delete(rosterDiff)
    .where(and(eq(rosterDiff.userId, userId), isNotNull(rosterDiff.consumedAt)));
  const kept = await db
    .select({ id: rosterDiff.id })
    .from(rosterDiff)
    .where(and(eq(rosterDiff.userId, userId), isNull(rosterDiff.consumedAt)))
    .orderBy(desc(rosterDiff.observedAt), desc(rosterDiff.id))
    .limit(MAXIMUM_PENDING_ROSTER_DIFFS);
  await db.delete(rosterDiff).where(
    and(
      eq(rosterDiff.userId, userId),
      isNull(rosterDiff.consumedAt),
      notInArray(
        rosterDiff.id,
        kept.map((row) => row.id),
      ),
    ),
  );
  return inserted.length > 0;
}

/** The diffs still waiting to be consumed, oldest first; a row the ring cannot open is dropped, not the list. */
export async function listPendingRosterDiffs(
  db: HostedStoreDatabase,
  seal: UserSeal,
  userId: string,
): Promise<readonly RosterDiffRecord[]> {
  const rows = await db
    .select()
    .from(rosterDiff)
    .where(and(eq(rosterDiff.userId, userId), isNull(rosterDiff.consumedAt)))
    .orderBy(asc(rosterDiff.observedAt), asc(rosterDiff.id));
  return rows.flatMap((row) => {
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
  });
}

/** Marks one diff read; only a diff still pending can be, and only once. */
export async function consumeRosterDiff(
  db: HostedStoreDatabase,
  userId: string,
  id: string,
  now: number,
): Promise<boolean> {
  const consumed = await db
    .update(rosterDiff)
    .set({ consumedAt: now })
    .where(and(eq(rosterDiff.userId, userId), eq(rosterDiff.id, id), isNull(rosterDiff.consumedAt)))
    .returning({ id: rosterDiff.id });
  return consumed.length > 0;
}

export async function readObservationPass(
  db: HostedStoreDatabase,
  userId: string,
): Promise<ObservationPassRecord | undefined> {
  const [row] = await db.select().from(observationPass).where(eq(observationPass.userId, userId));
  if (!row) return undefined;
  return {
    attemptedAt: row.attemptedAt,
    ...(row.observedAt !== null ? { observedAt: row.observedAt } : undefined),
    ...(row.failure !== null ? { failure: row.failure } : undefined),
  };
}

/**
 * Records how a pass went. A whole read moves both instants and clears the
 * failure; a failed one moves the attempt, names the failure, and leaves the
 * last whole read standing, since that is still when the snapshot is from.
 * The record only ever moves forward: an attempt older than the one on
 * record — a pass that ran long and reports after a later one — writes
 * nothing, so no writer can put an account back at the head of the
 * schedule's order.
 */
export async function recordObservationPass(
  db: HostedStoreDatabase,
  userId: string,
  attempt: { attemptedAt: number; failure?: string },
): Promise<void> {
  const failure = attempt.failure ?? null;
  const observedAt = failure === null ? attempt.attemptedAt : undefined;
  await db
    .insert(observationPass)
    .values({
      userId,
      attemptedAt: attempt.attemptedAt,
      observedAt: observedAt ?? null,
      failure,
    })
    .onConflictDoUpdate({
      target: observationPass.userId,
      set: {
        attemptedAt: attempt.attemptedAt,
        failure,
        ...(observedAt !== undefined ? { observedAt } : undefined),
      },
      setWhere: lte(observationPass.attemptedAt, attempt.attemptedAt),
    });
}

/** Who the scheduled observation still runs for: a key to one of the providers, and an account seen since the instant. */
export interface ObservationEligibility {
  readonly providerIds: readonly string[];
  /** The earliest device last-seen instant that still counts as the account being in use. */
  readonly seenAfter: number;
}

/**
 * Drops everything the scheduled observation keeps for every user it no
 * longer runs for — no key to one of the named providers, or no device seen
 * since the instant: the snapshot, the waiting diffs, and the pass record go
 * together, so a user whose key or account went, or who has not been seen
 * within the window, stops being observed and keeps no roster on record.
 */
export async function forgetObservationIneligible(
  db: HostedStoreDatabase,
  eligibility: ObservationEligibility,
): Promise<void> {
  const keyed = db
    .select({ userId: providerKey.userId })
    .from(providerKey)
    .where(inArray(providerKey.providerId, eligibility.providerIds));
  const seen = db
    .select({ userId: devices.userId })
    .from(devices)
    .where(gte(devices.lastSeenAt, new Date(eligibility.seenAfter)));
  await db.transaction(async (tx) => {
    await tx
      .delete(rosterSnapshot)
      .where(or(notInArray(rosterSnapshot.userId, keyed), notInArray(rosterSnapshot.userId, seen)));
    await tx
      .delete(rosterDiff)
      .where(or(notInArray(rosterDiff.userId, keyed), notInArray(rosterDiff.userId, seen)));
    await tx
      .delete(observationPass)
      .where(
        or(notInArray(observationPass.userId, keyed), notInArray(observationPass.userId, seen)),
      );
  });
}
