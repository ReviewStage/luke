import { Effect } from "effect";
import * as FileSystem from "effect/FileSystem";
import { systemError } from "effect/PlatformError";

export function memoryFileSystem(overrides: Parameters<typeof FileSystem.layerNoop>[0] = {}) {
  const files = new Map<string, string>();
  const layer = FileSystem.layerNoop({
    exists: (path) => Effect.sync(() => files.has(path)),
    makeDirectory: () => Effect.void,
    chmod: () => Effect.void,
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
