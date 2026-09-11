/**
 * The notebook's own files in Effect's own terms. `workspace-files.ts` reads
 * and writes them synchronously because they run on the store's worker
 * inside its transactions, so it stays a plain throwing pair rather than a
 * port with a shape of its own; this sibling states what either can throw
 * for as a typed failure instead of a bare `Error` a caller must catch by
 * hand.
 */
import { Data, Effect } from "effect";
import { readWorkspaceFileSync, writeWorkspaceFileSync } from "./workspace-files.js";

/** Which operation an unexpected filesystem failure happened during. */
const WORKSPACE_FILE_IO_OPERATION = {
  READ: "read",
  WRITE: "write",
} as const;

export type WorkspaceFileIoOperation =
  (typeof WORKSPACE_FILE_IO_OPERATION)[keyof typeof WORKSPACE_FILE_IO_OPERATION];

/** A filesystem failure reading or writing one of the notebook's own files. */
export class WorkspaceFileIOError extends Data.TaggedError("WorkspaceFileIOError")<{
  readonly operation: WorkspaceFileIoOperation;
  readonly name: string;
  readonly cause: unknown;
}> {}

/** Reads one workspace file, or the fallback when it does not exist yet. */
export const readWorkspaceFileEffect = (
  root: string,
  name: string,
  fallback = "",
): Effect.Effect<string, WorkspaceFileIOError> =>
  Effect.try({
    try: () => readWorkspaceFileSync(root, name, fallback),
    catch: (cause) =>
      new WorkspaceFileIOError({ operation: WORKSPACE_FILE_IO_OPERATION.READ, name, cause }),
  });

/** Writes one workspace file whole, through a rename so a reader never sees half a file. */
export const writeWorkspaceFileEffect = (
  root: string,
  name: string,
  content: string,
): Effect.Effect<void, WorkspaceFileIOError> =>
  Effect.try({
    try: () => writeWorkspaceFileSync(root, name, content),
    catch: (cause) =>
      new WorkspaceFileIOError({ operation: WORKSPACE_FILE_IO_OPERATION.WRITE, name, cause }),
  });
