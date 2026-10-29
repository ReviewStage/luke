import type { AgentToolPin } from "@luke/agent-runner/pins";
import { Duration, Effect, Option, Path, Stream } from "effect";
import { Hex } from "effect/encoding";
import * as FileSystem from "effect/FileSystem";
import * as HttpClient from "effect/http/HttpClient";
import { ChildProcess, type ChildProcessSpawner } from "effect/process";

/**
 * local-agent-tools.ts -- a binary a device's local agents run on, as its pin names it (`@luke/agent-runner/pins`' `AgentToolPin`): the pinned release fetched once, checked, and kept in the device's own folder.
 *
 * One resolver answers every such binary, a Mac's smolvm among them: the
 * build kept under the state root, at `agent-tools/<NAME>/<VERSION>`,
 * fetched the first time it is asked for.
 *
 * A fetch keeps nothing unless the whole archive arrived at the pin's size
 * and its SHA-256 is the pin's: an answer past the size is refused as it
 * arrives, and one whose digest differs is never written anywhere. Only the
 * pinned members are extracted, into a folder of their own beside the kept
 * one, which is moved into place whole. Where the pin names the digests of
 * the files that run, each must match them before the build is marked and
 * again at every answer, so a file changed on disk since is refused and
 * fetched anew. The mark is written
 * last, so a fetch cut off, or a build refused, leaves nothing that is ever
 * run, and the next ask fetches again. Once a build is answered, the other
 * releases of the same tool beside it are removed, and nothing outside the
 * tool's own folder.
 */

const TOOL_FETCH = {
  /** How long an archive, at most a little over a hundred megabytes, may take to arrive. */
  TIMEOUT: Duration.minutes(10),
  /** Where under the state root every kept build stands, one folder per tool and release. */
  FOLDER: "agent-tools",
  /** The mark written once the build is checked and in place. */
  MARK: ".verified",
} as const;

const HTTP_OK = 200;

/** The system's own tar, never one a PATH would find first. */
const TAR = "/usr/bin/tar";

/** A file's SHA-256, in hex. */
const digestOf = (bytes: Uint8Array) =>
  Effect.map(
    Effect.tryPromise(() => crypto.subtle.digest("SHA-256", new Uint8Array(bytes))),
    (digest) => Hex.encode(new Uint8Array(digest)),
  );

/** Whether every file the pin names a digest for stands under `folder` with that digest; true where it names none. */
const filesAsPinned = (pin: AgentToolPin, folder: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    for (const [file, digest] of Object.entries(pin.FILES ?? {})) {
      const bytes = yield* fileSystem.readFile(path.join(folder, file));
      if ((yield* digestOf(bytes)) !== digest) return false;
    }
    return true;
  });

/**
 * The pin's archive fetched, checked against its size and digest, and its
 * members kept under `folder`, moved into place whole, checked against its
 * files' digests where the pin names them, and marked; fails where any step does.
 */
