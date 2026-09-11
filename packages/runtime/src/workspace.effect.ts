/**
 * The identity workspace's files in Effect's own terms. `workspace.ts` is a
 * port of OpenClaw `b7528507` and stays faithful to it — it imports nothing
 * from `effect` — so everything Effect needs of it lives here beside it: an
 * unexpected filesystem failure as a typed error naming which operation hit
 * it, and the refusals `readWorkspaceFile` and `writeWorkspaceFile` already
 * decide, carried as a tagged error over the same `WORKSPACE_FILE_REFUSAL`
 * word the port answers with.
 */
import { Data, Effect } from "effect";
import {
  type BootstrapFile,
  type DailyNote,
  readBootstrapFiles,
  readWorkspaceFile,
  recentDailyNotes,
  seedWorkspace,
  type WORKSPACE_FILE_REFUSAL,
  type WorkspaceFile,
  type WorkspaceSeeding,
  type WorkspaceSeeds,
  writeWorkspaceFile,
} from "./workspace.js";

/** Which operation an unexpected filesystem failure happened during. */
export const WORKSPACE_IO_OPERATION = {
  SEED: "seed",
  READ_BOOTSTRAP: "read-bootstrap",
  READ_DAILY_NOTES: "read-daily-notes",
  READ_FILE: "read-file",
  WRITE_FILE: "write-file",
} as const;

export type WorkspaceIoOperation =
  (typeof WORKSPACE_IO_OPERATION)[keyof typeof WORKSPACE_IO_OPERATION];

/** A filesystem failure the port did not decide to refuse: a disk or permission error, not a bound. */
export class WorkspaceIOError extends Data.TaggedError("WorkspaceIOError")<{
  readonly code: WorkspaceIoOperation;
  readonly cause: unknown;
}> {}

export type WorkspaceFileRefusalCode =
  (typeof WORKSPACE_FILE_REFUSAL)[keyof typeof WORKSPACE_FILE_REFUSAL];

/** A read or write the port refused on purpose: outside the workspace, too large, or not found. */
export class WorkspaceFileRefused extends Data.TaggedError("WorkspaceFileRefused")<{
  readonly code: WorkspaceFileRefusalCode;
  readonly name: string;
}> {}

const ioEffect = <A>(
  operation: WorkspaceIoOperation,
  run: () => Promise<A>,
): Effect.Effect<A, WorkspaceIOError> =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new WorkspaceIOError({ code: operation, cause }),
  });

/** Creates the workspace directory and every missing file, as an effect over the port's own seeding. */
export const seedWorkspaceEffect = (
  directory: string,
  seeds: WorkspaceSeeds,
): Effect.Effect<WorkspaceSeeding, WorkspaceIOError> =>
  ioEffect(WORKSPACE_IO_OPERATION.SEED, () => seedWorkspace(directory, seeds));

/** Reads the named bootstrap files from the workspace and bounds them. */
export const readBootstrapFilesEffect = (
  directory: string,
  names?: readonly WorkspaceFile[],
): Effect.Effect<readonly BootstrapFile[], WorkspaceIOError> =>
  ioEffect(WORKSPACE_IO_OPERATION.READ_BOOTSTRAP, () =>
    names === undefined ? readBootstrapFiles(directory) : readBootstrapFiles(directory, names),
  );

/** Today's and yesterday's daily notes, for priming a conversation that just started fresh. */
export const recentDailyNotesEffect = (
  directory: string,
  now: number,
): Effect.Effect<readonly DailyNote[], WorkspaceIOError> =>
  ioEffect(WORKSPACE_IO_OPERATION.READ_DAILY_NOTES, () => recentDailyNotes(directory, now));

/**
 * Reads one workspace file for the agent. Fails with `WorkspaceIOError` on an
 * unexpected filesystem error and with `WorkspaceFileRefused` on the bound the
 * port itself decided: outside the workspace, or not found.
 */
export const readWorkspaceFileEffect = (
  directory: string,
  name: string,
): Effect.Effect<string, WorkspaceIOError | WorkspaceFileRefused> =>
  Effect.flatMap(
    ioEffect(WORKSPACE_IO_OPERATION.READ_FILE, () => readWorkspaceFile(directory, name)),
    (result) =>
      result.ok
        ? Effect.succeed(result.content)
        : Effect.fail(
            new WorkspaceFileRefused({
              // SAFETY: the port answers `reason` with a `WORKSPACE_FILE_REFUSAL` member and nothing else.
              code: result.reason as WorkspaceFileRefusalCode,
              name,
            }),
          ),
  );

/**
 * Writes one workspace file whole for the agent. Fails with `WorkspaceIOError`
 * on an unexpected filesystem error and with `WorkspaceFileRefused` on the
 * bound the port itself decided: outside the workspace, or too large to write
 * whole.
 */
export const writeWorkspaceFileEffect = (
  directory: string,
  name: string,
  content: string,
): Effect.Effect<number, WorkspaceIOError | WorkspaceFileRefused> =>
  Effect.flatMap(
    ioEffect(WORKSPACE_IO_OPERATION.WRITE_FILE, () => writeWorkspaceFile(directory, name, content)),
    (result) =>
      result.ok
        ? Effect.succeed(result.chars)
        : Effect.fail(
            new WorkspaceFileRefused({
              // SAFETY: the port answers `reason` with a `WORKSPACE_FILE_REFUSAL` member and nothing else.
              code: result.reason as WorkspaceFileRefusalCode,
              name,
            }),
          ),
  );
