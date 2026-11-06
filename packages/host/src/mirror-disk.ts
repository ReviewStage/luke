import {
  MIRROR_FILE_MODE,
  type MirrorFileMode,
  type MirrorFrame,
} from "@repo/features/sandbox-mirror-wire";
import { Effect, Option, Path } from "effect";
import { Hex } from "effect/encoding";
import * as FileSystem from "effect/FileSystem";

/**
 * mirror-disk.ts -- a mirror's files on the Mac: where a path the bridge names lands, a file written in or deleted, and what a manifest asks of the copy as it stands.
 *
 * A path is the bridge's word and is trusted no further than the mirror's
 * own files: one that is absolute, holds `..`, names git's own folder (the
 * worktree's link to the shared clone, whose config git runs commands
 * from), or resolves outside the mirror through a link the checkout holds,
 * is refused and nothing is written or deleted. A file is written in a
 * fresh folder beside its place and renamed in, so a dev server watching
 * the mirror never reads half of one. The match compares the mirror's own
 * set by git's rules, symlinks left out as the bridge leaves them out of
 * its manifest, so a link the worktree checked out stays as it is. A file's name, bytes, and
 * hash are the agent's and are never logged.
 */

/** A file's permission bits on disk, by its mode as git keeps it. */
const MODE_BITS = {
  [MIRROR_FILE_MODE.REGULAR]: 0o644,
  [MIRROR_FILE_MODE.EXECUTABLE]: 0o755,
} as const satisfies Readonly<Record<MirrorFileMode, number>>;

/** What the fresh folder a file is written in beside its place is named from. */
const TEMPORARY_PREFIX = ".mirroring-";

/** How many of the mirror's files are read at once while a manifest is matched. */
const READ_CONCURRENCY = 8;

type ManifestFile = Extract<MirrorFrame, { readonly type: "manifest" }>["files"][number];

type FileFrame = Pick<Extract<MirrorFrame, { readonly type: "file" }>, "path" | "mode" | "bytes">;

/** A file's bytes as `MIRROR_HASH` names them: SHA-256, in lowercase hex. */
const hashOf = (bytes: Uint8Array) =>
  Effect.map(
    Effect.promise(() => crypto.subtle.digest("SHA-256", new Uint8Array(bytes))),
    (digest) => Hex.encode(new Uint8Array(digest)),
  );

/** Where a path the bridge names lands in the mirror at `root`, or none where it is refused. */
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
    // Note that the nearest folder that stands is resolved, because a link the checkout holds may lead out of the mirror.
    let folder = path.dirname(target);
    while (!(yield* fileSystem.exists(folder))) folder = path.dirname(folder);
    const reached = yield* fileSystem.realPath(folder);
    return reached === home || reached.startsWith(`${home}${path.sep}`)
      ? Option.some(target)
      : Option.none<string>();
  });

/** A `file` message written into the mirror beside its place and renamed in; false where its path is refused. */
export const mirrorWritten = (root: string, file: FileFrame) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const target = yield* mirrorTarget(root, file.path);
    if (Option.isNone(target)) return false;
    const folder = path.dirname(target.value);
    yield* fileSystem.makeDirectory(folder, { recursive: true });
    // Note that the copy is written in a folder made fresh for it, because a name of our own beside the target could be a link the checkout holds.
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

/** A file taken out of the mirror, as a `delete` message or a match asks; false where its path is refused. */
export const mirrorDeleted = (root: string, file: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const target = yield* mirrorTarget(root, file);
    if (Option.isNone(target)) return false;
    yield* fileSystem.remove(target.value, { force: true });
    return true;
  });

/**
 * A manifest matched against the mirror at `root`, whose own files are
 * `listed` as git lists them: each file the manifest lacks is deleted, and
 * the paths whose size or hash differ from the manifest's, or that the
 * mirror lacks, are answered in the manifest's order for the caller to ask
 * for. A file is hashed only where its size agrees.
 */
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
