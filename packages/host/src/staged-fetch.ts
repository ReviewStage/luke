import { createHash } from "node:crypto";
import { type Duration, Effect, Option, Path, Stream } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as HttpClient from "effect/http/HttpClient";
import { ChildProcess } from "effect/process";

const HTTP_OK = 200;

const SYSTEM_FOLDERS = ["/usr/bin", "/bin"] as const;

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

export interface FetchBounds {
  readonly maxBytes: number;
  readonly stall: Duration.Input;
  readonly timeout: Duration.Input;
}

interface FetchedArchive {
  readonly sha256: string;
  readonly bytes: number;
}

function isFetchFailure(error: unknown): error is FetchFailure {
  return Object.values<unknown>(FETCH_FAILURE).includes(error);
}

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

export const unpackedArchive = (saved: string, into: string, members: readonly string[] = []) =>
  Effect.gen(function* () {
    const tar = yield* systemTar;
    if (Option.isNone(tar)) return yield* Effect.fail(FETCH_FAILURE.NO_TAR);
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

export interface StagedPlace {
  readonly parent: string;
  readonly prefix: string;
  readonly target: string;
}

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
