/**
 * local-storage-file-system.ts -- the host's files in a browser tab: one localStorage entry holding each file the host keeps, by its path.
 *
 * The host in the tab keeps one small file, the settings store's
 * `settings.json` (no account rides in it: the cookie session hands the store
 * no cipher), and retires none of an older layout's, so this answers only
 * what the settings store and the retired store call: a read, a write, a
 * directory made, a mode set, a rename, and a removal. Every other call is
 * `FileSystem.layerNoop`'s refusal. Files are held as one JSON record under
 * one key rather than a key each, so a path is a record key and never part
 * of a storage key. Where the browser blocks the site's storage, reading
 * `localStorage` throws, so the files are held in memory for the tab's life
 * instead (`tabStorage`), and the tab still draws, signed in or not.
 */

import { Effect, type Layer, Option, Schema } from "effect";
import * as FileSystem from "effect/FileSystem";
import { systemError } from "effect/PlatformError";

/** The one localStorage entry the tab's files are kept under, which another tab's write is heard by. */
export const FILES_KEY = "luke.host.files";

type Files = Readonly<Record<string, string>>;

/** The entry as written: each file's text by its path. */
const FilesSchema = Schema.fromJsonString(Schema.Record(Schema.String, Schema.String));

const decodeFiles = Schema.decodeUnknownOption(FilesSchema);

/**
 * A `Storage` held in memory for the tab's life, as a blocked storage is
 * answered: the settings written stand until the tab closes and reach no
 * other tab.
 */
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

/**
 * The tab's own `localStorage`, or one in memory where the browser blocks the
 * site's storage, which throws on the read rather than answering nothing.
 */
export function tabStorage(): Storage {
  try {
    return window.localStorage;
  } catch (error) {
    console.warn("The browser blocks this site's storage; settings last only this tab.", error);
    return memoryStorage();
  }
}

/** Every file held, or none where nothing was ever written or the entry is not ours to read. */
function readFiles(storage: Storage): Files {
  return Option.getOrElse(decodeFiles(storage.getItem(FILES_KEY)), () => ({}));
}

/**
 * A path that names no file, refused as Node refuses one: the settings store
 * reads `ENOENT` on the reason's cause as "never written", which is what a
 * first visit is.
 */
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

/** A write the browser refused, such as a full storage quota. */
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

/** Whether a path is the one named or lies under it. */
function within(path: string, folder: string): boolean {
  return path === folder || path.startsWith(folder.endsWith("/") ? folder : `${folder}/`);
}

/** The host's `FileSystem` over the storage given: the tab's own (`tabStorage`) where none is. */
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
    // Note that a folder is only a prefix of the paths under it, so making one stands nothing up.
    makeDirectory: () => Effect.void,
    // A mode means nothing in a browser's storage; the file must still stand, as Node's chmod asks.
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
