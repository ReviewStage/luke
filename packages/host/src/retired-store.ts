import { DEFAULT_AGENT_ID } from "@repo/runtime/vocabulary";
import { Cause, Effect, Path } from "effect";
import * as FileSystem from "effect/FileSystem";

const AGENTS_DIRECTORY = "agents";

const RETIRED_STORE_ENTRY = {
  DATABASE: "agent.sqlite",
  WRITE_AHEAD_LOG: "agent.sqlite-wal",
  SHARED_MEMORY: "agent.sqlite-shm",
  ARCHIVES: "archives",
} as const;

type RetiredStoreEntry = (typeof RETIRED_STORE_ENTRY)[keyof typeof RETIRED_STORE_ENTRY];

const RETIRED_STORE_ENTRIES: readonly RetiredStoreEntry[] = [
  RETIRED_STORE_ENTRY.DATABASE,
  RETIRED_STORE_ENTRY.WRITE_AHEAD_LOG,
  RETIRED_STORE_ENTRY.SHARED_MEMORY,
  RETIRED_STORE_ENTRY.ARCHIVES,
];

interface RemoveRetiredStoreOptions {
  stateRoot: string;
  report: (message: string) => void;
}

export const removeRetiredStore = (
  options: RemoveRetiredStoreOptions,
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const agentRoot = path.join(options.stateRoot, AGENTS_DIRECTORY, DEFAULT_AGENT_ID);
    yield* Effect.forEach(
      RETIRED_STORE_ENTRIES,
      (entry) => {
        const target = path.join(agentRoot, entry);
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
