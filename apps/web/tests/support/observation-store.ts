import { Effect } from "effect";
import type { ObservationStore } from "../../server/hosted/observation-pass";
import {
  CONSUMED_ROSTER,
  type ObservationPassRecord,
  type RosterSnapshotRecord,
} from "../../server/hosted/store";

/**
 * The roster slice of the hosted store held in memory, for the handler tests
 * that exercise what a pass reads and writes without a database: the
 * snapshot, the opener's bookmark over it, and the pass record. The
 * store tests on PGlite are where the real tables are exercised.
 */
export interface MemoryObservationStore extends ObservationStore {
  snapshots: Map<string, RosterSnapshotRecord>;
  /** The opener's bookmark over the snapshot, as the store keeps it. */
  consumed: Map<string, RosterSnapshotRecord>;
  passes: Map<string, ObservationPassRecord>;
  /** Every `advance` this store took, in order, so a test can see what a pass wrote. */
  advances: Array<{ userId: string; observedAt: number }>;
}

/** A body the fake's `read` refuses to open, standing in for a seal under a key the ring no longer holds. */
export const UNOPENABLE_BODY = "unopenable";

export function memoryObservationStore(): MemoryObservationStore {
  const snapshots = new Map<string, RosterSnapshotRecord>();
  const consumed = new Map<string, RosterSnapshotRecord>();
  const passes = new Map<string, ObservationPassRecord>();
  const advances: MemoryObservationStore["advances"] = [];
  return {
    snapshots,
    consumed,
    passes,
    advances,
    roster: {
      read: (userId) =>
        Effect.sync(() => {
          const snapshot = snapshots.get(userId);
          if (snapshot?.body === UNOPENABLE_BODY) throw new Error("the ring cannot open this body");
          return snapshot;
        }),
      observedAt: (userId) => Effect.sync(() => snapshots.get(userId)?.observedAt),
      write: (userId, snapshot) =>
        Effect.sync(() => {
          snapshots.set(userId, snapshot);
        }),
      advance: (userId, snapshot, previousObservedAt) =>
        Effect.sync(() => {
          if (snapshots.get(userId)?.observedAt !== previousObservedAt) return false;
          snapshots.set(userId, snapshot);
          advances.push({ userId, observedAt: snapshot.observedAt });
          return true;
        }),
      consumed: (userId) =>
        Effect.sync(() => {
          const bookmark = consumed.get(userId);
          if (bookmark === undefined) return { state: CONSUMED_ROSTER.ABSENT };
          if (bookmark.body === UNOPENABLE_BODY) {
            return { state: CONSUMED_ROSTER.UNREADABLE, observedAt: bookmark.observedAt };
          }
          return { state: CONSUMED_ROSTER.STANDING, roster: bookmark };
        }),
      keepConsumed: (userId, roster, from) =>
        Effect.sync(() => {
          if (consumed.get(userId)?.observedAt !== from) return false;
          consumed.set(userId, roster);
          return true;
        }),
      pass: (userId) => Effect.sync(() => passes.get(userId)),
      recordPass: (userId, attempt) =>
        Effect.sync(() => {
          const held = passes.get(userId);
          if (held && held.attemptedAt > attempt.attemptedAt) return;
          passes.set(userId, {
            attemptedAt: attempt.attemptedAt,
            ...(attempt.failure === undefined
              ? { observedAt: attempt.attemptedAt }
              : {
                  failure: attempt.failure,
                  ...(held?.observedAt !== undefined ? { observedAt: held.observedAt } : undefined),
                }),
          });
        }),
      forgetIneligible: () => Effect.void,
    },
  };
}
