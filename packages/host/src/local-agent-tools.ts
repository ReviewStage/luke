import { createHash } from "node:crypto";
import type { AgentToolPin } from "@luke/agent-runner/pins";
import { Duration, Effect, Option, Path, Schema, Stream } from "effect";
import * as FileSystem from "effect/FileSystem";
import type * as HttpClient from "effect/http/HttpClient";
import { ChildProcess, type ChildProcessSpawner } from "effect/process";
import { stagedFolder, streamedArchive, unpackedArchive } from "./staged-fetch.js";

/**
 * local-agent-tools.ts -- a binary a device's local agents run on, as its pin names it (`@luke/agent-runner/pins`' `AgentToolPin`): the pinned release fetched once, checked, and kept in the device's own folder.
 *
 * One resolver answers every such binary, every host's Claude Code, Codex,
 * and GitHub CLI among them: the build kept under the
 * state root, at `agent-tools/<NAME>/<VERSION>`, fetched the first time it
 * is asked for.
 *
 * A fetch keeps nothing unless the whole archive arrived at the pin's size
 * and its SHA-256 is the pin's. The archive, up to about 160 megabytes, is
 * streamed to a folder of its own beside the kept one and hashed as it
 * arrives (`staged-fetch.ts`), never held whole: an answer past the size is
 * refused as it arrives, and one whose digest differs is never extracted,
 * its folder removed with it. Only the pinned members are extracted, into
 * that same folder, and moved into place whole. Where the pin names the Developer ID
 * team its binary is signed by, macOS's own `codesign` must verify the
 * binary strictly and name that team, and where it names the digests of the
 * files that run, each must match them, before the build is marked. The
 * mark is written last, so a fetch cut off, or a build refused, leaves
 * nothing that is ever run, and the next ask fetches again. Once a build is
 * answered, the other releases of the same tool beside it are removed, and
 * nothing outside the tool's own folder.
 */

const TOOL_FETCH = {
  /** How long an archive, up to about 160 megabytes, may take to arrive whole, from the request to its last byte. */
  TIMEOUT: Duration.minutes(30),
  /** How long an answer may go without a byte before it is taken as stalled and given up on. */
  STALL: Duration.minutes(1),
  /** Where under the state root every kept build stands, one folder per tool and release. */
  FOLDER: "agent-tools",
  /** The mark written once the build is checked and in place. */
  MARK: ".verified",
} as const;

/** macOS's own `codesign`. */
const CODESIGN = "/usr/bin/codesign";

/** The line `codesign -dv` writes naming the team a binary is signed by. */
const TEAM_LINE = /^TeamIdentifier=(\S+)$/m;

/** A pinned file as it stood once its digest matched: its size, when it was last written, in epoch milliseconds, and its inode. */
const StampSchema = Schema.Struct({
  bytes: Schema.Number,
  modified: Schema.Number,
  inode: Schema.Number,
});

/** What the mark records: the archive's digest the build was checked against, and each pinned file's stamp, by its path under the kept folder. */
const MarkSchema = Schema.Struct({
  sha256: Schema.String,
  files: Schema.Record(Schema.String, StampSchema),
});

type Stamps = typeof MarkSchema.Type.files;

const decodeMark = Schema.decodeUnknownOption(Schema.fromJsonString(MarkSchema));
const encodeMark = Schema.encodeSync(Schema.fromJsonString(MarkSchema));

/** A file's SHA-256, in hex, read a chunk at a time, so a binary of hundreds of megabytes is never held whole. */
const fileDigest = (file: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const hash = createHash("sha256");
    yield* Stream.runForEach(fileSystem.stream(file), (chunk) =>
      Effect.sync(() => void hash.update(chunk)),
    );
    return hash.digest("hex");
  });

/** Whether every file the pin names a digest for stands under `folder` with that digest; true where it names none. */
const filesAsPinned = (pin: AgentToolPin, folder: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    for (const [file, digest] of Object.entries(pin.FILES ?? {})) {
      if ((yield* fileDigest(path.join(folder, file))) !== digest) return false;
    }
    return true;
  });

/** Each file the pin names a digest for, stamped as it stands under `folder` now. */
const stampsOf = (pin: AgentToolPin, folder: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const stamps: Record<string, typeof StampSchema.Type> = {};
    for (const file of Object.keys(pin.FILES ?? {})) {
      const info = yield* fileSystem.stat(path.join(folder, file));
      stamps[file] = {
        bytes: Number(info.size),
        modified: Option.match(info.mtime, { onNone: () => 0, onSome: (at) => at.getTime() }),
        inode: Option.getOrElse(info.ino, () => 0),
      };
    }
    return stamps;
  });

