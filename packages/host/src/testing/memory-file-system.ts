/**
 * memory-file-system.ts -- a disk held in memory, for a host test: each file's text by its path, so what a fiber wrote is there the moment it ran, with no disk's own time between.
 */

import { Effect } from "effect";
import * as FileSystem from "effect/FileSystem";
import { systemError } from "effect/PlatformError";

/**
 * Each file's text by its path, and the file system over them: a write, a
 * rename, and a removal land at once, each read looks as it runs, a file
 * never written reads as not found, and making a folder or setting a mode
 * does nothing. `overrides` stands over any of it, and the rest is as
 * `layerNoop` leaves it.
 */
export function memoryFileSystem(overrides: Parameters<typeof FileSystem.layerNoop>[0] = {}) {
  const files = new Map<string, string>();
  const layer = FileSystem.layerNoop({
    exists: (path) => Effect.sync(() => files.has(path)),
    makeDirectory: () => Effect.void,
    chmod: () => Effect.void,
    // Note that a missing file fails with the errno a disk's would, which a host's reader takes as no file yet.
    readFileString: (path) =>
      Effect.suspend(() => {
        const held = files.get(path);
        return held === undefined
          ? Effect.fail(
              systemError({
                _tag: "NotFound",
                module: "FileSystem",
                method: "readFileString",
                pathOrDescriptor: path,
                cause: Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" }),
              }),
            )
          : Effect.succeed(held);
      }),
    writeFileString: (path, data) => Effect.sync(() => void files.set(path, data)),
    rename: (from, to) =>
      Effect.sync(() => {
        const held = files.get(from);
        files.delete(from);
        if (held !== undefined) files.set(to, held);
      }),
    remove: (path) => Effect.sync(() => void files.delete(path)),
    ...overrides,
  });
  return { files, layer };
}