const fetchTool = Effect.fnUntraced(function* (pin: AgentToolPin, folder: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const client = yield* HttpClient.HttpClient;
  const response = yield* client.get(pin.ARCHIVE).pipe(Effect.timeout(TOOL_FETCH.TIMEOUT));
  if (response.status !== HTTP_OK) return yield* Effect.fail("fetch refused");
  // Note that the archive is read into a buffer of the pin's size and no larger, so an answer
  // longer than the pinned archive is refused as it arrives rather than held whole.
  const archive = new Uint8Array(pin.BYTES);
  const received = yield* response.stream.pipe(
    Stream.runFoldEffect(
      () => 0,
      (filled, chunk: Uint8Array) =>
        filled + chunk.length > archive.length
          ? Effect.fail("too large")
          : Effect.sync(() => {
              archive.set(chunk, filled);
              return filled + chunk.length;
            }),
    ),
  );
  if (received !== archive.length) return yield* Effect.fail("short");
  // Note that nothing of an archive whose digest is not the pin's is written anywhere.
  if ((yield* digestOf(archive)) !== pin.SHA256) return yield* Effect.fail("checksum");
  const parent = path.dirname(folder);
  yield* fileSystem.makeDirectory(parent, { recursive: true });
  yield* Effect.scoped(
    Effect.gen(function* () {
      const staging = yield* fileSystem.makeTempDirectoryScoped({
        directory: parent,
        prefix: `.${pin.NAME}-`,
      });
      const saved = path.join(staging, "archive.tgz");
      yield* fileSystem.writeFile(saved, archive);
      const members = pin.MEMBERS.map((member) => `${pin.ROOT}/${member}`);
      const code = yield* Effect.flatMap(
        ChildProcess.make(TAR, ["-xzf", saved, "-C", staging, ...members], {
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
        }),
        (handle) => handle.exitCode,
      );
      if (Number(code) !== 0) return yield* Effect.fail("extract");
      yield* fileSystem.remove(folder, { recursive: true, force: true });
      yield* fileSystem.rename(path.join(staging, pin.ROOT), folder);
    }),
  );
  if (!(yield* filesAsPinned(pin, folder))) {
    yield* fileSystem.remove(folder, { recursive: true, force: true });
    return yield* Effect.fail("files");
  }
  yield* fileSystem.writeFileString(path.join(folder, TOOL_FETCH.MARK), `${pin.SHA256}\n`);
});

/**
 * The other releases of the pin's tool, each a folder beside the answered
 * one under `agent-tools/<NAME>`, removed so old builds do not pile up; a
 * folder a fetch is staging in (named for a dot) is left to that fetch, and
 * a removal that fails is left for the next ask.
 */
const otherVersionsRemoved = (pin: AgentToolPin, toolFolder: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    for (const entry of yield* fileSystem.readDirectory(toolFolder)) {
      if (entry === pin.VERSION || entry.startsWith(".")) continue;
      yield* fileSystem.remove(path.join(toolFolder, entry), { recursive: true, force: true });
    }
  }).pipe(Effect.ignore);

/**
 * Where the pin's binary is kept under the state root once fetched, for a
 * caller that names it before it is had, as a Mac's `smolvm` is named in
 * every command of its sandbox's.
 */
export function keptToolBinary(stateRoot: string, pin: AgentToolPin): string {
  return [stateRoot, TOOL_FETCH.FOLDER, pin.NAME, pin.VERSION, pin.BINARY].join("/");
}

/**
 * The pinned binary a device's local agents run on: the kept build where it
 * was checked and marked and its files still match, and otherwise the build
 * fetched now; none where it cannot be had, which the caller asks again
 * later.
 */
export const localAgentTool = Effect.fnUntraced(function* (
  stateRoot: string,
  pin: AgentToolPin,
  /** Run once just before a fetch begins, never for a kept build. */
  fetching: Effect.Effect<void> = Effect.void,
): Effect.fn.Return<
  Option.Option<string>,
  never,
  | FileSystem.FileSystem
  | Path.Path
  | HttpClient.HttpClient
  | ChildProcessSpawner.ChildProcessSpawner
> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const exists = (target: string) =>
    fileSystem.exists(target).pipe(Effect.orElseSucceed(() => false));
  const folder = path.join(stateRoot, TOOL_FETCH.FOLDER, pin.NAME, pin.VERSION);
  const binary = path.join(folder, pin.BINARY);
  const marked = (yield* exists(path.join(folder, TOOL_FETCH.MARK))) && (yield* exists(binary));
  // Note that a kept build's files are checked again before it is answered, since anything of the
  // developer's could have written them since: a binary changed since is fetched again.
  const kept =
    marked && (yield* filesAsPinned(pin, folder).pipe(Effect.orElseSucceed(() => false)));
  if (!kept) yield* fetching;
  const answer = kept
    ? Option.some(binary)
    : yield* fetchTool(pin, folder).pipe(
        Effect.as(Option.some(binary)),
        Effect.orElseSucceed(() => Option.none<string>()),
      );
  if (Option.isSome(answer)) yield* otherVersionsRemoved(pin, path.dirname(folder));
  return answer;
});