/** Whether two sets of stamps name the same files, each the same size, written at the same time, and the same inode. */
function sameStamps(left: Stamps, right: Stamps): boolean {
  const files = Object.keys(left);
  return (
    files.length === Object.keys(right).length &&
    files.every((file) => {
      const [was, now] = [left[file], right[file]];
      return (
        was !== undefined &&
        now !== undefined &&
        was.bytes === now.bytes &&
        was.modified === now.modified &&
        was.inode === now.inode
      );
    })
  );
}

/** The mark written in the kept build, its files stamped as they stand now, just after their digests matched. */
const markWritten = (pin: AgentToolPin, folder: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const files = yield* stampsOf(pin, folder);
    yield* fileSystem.writeFileString(
      path.join(folder, TOOL_FETCH.MARK),
      encodeMark({ sha256: pin.SHA256, files }),
    );
  });

/** Whether `binary` is signed as its pin says: verified strictly by `codesign`, and by the pin's team. */
const signedAsPinned = (binary: string, team: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const verified = yield* Effect.flatMap(
        ChildProcess.make(CODESIGN, ["--verify", "--strict", binary], {
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
        }),
        (handle) => handle.exitCode,
      );
      if (Number(verified) !== 0) return false;
      const described = yield* ChildProcess.make(CODESIGN, ["-dv", binary], {
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
 * signature and its files' digests where the pin names them, and marked;
 * fails where any step does.
 */
const fetchTool = Effect.fnUntraced(function* (pin: AgentToolPin, folder: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* stagedFolder(
    { parent: path.dirname(folder), prefix: `.${pin.NAME}-`, target: folder },
    (staging) =>
      Effect.gen(function* () {
        const saved = path.join(staging, "archive");
        const archive = yield* streamedArchive(pin.ARCHIVE, saved, {
          maxBytes: pin.BYTES,
          stall: TOOL_FETCH.STALL,
          timeout: TOOL_FETCH.TIMEOUT,
        });
        // Note that nothing of an archive short of the pin's size, or whose digest is not the pin's, is extracted.
        if (archive.bytes !== pin.BYTES) return yield* Effect.fail("short");
        if (archive.sha256 !== pin.SHA256) return yield* Effect.fail("checksum");
        yield* unpackedArchive(
          saved,
          staging,
          pin.MEMBERS.map((member) => `${pin.ROOT}/${member}`),
        );
        return path.join(staging, pin.ROOT);
      }),
  );
  if (pin.TEAM !== undefined && !(yield* signedAsPinned(path.join(folder, pin.BINARY), pin.TEAM))) {
    yield* fileSystem.remove(folder, { recursive: true, force: true });
    return yield* Effect.fail("signature");
  }
  if (!(yield* filesAsPinned(pin, folder))) {
    yield* fileSystem.remove(folder, { recursive: true, force: true });
    return yield* Effect.fail("files");
  }
  yield* markWritten(pin, folder);
});

/**
 * Whether the build kept in `folder` is still the one checked: its mark
 * names the pin's archive and every pinned file still has the size,
 * modification time, and inode it had once its digest matched. Where a
 * stamp differs, or a mark from before stamps holds none, the files are
 * read again and the mark rewritten where their digests still match.
 *
 * Note that the files are not read again at every gate open, because a
 * host's kept builds run to about 650 megabytes, whose digests would cost
 * every open seconds of reading. A file replaced since has another inode,
 * and one rewritten in place a later modification time (npm's archives all
 * carry the same one, from 1985), which only something setting it back on
 * purpose would hide; what could do that in the device's own state folder
 * could as well change the program that checks it.
 */
const keptAsChecked = (pin: AgentToolPin, folder: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const mark = decodeMark(yield* fileSystem.readFileString(path.join(folder, TOOL_FETCH.MARK)));
    const stamps = yield* stampsOf(pin, folder);
    if (
      Option.exists(mark, (each) => each.sha256 === pin.SHA256 && sameStamps(each.files, stamps))
    ) {
      return true;
    }
    if (!(yield* filesAsPinned(pin, folder))) return false;
    yield* markWritten(pin, folder);
    return true;
  }).pipe(Effect.orElseSucceed(() => false));

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
 * caller that names it before it is had, as a device registers and launches
 * its agents' CLIs from where they will be (`localAgentClis`).
 */
export function keptToolBinary(stateRoot: string, pin: AgentToolPin): string {
  return [stateRoot, TOOL_FETCH.FOLDER, pin.NAME, pin.VERSION, pin.BINARY].join("/");
}

/**
 * The pinned binary a device's local agents run on: the kept build where it
 * was checked and marked and its files still stand as checked, and
 * otherwise the build fetched now; none where it cannot be had, which the
 * caller asks again later. A caller asks for a tool once at a time.
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
  // Note that a kept build's files are checked before it is answered, since anything of the developer's could
  // have written them since: a binary changed since is fetched again.
  const kept = marked && (yield* keptAsChecked(pin, folder));
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
