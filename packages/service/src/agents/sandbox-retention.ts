/**
 * sandbox-retention.ts -- a sandbox opened before its snapshot retention was bounded brought onto the bound, without losing the snapshot it resumes from.
 *
 * A coding agent's sandbox opens with `CODER.SANDBOX_SNAPSHOTS` as its
 * retention, the newest snapshot alone, kept a week. A sandbox opened before
 * that kept every snapshot each stop wrote, for thirty days, and one opened
 * between kept the newest for thirty; Vercel keeps a sandbox's retention as
 * it was opened with, so each such sandbox goes on adding to the bill at
 * every stop. Vercel's documented "Update a sandbox"
 * (https://vercel.com/docs/rest-api/sandboxes/update-a-sandbox) sets the
 * retention of a sandbox already open, and this sets the bound on any that
 * does not stand at it: a running one as it is kept alive
 * (`session-sandboxes.ts`'s `keepAliveFor`), a stopped one from the
 * scheduled sweep (`maintenance/sandbox-retention-sweep.ts`).
 *
 * Note what Vercel's pages leave unsaid, and what was observed of it on a
 * throwaway sandbox of Luke's own on 2026-10-22: the update evicts at once,
 * keeping the newest snapshots by when they were made and deleting the rest,
 * whichever one the sandbox resumes from (`currentSnapshotId`); and it leaves
 * the expiry of each snapshot it keeps as it was, so the week applies from
 * the sandbox's next stop on. So the update is made only where the snapshot
 * the sandbox resumes from is its newest, and still usable, and that
 * snapshot is looked up again after it. One found gone is logged: the
 * sandbox's next resume answers that its snapshot is gone, and the session
 * goes on in a fresh sandbox, as for any expired snapshot (eve's own open,
 * and `coder-host/runner-sessions.ts` for a native agent). Nothing here ever
 * fails its caller: a step Vercel did not confirm is logged by its status,
 * and the next keep-alive or sweep tries again.
 */

import { Duration, Effect } from "effect";
import { CODER } from "./coder-host/bounds.js";
import type { ListedSandbox, SnapshotRetention, VercelSandboxApi } from "./vercel-sandbox-api.js";

/** The retention every coding agent's sandbox stands at, as Vercel's update takes it. */
const SANDBOX_RETENTION: SnapshotRetention & { readonly deleteEvicted: boolean } = {
  count: CODER.SANDBOX_SNAPSHOTS.count,
  expiration: Duration.toMillis(CODER.SANDBOX_SNAPSHOTS.expiration),
  deleteEvicted: CODER.SANDBOX_SNAPSHOTS.deleteEvicted,
};

/** How bringing one sandbox onto the bound ended. */
export const RETENTION_ENDING = {
  /** It stood at the bound already, and nothing was asked. */
  STOOD: "stood",
  /** The bound was set and the snapshot it resumes from still stands. */
  APPLIED: "applied",
  /** Left as it is: the snapshot it resumes from is not its newest, which the update would delete. */
  SKIPPED: "skipped",
  /** The bound was set, and the snapshot it resumes from was then found gone. */
  LOST: "lost",
  /** Vercel did not confirm a step, so it is left for the next try. */
  FAILED: "failed",
} as const;

export type RetentionEnding = (typeof RETENTION_ENDING)[keyof typeof RETENTION_ENDING];

/** The calls bringing a sandbox onto the bound makes. */
type RetentionApi = Pick<VercelSandboxApi, "newestSnapshot" | "updateRetention" | "snapshotExists">;

/** Whether the sandbox's retention is the bound already; one Vercel names without `deleteEvicted` has its documented default, true. */
export function retentionStands(sandbox: ListedSandbox): boolean {
  const kept = sandbox.keepLastSnapshots;
  return (
    kept !== undefined &&
    kept !== null &&
    kept.count === SANDBOX_RETENTION.count &&
    kept.expiration === SANDBOX_RETENTION.expiration &&
    (kept.deleteEvicted ?? true) === SANDBOX_RETENTION.deleteEvicted
  );
}

/**
 * Whether the update may be made: where the sandbox resumes from no
 * snapshot nothing can be lost; otherwise the snapshot it resumes from must
 * be the newest it made, and usable, since the update keeps the newest.
 */
const resumesFromNewest = (api: RetentionApi, sandbox: ListedSandbox) =>
  sandbox.currentSnapshotId === undefined
    ? Effect.succeed(true)
    : Effect.map(
        api.newestSnapshot(sandbox.name),
        (newest) => newest?.usable === true && newest.id === sandbox.currentSnapshotId,
      );

/** The update made and its snapshot looked up again; a lookup Vercel did not answer is logged and counted as applied, since the update went through. */
const appliedKeeping = (api: RetentionApi, sandbox: ListedSandbox) =>
  Effect.gen(function* () {
    yield* api.updateRetention(sandbox.name, SANDBOX_RETENTION);
    const current = sandbox.currentSnapshotId;
    if (current === undefined) return RETENTION_ENDING.APPLIED;
    const stands = yield* api
      .snapshotExists(current)
      .pipe(
        Effect.catch((failure) =>
          Effect.as(
            Effect.logWarning(
              `a sandbox's snapshot was not looked up after its retention was set: ${failure.message}`,
            ),
            true,
          ),
        ),
      );
    if (stands) return RETENTION_ENDING.APPLIED;
    yield* Effect.logWarning(
      "a sandbox's retention update took the snapshot it resumes from; its next resume opens a fresh sandbox",
    );
    return RETENTION_ENDING.LOST;
  });

/**
 * The sandbox brought onto the bound where it does not stand at it, as the
 * file's header says; answers how that ended, and never fails.
 */
export function boundSnapshotRetention(
  api: RetentionApi,
  sandbox: ListedSandbox,
): Effect.Effect<RetentionEnding> {
  if (retentionStands(sandbox)) return Effect.succeed(RETENTION_ENDING.STOOD);
  return Effect.gen(function* () {
    if (!(yield* resumesFromNewest(api, sandbox))) {
      yield* Effect.logInfo(
        "a sandbox's retention was left unbounded: the snapshot it resumes from is not its newest",
      );
      return RETENTION_ENDING.SKIPPED;
    }
    return yield* appliedKeeping(api, sandbox);
  }).pipe(
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning(`a sandbox's snapshot retention was not set: ${failure.message}`),
        RETENTION_ENDING.FAILED,
      ),
    ),
  );
}
