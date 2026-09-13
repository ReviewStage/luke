import path from "node:path";

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

export type RetiredStoreEntry = (typeof RETIRED_STORE_ENTRY)[keyof typeof RETIRED_STORE_ENTRY];

/** The entries under the agent's directory a launch removes, in the order it removes them. */
export const RETIRED_STORE_ENTRIES: readonly RetiredStoreEntry[] = [
  RETIRED_STORE_ENTRY.DATABASE,
  RETIRED_STORE_ENTRY.WRITE_AHEAD_LOG,
  RETIRED_STORE_ENTRY.SHARED_MEMORY,
  RETIRED_STORE_ENTRY.ARCHIVES,
];

export interface RemoveRetiredStoreOptions {
  /** The agent's own directory under Luke's application data. */
  agentRoot: string;
  /** Removes one path, file or directory, whether or not it is there; the machine's file system, handed in. */
  remove: (target: string) => Promise<void>;
  report: (message: string) => void;
}

/**
 * Removes the retired store's entries from the agent's directory, each on
 * its own: an entry that is not there is nothing to do, and one that cannot
 * be removed is reported and left for the next launch, without stopping the
 * others or the launch. The workspace and skills beside them are untouched.
 * Stateless by design: every launch looks, so no marker has to record that
 * one did.
 */
export async function removeRetiredStore(options: RemoveRetiredStoreOptions): Promise<void> {
  for (const entry of RETIRED_STORE_ENTRIES) {
    const target = path.join(options.agentRoot, entry);
    try {
      await options.remove(target);
    } catch (error) {
      options.report(
        `The retired conversation store could not be removed at ${target}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
