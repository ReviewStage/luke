import fs from "node:fs/promises";
import { Context, Effect, Layer } from "effect";
import * as Data from "effect/Data";

export class FileFailure extends Data.TaggedError("FileFailure")<{
  readonly operation: string;
  readonly path: string;
  readonly code?: string;
}> {}

export class Files extends Context.Tag("Files")<
  Files,
  {
    readonly readFile: (path: string) => Effect.Effect<Buffer, FileFailure>;
    readonly writeFile: (
      path: string,
      data: string | Buffer,
      options?: { mode?: number },
    ) => Effect.Effect<void, FileFailure>;
    readonly rename: (from: string, to: string) => Effect.Effect<void, FileFailure>;
    readonly mkdir: (
      path: string,
      options?: { recursive?: boolean },
    ) => Effect.Effect<void, FileFailure>;
    readonly unlink: (path: string) => Effect.Effect<void, FileFailure>;
  }
>() {}

function nodeErrorCode(cause: unknown): string | undefined {
  if (!(cause instanceof Error) || !("code" in cause)) return undefined;
  // SAFETY: The preceding check establishes the asserted contract.
  const code = (cause as NodeJS.ErrnoException).code;
  return code === undefined ? undefined : String(code);
}

function fromNodeFailure(operation: string, filePath: string, cause: unknown): FileFailure {
  return new FileFailure({
    operation,
    path: filePath,
    code: nodeErrorCode(cause),
  });
}

export const FilesLive: Layer.Layer<Files> = Layer.succeed(Files, {
  readFile: (filePath) =>
    Effect.tryPromise({
      try: () => fs.readFile(filePath),
      catch: (cause) => fromNodeFailure("readFile", filePath, cause),
    }),
  writeFile: (filePath, data, options) =>
    Effect.tryPromise({
      try: () => fs.writeFile(filePath, data, options),
      catch: (cause) => fromNodeFailure("writeFile", filePath, cause),
    }),
  rename: (from, to) =>
    Effect.tryPromise({
      try: () => fs.rename(from, to),
      catch: (cause) => fromNodeFailure("rename", from, cause),
    }),
  mkdir: (filePath, options) =>
    Effect.tryPromise({
      try: () => fs.mkdir(filePath, options),
      catch: (cause) => fromNodeFailure("mkdir", filePath, cause),
    }),
  unlink: (filePath) =>
    Effect.tryPromise({
      try: () => fs.unlink(filePath),
      catch: (cause) => fromNodeFailure("unlink", filePath, cause),
    }),
});
