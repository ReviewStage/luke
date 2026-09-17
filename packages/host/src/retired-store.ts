import { Cause, Effect, Path } from "effect";
import * as FileSystem from "effect/FileSystem";

/**
 * What an earlier build kept under the agent's directory and this one never
 * opens: the SQLite database of the local brain's conversations, working
 * memory, notebook, and index, the write-ahead log and shared-memory file
 * SQLite keeps beside it, and the recovery archives of deleted
 * conversations. Nothing here is migrated; the hosted brain's record is the
 * account's and starts clean. The names are the ones the retired store wrote.
 */
const RETIRED_STORE_ENTRY = {
  DATABASE: "agent.sqlite",
  WRITE_AHEAD_LOG: "agent.sqlite-wal",
  SHARED_MEMORY: "agent.sqlite-shm",
  ARCHIVES: "archives",
} as const;

type RetiredStoreEntry = (typeof RETIRED_STORE_ENTRY)[keyof typeof RETIRED_STORE_ENTRY];

/** The entries under the agent's directory a launch removes, in the order it removes them. */
const RETIRED_STORE_ENTRIES: readonly RetiredStoreEntry[] = [
  RETIRED_STORE_ENTRY.DATABASE,
  RETIRED_STORE_ENTRY.WRITE_AHEAD_LOG,
  RETIRED_STORE_ENTRY.SHARED_MEMORY,
  RETIRED_STORE_ENTRY.ARCHIVES,
];

interface RemoveRetiredStoreOptions {
  /** The agent's own directory under Luke's application data. */
  agentRoot: string;
  report: (message: string) => void;
}

/**
 * Removes the retired store's entries from the agent's directory, each on
 * its own: an entry that is not there is nothing to do, and one that cannot
 * be removed is reported and left for the next launch, without stopping the
 * others or the launch. The workspace and skills beside them are untouched.
 * Stateless by design: every launch looks, so no marker has to record that
 * one did. The machine's file system is the ambient `FileSystem` service.
 */
export const removeRetiredStore = (
  options: RemoveRetiredStoreOptions,
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* Effect.forEach(
      RETIRED_STORE_ENTRIES,
      (entry) => {
        const target = path.join(options.agentRoot, entry);
        return Effect.catchCause(
          fileSystem.remove(target, { recursive: true, force: true }),
          (cause) =>
            Effect.sync(() => {
              options.report(
                `The retired conversation store could not be removed at ${target}: ${Cause.pretty(cause)}`,
              );
            }),
        );
      },
      { discard: true },
    );
  });
