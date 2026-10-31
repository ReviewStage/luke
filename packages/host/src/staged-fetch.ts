/**
 * staged-fetch.ts -- an archive fetched, unpacked, and moved into place whole, the one way a device keeps a download it runs: a pinned agent CLI (`local-agent-tools.ts`) and a host's own newer release (`daemon/host-update.ts`) alike.
 *
 * The archive is streamed to disk and hashed as it arrives, never held
 * whole: an answer past its ceiling is refused as it arrives, as is one
 * that goes `stall` without a byte, or whose whole answer takes longer
 * than its deadline. Each caller checks the digest, and the size where it
 * knows one, against what it was told before anything is unpacked. The
 * system's own `tar` unpacks it, from the system's folders alone, never
 * one a PATH would put first.
 *
 * All of it happens in a dot-folder of the caller's, named for its prefix,
 * beside where the result is kept, and only a whole folder is renamed into
 * place, so a fetch cut off or refused leaves nothing that is ever run: the
 * staging folder goes with whatever is left in it, and one a fetch cut off
 * left (a quit mid-download) is removed as the next fetch of the same
 * prefix begins, since each caller fetches once at a time.
 */

import { createHash } from "node:crypto";
import { type Duration, Effect, Option, Path, Stream } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as HttpClient from "effect/http/HttpClient";
import { ChildProcess } from "effect/process";

const HTTP_OK = 200;

/**
 * The folders the system keeps its own `tar` and `gzip` in, on a Mac and on
 * every Linux, searched in order, never a folder a PATH would put first.
 */
const SYSTEM_FOLDERS = ["/usr/bin", "/bin"] as const;

/** Why a fetch or an unpack failed, each in the words a download's own sentence ends with. */
const FETCH_FAILURE = {
  REFUSED: "was refused",
  UNREACHED: "could not connect",
  TOO_LARGE: "was larger than allowed",
  STALLED: "stalled",
  TIMED_OUT: "took too long",
  UNWRITTEN: "could not be saved",
  NO_TAR: "found no system tar to unpack it",
  UNPACKED: "could not be unpacked",
} as const;

type FetchFailure = (typeof FETCH_FAILURE)[keyof typeof FETCH_FAILURE];

/** How much a download may be, and how long it may take: without a byte, and whole. */
export interface FetchBounds {
  readonly maxBytes: number;
  readonly stall: Duration.Input;
  readonly timeout: Duration.Input;
}

/** An archive as it arrived: its SHA-256 in hex and its size in bytes. */
interface FetchedArchive {
  readonly sha256: string;
  readonly bytes: number;
}

function isFetchFailure(error: unknown): error is FetchFailure {
  return Object.values<unknown>(FETCH_FAILURE).includes(error);
}

/** The archive at `url` streamed to `saved` as it arrives and hashed on the way, within `bounds`. */
export const streamedArchive = (url: string, saved: string, bounds: FetchBounds) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const client = yield* HttpClient.HttpClient;
    const response = yield* client
      .get(url)
      .pipe(Effect.mapError((): FetchFailure => FETCH_FAILURE.UNREACHED));
    if (response.status !== HTTP_OK) return yield* Effect.fail(FETCH_FAILURE.REFUSED);
    const hash = createHash("sha256");
    let received = 0;
    yield* response.stream.pipe(
      Stream.mapError((): FetchFailure => FETCH_FAILURE.UNREACHED),
      Stream.timeoutOrElse({
        duration: bounds.stall,
        orElse: () => Stream.fail(FETCH_FAILURE.STALLED),
      }),
      Stream.mapEffect((chunk: Uint8Array) =>
        received + chunk.length > bounds.maxBytes
          ? Effect.fail(FETCH_FAILURE.TOO_LARGE)
          : Effect.sync(() => {
              received += chunk.length;
              hash.update(chunk);
              return chunk;
            }),
      ),
      Stream.run(fileSystem.sink(saved)),
      Effect.mapError((error) => (isFetchFailure(error) ? error : FETCH_FAILURE.UNWRITTEN)),
    );
    return { sha256: hash.digest("hex"), bytes: received } satisfies FetchedArchive;
  }).pipe(
    Effect.timeoutOrElse({
      duration: bounds.timeout,
      orElse: () => Effect.fail(FETCH_FAILURE.TIMED_OUT),
    }),
  );

/** The system's own `tar`, from the first of its folders that keeps one. */
const systemTar = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  for (const folder of SYSTEM_FOLDERS) {
    const tar = `${folder}/tar`;
    if (yield* fileSystem.exists(tar).pipe(Effect.orElseSucceed(() => false))) {
      return Option.some(tar);
    }
  }
  return Option.none<string>();
});

/** The archive at `saved` unpacked under `into`, its layout kept: the members named alone where any are, and otherwise all of it. */
export const unpackedArchive = (saved: string, into: string, members: readonly string[] = []) =>
  Effect.gen(function* () {
    const tar = yield* systemTar;
    if (Option.isNone(tar)) return yield* Effect.fail(FETCH_FAILURE.NO_TAR);
    // Note that no compression is named, since GNU tar and macOS's bsdtar both read it off the archive, a gzipped
    // tar or on a Mac a zip, and GNU tar runs `gzip` for it from the PATH handed here, the system's folders alone.
    const code = yield* Effect.scoped(
      Effect.flatMap(
        ChildProcess.make(tar.value, ["-xf", saved, "-C", into, ...members], {
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
          env: { PATH: SYSTEM_FOLDERS.join(":") },
          extendEnv: false,
        }),
        (handle) => handle.exitCode,
      ),
    ).pipe(Effect.mapError((): FetchFailure => FETCH_FAILURE.UNPACKED));
    if (Number(code) !== 0) return yield* Effect.fail(FETCH_FAILURE.UNPACKED);
  });

/** Where a staged folder is built and where it is kept. */
export interface StagedPlace {
  /** The folder the staging folder is made in, on the same file system as `target`. */
  readonly parent: string;
  /** What the staging folder's name starts with, a dot first, so it is never taken for a kept folder. */
  readonly prefix: string;
  /** Where the folder built is kept, whatever stood there before removed. */
  readonly target: string;
}

/**
 * The folder `built` answers, built in a staging folder of its own under
 * the place's parent, renamed over its target once whole; every staging
 * folder of the same prefix a fetch cut off left is removed first, and this
 * one goes with whatever is left in it, a failure's among it.
 */
export const stagedFolder = <E, R>(
  place: StagedPlace,
  built: (staging: string) => Effect.Effect<string, E, R>,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fileSystem.makeDirectory(place.parent, { recursive: true });
    yield* fileSystem.makeDirectory(path.dirname(place.target), { recursive: true });
    for (const entry of yield* fileSystem.readDirectory(place.parent)) {
      if (entry.startsWith(place.prefix)) {
        yield* fileSystem.remove(path.join(place.parent, entry), { recursive: true, force: true });
      }
    }
    yield* Effect.scoped(
      Effect.gen(function* () {
        const staging = yield* fileSystem.makeTempDirectoryScoped({
          directory: place.parent,
          prefix: place.prefix,
        });
        const folder = yield* built(staging);
        yield* fileSystem.remove(place.target, { recursive: true, force: true });
        yield* fileSystem.rename(folder, place.target);
      }),
    );
  });
