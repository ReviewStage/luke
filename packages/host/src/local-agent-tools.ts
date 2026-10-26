import type { MacToolPin } from "@luke/agent-runner/pins";
import { Duration, Effect, Option, Path, Stream } from "effect";
import { Hex } from "effect/encoding";
import * as FileSystem from "effect/FileSystem";
import * as HttpClient from "effect/http/HttpClient";
import { ChildProcess, type ChildProcessSpawner } from "effect/process";

/**
 * local-agent-tools.ts -- a binary this Mac's local agents run, as its pin names it (`@luke/agent-runner/pins`' `MacToolPin`): the copy the app or the checkout already has, or the pinned release fetched once, checked, and kept in the app's own folder.
 *
 * One resolver answers every such binary, Node and Claude Code for the
 * runner and the harness, Codex beside them, however it came: the copy given
 * as `bundled` where it stands, or the one kept under the state root, at
 * `agent-tools/<NAME>/<VERSION>`, fetched the first time it is asked for.
 *
 * A fetch keeps nothing unless the whole archive arrived at the pin's size
 * and its SHA-256 is the pin's: an answer past the size is refused as it
 * arrives, and one whose digest differs is never written anywhere. Only the
 * pinned members are extracted, into a folder of their own beside the kept
 * one, which is moved into place whole. Where the pin names the Developer ID
 * team its binary is signed by, macOS's own `codesign` must verify the
 * binary strictly and name that team before the build is marked, and again
 * each time the kept build is first answered after a start, so a binary
 * changed on disk since is refused and fetched anew. The mark is written
 * last, so a fetch cut off, or a build refused, leaves nothing that is ever
 * run, and the next ask fetches again.
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

/** macOS's own tools, never ones a PATH would find first. */
const MAC_TOOL = { TAR: "/usr/bin/tar", CODESIGN: "/usr/bin/codesign" } as const;

/** The line `codesign -dv` writes naming the team a binary is signed by. */
const TEAM_LINE = /^TeamIdentifier=(\S+)$/m;

/** Whether `binary` is signed as its pin says: verified strictly by `codesign`, and by the pin's team. */
const signedAsPinned = (binary: string, team: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const verified = yield* Effect.flatMap(
        ChildProcess.make(MAC_TOOL.CODESIGN, ["--verify", "--strict", binary], {
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
        }),
        (handle) => handle.exitCode,
      );
      if (Number(verified) !== 0) return false;
      const described = yield* ChildProcess.make(MAC_TOOL.CODESIGN, ["-dv", binary], {
        stdin: "ignore",
        stdout: "ignore",
      });
      // Note that `codesign -dv` writes what it reads of the signature to stderr.
      const printed = yield* Stream.mkString(Stream.decodeText(described.stderr));
      yield* described.exitCode;
      return TEAM_LINE.exec(printed)?.[1] === team;
    }),
  );

/**
 * The pin's archive fetched, checked against its size and digest, and its
 * members kept under `folder`, moved into place whole, checked against its
 * signature where the pin names one, and marked; fails where any step does.
 */
const fetchTool = Effect.fnUntraced(function* (pin: MacToolPin, folder: string) {
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
  const digest = yield* Effect.tryPromise(() => crypto.subtle.digest("SHA-256", archive));
  // Note that nothing of an archive whose digest is not the pin's is written anywhere.
  if (Hex.encode(new Uint8Array(digest)) !== pin.SHA256) return yield* Effect.fail("checksum");
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
        ChildProcess.make(MAC_TOOL.TAR, ["-xzf", saved, "-C", staging, ...members], {
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
  if (pin.TEAM !== undefined && !(yield* signedAsPinned(path.join(folder, pin.BINARY), pin.TEAM))) {
    yield* fileSystem.remove(folder, { recursive: true, force: true });
    return yield* Effect.fail("signature");
  }
  yield* fileSystem.writeFileString(path.join(folder, TOOL_FETCH.MARK), `${pin.SHA256}\n`);
});

/**
 * The pinned binary for this Mac's local agents: `bundled` where it is given
 * and stands there, the kept build where it was checked and marked, and
 * otherwise the build fetched now; none where it cannot be had, which the
 * caller asks again later.
 */
export const localAgentTool = Effect.fnUntraced(function* (
  stateRoot: string,
  pin: MacToolPin,
  bundled: string | undefined,
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
  if (bundled !== undefined && (yield* exists(bundled))) return Option.some(bundled);
  const folder = path.join(stateRoot, TOOL_FETCH.FOLDER, pin.NAME, pin.VERSION);
  const binary = path.join(folder, pin.BINARY);
  const marked = (yield* exists(path.join(folder, TOOL_FETCH.MARK))) && (yield* exists(binary));
  // Note that a kept build signed by a pinned team is checked again before it is answered, since
  // anything of the developer's could have written it since: a binary changed since is fetched again.
  const kept =
    marked &&
    (pin.TEAM === undefined ||
      (yield* signedAsPinned(binary, pin.TEAM).pipe(Effect.orElseSucceed(() => false))));
  if (kept) return Option.some(binary);
  return yield* fetchTool(pin, folder).pipe(
    Effect.as(Option.some(binary)),
    Effect.orElseSucceed(() => Option.none<string>()),
  );
});
