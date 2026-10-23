/**
 * retired-browser-partition.ts -- clears, once, what the retired local Browser tab left on the Mac: its `persist:browser` partition's cookies, storage, and cache.
 */

import { Cause, Effect, Path } from "effect";
import * as FileSystem from "effect/FileSystem";

/**
 * Where Electron keeps a persistent partition's data under the session's
 * root: `Partitions/<name>`, the retired tab's being `persist:browser`.
 */
const PARTITION_DIRECTORY = ["Partitions", "browser"] as const;

/**
 * The marker under the state root that says the partition was cleared, or
 * never used, so a later launch leaves it be. Written once the clear lands,
 * never before, so a launch quit or failed mid-clear clears again.
 */
const CLEARED_MARKER = "retired-browser-tab.json";

/** The marker's body: a record of what was done, read by nothing but its presence. */
const CLEARED_RECORD = `${JSON.stringify({ cleared: true })}\n`;

/** The retired tab's partition as Electron opens it: its stored data and its cache, each cleared as a promise. */
export interface RetiredBrowserPartition {
  clearStorageData(): Promise<void>;
  clearCache(): Promise<void>;
}

interface ClearRetiredBrowserPartitionOptions {
  /** Luke's own application-state root, which is also Electron's session root. */
  stateRoot: string;
  /** Opens the partition, called only where its directory stands, so a partition never used is never made. */
  openPartition: () => RetiredBrowserPartition;
  report: (message: string) => void;
}

/**
 * Clears the retired local Browser tab's partition once: its cookies and
 * storage, then its cache, so nothing the tab signed in to stays on disk.
 * A launch that finds the marker does nothing; one that finds no partition
 * directory writes the marker without opening the partition, since opening
 * it would make the directory it then clears; and a clear that fails is
 * reported and left for the next launch, without stopping this one. The
 * machine's file system is the ambient `FileSystem` service.
 */
export const clearRetiredBrowserPartition = (
  options: ClearRetiredBrowserPartitionOptions,
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const marker = path.join(options.stateRoot, CLEARED_MARKER);
    if (yield* fileSystem.exists(marker)) return;
    if (yield* fileSystem.exists(path.join(options.stateRoot, ...PARTITION_DIRECTORY))) {
      const partition = options.openPartition();
      yield* Effect.tryPromise(() => partition.clearStorageData());
      yield* Effect.tryPromise(() => partition.clearCache());
    }
    yield* fileSystem.writeFileString(marker, CLEARED_RECORD);
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.sync(() => {
        options.report(
          `The retired Browser tab's data could not be cleared: ${Cause.pretty(cause)}`,
        );
      }),
    ),
  );
