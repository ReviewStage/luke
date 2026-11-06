import {
  MIRROR_FILE_MODE,
  type MIRROR_FRAME,
  type MirrorFileMode,
  type MirrorFrame,
} from "@repo/features/sandbox-mirror-wire";
import { Effect, Option, Path } from "effect";
import { Hex } from "effect/encoding";
import * as FileSystem from "effect/FileSystem";

const MODE_BITS = {
  [MIRROR_FILE_MODE.REGULAR]: 0o644,
  [MIRROR_FILE_MODE.EXECUTABLE]: 0o755,
} as const satisfies Readonly<Record<MirrorFileMode, number>>;

const TEMPORARY_PREFIX = ".mirroring-";

const READ_CONCURRENCY = 8;

type ManifestFile = Extract<
  MirrorFrame,
  { readonly type: typeof MIRROR_FRAME.MANIFEST }
>["files"][number];

type FileFrame = Pick<
  Extract<MirrorFrame, { readonly type: typeof MIRROR_FRAME.FILE }>,
  "path" | "mode" | "bytes"
>;

const hashOf = (bytes: Uint8Array) =>
  Effect.map(
    Effect.promise(() => crypto.subtle.digest("SHA-256", new Uint8Array(bytes))),
    (digest) => Hex.encode(new Uint8Array(digest)),
  );

export const mirrorTarget = (root: string, file: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const segments = file.split("/");
    if (path.isAbsolute(file)) return Option.none<string>();
    if (segments.some((segment) => segment === ".." || segment.toLowerCase() === ".git")) {
      return Option.none<string>();
    }
    const target = path.join(root, file);
    const home = yield* fileSystem.realPath(root);
    let folder = path.dirname(target);
    while (!(yield* fileSystem.exists(folder))) folder = path.dirname(folder);
    const reached = yield* fileSystem.realPath(folder);
    return reached === home || reached.startsWith(`${home}${path.sep}`)
      ? Option.some(target)
      : Option.none<string>();
  });

export const mirrorWritten = (root: string, file: FileFrame) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const target = yield* mirrorTarget(root, file.path);
    if (Option.isNone(target)) return false;
    const folder = path.dirname(target.value);
    yield* fileSystem.makeDirectory(folder, { recursive: true });
    yield* Effect.scoped(
      Effect.gen(function* () {
        const fresh = yield* fileSystem.makeTempDirectoryScoped({
          directory: folder,
          prefix: TEMPORARY_PREFIX,
        });
        const temporary = path.join(fresh, path.basename(target.value));
        yield* fileSystem.writeFile(temporary, file.bytes);
        yield* fileSystem.chmod(temporary, MODE_BITS[file.mode]);
        yield* fileSystem.rename(temporary, target.value);
      }),
    );
    return true;
  });

export const mirrorDeleted = (root: string, file: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const target = yield* mirrorTarget(root, file);
    if (Option.isNone(target)) return false;
    yield* fileSystem.remove(target.value, { force: true });
    return true;
  });

export const mirrorMatched = (
  root: string,
  listed: readonly string[],
  manifest: readonly ManifestFile[],
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const sized = yield* Effect.forEach(
      listed,
      (file) =>
        Effect.gen(function* () {
          const at = path.join(root, file);
          if (Option.isSome(yield* Effect.option(fileSystem.readLink(at)))) return undefined;
          const info = yield* Effect.option(fileSystem.stat(at));
          if (Option.isNone(info) || info.value.type !== "File") return undefined;
          return [file, Number(info.value.size)] as const;
        }),
      { concurrency: READ_CONCURRENCY },
    );
    const own = new Map(sized.filter((entry) => entry !== undefined));
    const wanted = new Set(manifest.map((file) => file.path));
    for (const file of own.keys()) {
      if (!wanted.has(file)) yield* mirrorDeleted(root, file);
    }
    const differing = yield* Effect.forEach(
      manifest,
      (file) =>
        Effect.gen(function* () {
          if (own.get(file.path) !== file.size) return true;
          const bytes = yield* fileSystem.readFile(path.join(root, file.path));
          return (yield* hashOf(bytes)) !== file.hash;
        }),
      { concurrency: READ_CONCURRENCY },
    );
    return manifest.filter((_, index) => differing[index]).map((file) => file.path);
  });
