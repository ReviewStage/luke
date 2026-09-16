import { Effect } from "effect";
import type { ObservationStore } from "../../server/hosted/observation-pass";
import type { RosterSnapshotRecord } from "../../server/hosted/store";
import type { ObservationPassRecord } from "../../server/hosted/store/roster-snapshot";

/**
 * The roster slice of the hosted store held in memory, for the handler tests
 * that exercise what a pass reads and writes without a database: the
 * snapshot, the opener's transcript mark, and the pass record. The
 * store tests on PGlite are where the real tables are exercised.
 */
export interface MemoryObservationStore extends ObservationStore {
  snapshots: Map<string, RosterSnapshotRecord>;
  /** The opener's transcript mark, as the store keeps it. */
  marks: Map<string, number>;
  passes: Map<string, ObservationPassRecord>;
  /** Every `advance` this store took, in order, so a test can see what a pass wrote. */
  advances: Array<{ userId: string; observedAt: number }>;
}

/** A body the fake's `read` refuses to open, standing in for a seal under a key the ring no longer holds. */
export const UNOPENABLE_BODY = "unopenable";

export function memoryObservationStore(): MemoryObservationStore {
  const snapshots = new Map<string, RosterSnapshotRecord>();
  const marks = new Map<string, number>();
  const passes = new Map<string, ObservationPassRecord>();
  const advances: MemoryObservationStore["advances"] = [];
  return {
    snapshots,
    marks,
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
      mark: (userId) => Effect.sync(() => marks.get(userId)),
      keepMark: (userId, mark, from) =>
        Effect.sync(() => {
          if (marks.get(userId) !== from) return false;
          marks.set(userId, mark);
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
