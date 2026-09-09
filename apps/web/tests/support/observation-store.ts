import type { ObservationStore } from "../../server/hosted/observation-pass";
import type {
  ObservationPassRecord,
  RosterDiffRecord,
  RosterSnapshotRecord,
} from "../../server/hosted/store";
import { MAXIMUM_PENDING_ROSTER_DIFFS } from "../../server/hosted/store";

/**
 * The roster slice of the hosted store held in memory, for the handler tests
 * that exercise what a pass reads and writes without a database: the
 * snapshot, the pending diffs under their bound, and the pass record. The
 * store tests on PGlite are where the real tables are exercised.
 */
export interface MemoryObservationStore extends ObservationStore {
  snapshots: Map<string, RosterSnapshotRecord>;
  diffs: Map<string, RosterDiffRecord[]>;
  passes: Map<string, ObservationPassRecord>;
  /** Every `advance` this store took, in order, so a test can see what a pass wrote. */
  advances: Array<{ userId: string; observedAt: number; diff: boolean }>;
}

export function memoryObservationStore(): MemoryObservationStore {
  const snapshots = new Map<string, RosterSnapshotRecord>();
  const diffs = new Map<string, RosterDiffRecord[]>();
  const passes = new Map<string, ObservationPassRecord>();
  const advances: MemoryObservationStore["advances"] = [];
  return {
    snapshots,
    diffs,
    passes,
    advances,
    roster: {
      read: async (userId) => snapshots.get(userId),
      write: async (userId, snapshot) => {
        snapshots.set(userId, snapshot);
      },
      advance: async (userId, snapshot, diff, previousObservedAt) => {
        if (snapshots.get(userId)?.observedAt !== previousObservedAt) return false;
        snapshots.set(userId, snapshot);
        advances.push({ userId, observedAt: snapshot.observedAt, diff: diff !== undefined });
        if (!diff) return true;
        const pending = (diffs.get(userId) ?? []).filter((one) => one.consumedAt === undefined);
        pending.push({ ...diff });
        diffs.set(userId, pending.slice(-MAXIMUM_PENDING_ROSTER_DIFFS));
        return true;
      },
      pendingDiffs: async (userId) =>
        (diffs.get(userId) ?? []).filter((one) => one.consumedAt === undefined),
      consumeDiff: async (userId, id, now) => {
        const held = diffs.get(userId) ?? [];
        const index = held.findIndex((one) => one.id === id && one.consumedAt === undefined);
        const pending = held[index];
        if (!pending) return false;
        held[index] = { ...pending, consumedAt: now };
        return true;
      },
      pass: async (userId) => passes.get(userId),
      recordPass: async (userId, attempt) => {
        const held = passes.get(userId);
        passes.set(userId, {
          attemptedAt: attempt.attemptedAt,
          ...(attempt.failure === undefined
            ? { observedAt: attempt.attemptedAt }
            : {
                failure: attempt.failure,
                ...(held?.observedAt !== undefined ? { observedAt: held.observedAt } : undefined),
              }),
        });
      },
      forgetIneligible: async () => {},
    },
  };
}
