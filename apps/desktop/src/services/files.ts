import type { Dirent, Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Context, Effect, Layer } from "effect";
import * as Data from "effect/Data";

export class FileFailure extends Data.TaggedError("FileFailure")<{
  readonly operation: string;
  readonly path: string;
  readonly code?: string;
}> {}

function isNodeError(error: Error): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

/**
 * A provider directory that is absent, or that this user cannot read, means
 * Luke observes nothing there — never that the observation pass failed.
 */
function canIgnoreFilesystemError(error: Error): boolean {
  return (
    isNodeError(error) &&
    (error.code === "ENOENT" ||
      error.code === "ENOTDIR" ||
      error.code === "EACCES" ||
      error.code === "EPERM")
  );
}

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
    readonly readDirectory: (directoryPath: string) => Effect.Effect<Dirent[], FileFailure>;
    readonly stat: (filePath: string) => Effect.Effect<Stats | undefined, FileFailure>;
    readonly lstat: (
      directoryPath: string,
      name: string,
    ) => Effect.Effect<
      { directoryPath: string; name: string; stats: Stats } | undefined,
      FileFailure
    >;
    readonly readTextFileUtf8: (filePath: string) => Effect.Effect<string | undefined, FileFailure>;
    readonly readFileRegion: (
      filePath: string,
      maximumBytes: number,
      offset: (size: number, length: number) => number,
    ) => Effect.Effect<string, FileFailure>;
    readonly chmod: (path: string, mode: number) => Effect.Effect<void, FileFailure>;
    readonly dynamicImport: <T>(specifier: string) => Effect.Effect<T, FileFailure>;
    readonly bridge: <A>(operation: string, run: () => Promise<A>) => Effect.Effect<A, FileFailure>;
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

function ignorable<A>(
  operation: string,
  filePath: string,
  run: () => Promise<A>,
  onIgnore: () => A,
): Effect.Effect<A, FileFailure, never> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => cause,
  }).pipe(
    Effect.catchAll((cause) =>
      cause instanceof Error && canIgnoreFilesystemError(cause)
        ? Effect.succeed(onIgnore())
        : Effect.fail(fromNodeFailure(operation, filePath, cause)),
    ),
  );
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
  readDirectory: (directoryPath) =>
    ignorable(
      "readDirectory",
      directoryPath,
      () => fs.readdir(directoryPath, { withFileTypes: true }),
      () => [],
    ),
  stat: (filePath) =>
    ignorable(
      "stat",
      filePath,
      () => fs.stat(filePath),
      () => undefined,
    ),
  lstat: (directoryPath, name) => {
    const entryPath = path.join(directoryPath, name);
    return ignorable(
      "lstat",
      entryPath,
      async () => {
        const stats = await fs.lstat(entryPath);
        return { directoryPath: entryPath, name, stats };
      },
      () => undefined,
    );
  },
  readTextFileUtf8: (filePath) =>
    ignorable(
      "readTextFileUtf8",
      filePath,
      () => fs.readFile(filePath, "utf8"),
      () => undefined,
    ),
  readFileRegion: (filePath, maximumBytes, offset) =>
    ignorable(
      "readFileRegion",
      filePath,
      async () => {
        let handle: fs.FileHandle | undefined;
        try {
          handle = await fs.open(filePath, "r");
          const stats = await handle.stat();
          if (!stats.isFile() || stats.size <= 0) return "";
          const length = Math.min(stats.size, maximumBytes);
          const buffer = Buffer.alloc(length);
          await handle.read(buffer, 0, length, offset(stats.size, length));
          return buffer.toString("utf8");
        } finally {
          await handle?.close();
        }
      },
      () => "",
    ),
  chmod: (filePath, mode) =>
    Effect.tryPromise({
      try: () => fs.chmod(filePath, mode),
      catch: (cause) => fromNodeFailure("chmod", filePath, cause),
    }),
  dynamicImport: <T>(specifier: string) =>
    Effect.tryPromise({
      try: () => import(specifier) as Promise<T>,
      catch: (cause) => fromNodeFailure("dynamicImport", specifier, cause),
    }),
  bridge: (operation, run) =>
    Effect.tryPromise({
      try: run,
      catch: (cause) => fromNodeFailure("bridge", operation, cause),
    }),
});
