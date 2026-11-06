import { createHash } from "node:crypto";
import type { AgentToolPin } from "@repo/agent-runner/pins";
import { Duration, Effect, Option, Path, Schema, Stream } from "effect";
import * as FileSystem from "effect/FileSystem";
import type * as HttpClient from "effect/http/HttpClient";
import { ChildProcess, type ChildProcessSpawner } from "effect/process";
import { stagedFolder, streamedArchive, unpackedArchive } from "./staged-fetch.js";

const TOOL_FETCH = {
  TIMEOUT: Duration.minutes(30),
  STALL: Duration.minutes(1),
  FOLDER: "agent-tools",
  MARK: ".verified",
} as const;

const CODESIGN = "/usr/bin/codesign";

const TEAM_LINE = /^TeamIdentifier=(\S+)$/m;

const StampSchema = Schema.Struct({
  bytes: Schema.Number,
  modified: Schema.Number,
  inode: Schema.Number,
});

const MarkSchema = Schema.Struct({
  sha256: Schema.String,
  files: Schema.Record(Schema.String, StampSchema),
});

type Stamps = typeof MarkSchema.Type.files;

const decodeMark = Schema.decodeUnknownOption(Schema.fromJsonString(MarkSchema));
const encodeMark = Schema.encodeSync(Schema.fromJsonString(MarkSchema));

const fileDigest = (file: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const hash = createHash("sha256");
    yield* Stream.runForEach(fileSystem.stream(file), (chunk) =>
      Effect.sync(() => void hash.update(chunk)),
    );
    return hash.digest("hex");
  });

const filesAsPinned = (pin: AgentToolPin, folder: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    for (const [file, digest] of Object.entries(pin.FILES ?? {})) {
      if ((yield* fileDigest(path.join(folder, file))) !== digest) return false;
    }
    return true;
  });

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
      const printed = yield* Stream.mkString(Stream.decodeText(described.stderr));
      yield* described.exitCode;
      return TEAM_LINE.exec(printed)?.[1] === team;
    }),
  );

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

const otherVersionsRemoved = (pin: AgentToolPin, toolFolder: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    for (const entry of yield* fileSystem.readDirectory(toolFolder)) {
      if (entry === pin.VERSION || entry.startsWith(".")) continue;
      yield* fileSystem.remove(path.join(toolFolder, entry), { recursive: true, force: true });
    }
  }).pipe(Effect.ignore);

export function keptToolBinary(stateRoot: string, pin: AgentToolPin): string {
  return [stateRoot, TOOL_FETCH.FOLDER, pin.NAME, pin.VERSION, pin.BINARY].join("/");
}

export const localAgentTool = Effect.fnUntraced(function* (
  stateRoot: string,
  pin: AgentToolPin,
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
