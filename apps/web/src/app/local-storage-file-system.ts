import { Effect, type Layer, Option, Schema } from "effect";
import * as FileSystem from "effect/FileSystem";
import { systemError } from "effect/PlatformError";

export const FILES_KEY = "app.host.files";

type Files = Readonly<Record<string, string>>;

const FilesSchema = Schema.fromJsonString(Schema.Record(Schema.String, Schema.String));

const decodeFiles = Schema.decodeUnknownOption(FilesSchema);

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => {
      items.delete(key);
    },
    setItem: (key, value) => {
      items.set(key, String(value));
    },
  };
}

export function tabStorage(): Storage {
  try {
    return window.localStorage;
  } catch (error) {
    console.warn("The browser blocks this site's storage; settings last only this tab.", error);
    return memoryStorage();
  }
}

function readFiles(storage: Storage): Files {
  return Option.getOrElse(decodeFiles(storage.getItem(FILES_KEY)), () => ({}));
}

function missing(method: string, path: string) {
  return systemError({
    _tag: "NotFound",
    module: "FileSystem",
    method,
    pathOrDescriptor: path,
    description: "No such file or directory",
    cause: Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" }),
  });
}

function refused(method: string, path: string, cause: unknown) {
  return systemError({
    _tag: "Unknown",
    module: "FileSystem",
    method,
    pathOrDescriptor: path,
    description: "The browser's storage refused the write",
    cause,
  });
}

function within(path: string, folder: string): boolean {
  return path === folder || path.startsWith(folder.endsWith("/") ? folder : `${folder}/`);
}

export function localStorageFileSystem(
  storage: Storage = tabStorage(),
): Layer.Layer<FileSystem.FileSystem> {
  const write = (method: string, path: string, change: (files: Files) => Files) =>
    Effect.try({
      try: () => storage.setItem(FILES_KEY, JSON.stringify(change(readFiles(storage)))),
      catch: (cause) => refused(method, path, cause),
    });
  return FileSystem.layerNoop({
    exists: (path) => Effect.sync(() => Object.hasOwn(readFiles(storage), path)),
    readFileString: (path) =>
      Effect.suspend(() => {
        const files = readFiles(storage);
        return Object.hasOwn(files, path)
          ? Effect.succeed(files[path] ?? "")
          : Effect.fail(missing("readFileString", path));
      }),
    writeFileString: (path, data) =>
      write("writeFileString", path, (files) => ({ ...files, [path]: data })),
    makeDirectory: () => Effect.void,
    chmod: (path) =>
      Effect.suspend(() =>
        Object.hasOwn(readFiles(storage), path) ? Effect.void : Effect.fail(missing("chmod", path)),
      ),
    rename: (oldPath, newPath) =>
      Effect.suspend(() => {
        const files = readFiles(storage);
        if (!Object.hasOwn(files, oldPath)) return Effect.fail(missing("rename", oldPath));
        return write("rename", newPath, () => {
          const { [oldPath]: moved = "", ...rest } = files;
          return { ...rest, [newPath]: moved };
        });
      }),
    remove: (path, options) =>
      Effect.suspend(() => {
        const files = readFiles(storage);
        const gone = Object.keys(files).filter((held) =>
          options?.recursive === true ? within(held, path) : held === path,
        );
        if (gone.length === 0) {
          return options?.force === true ? Effect.void : Effect.fail(missing("remove", path));
        }
        return write("remove", path, () =>
          Object.fromEntries(Object.entries(files).filter(([held]) => !gone.includes(held))),
        );
      }),
  });
}
