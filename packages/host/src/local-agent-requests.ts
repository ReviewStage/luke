import {
  MAC_AGENT_BOUNDS,
  MAC_AGENT_REQUEST_KIND,
  type MacAgentAnswer,
  type MacAgentLayout,
  type MacAgentRequest,
  macAgentCommandArgsSchema,
  macAgentReadArgsSchema,
} from "@luke/features/mac-agent-wire";
import { Duration, Effect, Fiber, Option, Ref, Schema, Stream } from "effect";
import * as FileSystem from "effect/FileSystem";
import { ChildProcess, type ChildProcessSpawner } from "effect/process";

/**
 * local-agent-requests.ts -- what a local agent's tools ask of this Mac, answered only inside the agent's own folder: a file read, or a command run in its worktree as `show_code` runs one.
 *
 * The service asks for a path it built under the agent's folder
 * (`macAgentLayout`), but a path is only words: a `..`, or a symlink the
 * agent made in its worktree, could name any file the developer can read.
 * So every target is resolved to its real path first, every symlink
 * followed, and answered only where that real path stands inside the real
 * path of the agent's folder, whose temp folder, worktree, attachments, and
 * installed skills all stand beneath it. Anything else is refused as a path
 * that names no file the agent may read: a read answers no bytes, and a
 * command does not run. A path that does not exist resolves to nothing,
 * and is refused the same way.
 *
 * A read answers at most the bytes asked for, and never more than one past
 * `MAC_AGENT_BOUNDS.MAX_ANSWER_BYTES`, so the caller still sees a file
 * larger than its bound. A command runs in bash in the worktree, as the
 * leader of a process group of its own, under the app's environment and
 * the one the request names, with nothing on its stdin, and is ended with
 * its group at `LOCAL_AGENT_COMMAND.TIMEOUT`, inside the service's own wait
 * for the answer; each of its outputs keeps its first bytes up to the bound.
 */

const LOCAL_AGENT_COMMAND = {
  /** How long a command runs before its group is ended: inside the service's thirty-second wait for an answer. */
  TIMEOUT: Duration.seconds(25),
  /** How long the group has to end after SIGTERM before it is sent SIGKILL. */
  KILL_GRACE: Duration.seconds(2),
  /** How long the streams are read once the command exited or timed out. */
  DRAIN_GRACE: Duration.seconds(1),
  /** The exit code a command answers where it was not run, as a shell's own for a command it cannot execute. */
  NOT_RUN: 126,
} as const;

/** What a command answers where its worktree does not stand inside the agent's folder. */
const OUTSIDE = "Not run: the agent's worktree is not inside its folder on this Mac.";

/** The most bytes an output keeps, short of the bound by the widest character a cut could leave half of, which decodes as a three-byte replacement. */
const KEPT_OUTPUT_BYTES = MAC_AGENT_BOUNDS.MAX_ANSWER_BYTES - 4;

const decodeReadArgs = Schema.decodeUnknownOption(macAgentReadArgsSchema);
const decodeCommandArgs = Schema.decodeUnknownOption(macAgentCommandArgsSchema);

/** Whether `path`, already real, stands at or under `root`, already real. */
function within(root: string, path: string): boolean {
  const base = root.replace(/\/+$/u, "");
  return path === base || path.startsWith(`${base}/`);
}

/**
 * The real path of `target` where it stands inside the agent's folder, every
 * symlink in either followed; nothing where either cannot be resolved, or
 * the target resolves outside.
 */
const confinedPath = (
  layout: Pick<MacAgentLayout, "folder">,
  target: string,
): Effect.Effect<Option.Option<string>, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    if (!target.startsWith("/")) return Option.none();
    const resolved = yield* Effect.option(fileSystem.realPath(target));
    const root = yield* Effect.option(fileSystem.realPath(layout.folder));
    if (Option.isNone(resolved) || Option.isNone(root)) return Option.none();
    return within(root.value, resolved.value) ? resolved : Option.none();
  });

/** The first `bound` bytes of the regular file at `path`, real and confined; nothing where it is no file or cannot be read. */
const readBounded = (path: string, bound: number) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const info = yield* fileSystem.stat(path);
    if (info.type !== "File") return null;
    if (bound === 0) return new Uint8Array();
    const read = yield* Effect.scoped(
      Effect.flatMap(fileSystem.open(path, { flag: "r" }), (file) => file.readAlloc(bound)),
    );
    return Option.getOrElse(read, () => new Uint8Array());
  }).pipe(Effect.orElseSucceed(() => null));

/** A read asked: the bytes of the file it names, inside the agent's folder; no bytes for anything else. */
const answeredRead = (layout: MacAgentLayout, args: unknown) =>
  Effect.gen(function* () {
    const read = decodeReadArgs(args);
    const answer = (bytes: Uint8Array | null): MacAgentAnswer => ({
      kind: MAC_AGENT_REQUEST_KIND.READ_FILE,
      bytes,
    });
    if (Option.isNone(read)) return answer(null);
    const path = yield* confinedPath(layout, read.value.path);
    if (Option.isNone(path)) return answer(null);
    const bound = Math.max(0, Math.min(read.value.maxBytes, MAC_AGENT_BOUNDS.MAX_ANSWER_BYTES + 1));
    return answer(yield* readBounded(path.value, bound));
  });

interface Kept {
  readonly chunks: readonly Uint8Array[];
  readonly bytes: number;
}

const NOTHING_KEPT: Kept = { chunks: [], bytes: 0 };

/** A chunk kept while the stream is under its bound, and the rest drained. */
function keep(kept: Kept, chunk: Uint8Array): Kept {
  const room = KEPT_OUTPUT_BYTES - kept.bytes;
  if (room <= 0) return kept;
  const taken = chunk.length <= room ? chunk : chunk.subarray(0, room);
  return { chunks: [...kept.chunks, taken], bytes: kept.bytes + taken.length };
}

function textOf(kept: Kept): string {
  // Note that the chunks are decoded as one stream, so a character split across two is read whole.
  const decoder = new TextDecoder();
  return (
    kept.chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join("") + decoder.decode()
  );
}

/** A command run whole in the worktree under its timeout, its group ended as its scope closes. */
const ranCommand = (checkout: string, command: string, env: Readonly<Record<string, string>>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make("/bin/bash", ["-l", "-c", command], {
        cwd: checkout,
        env: { ...env, PAGER: "cat", GIT_PAGER: "cat", GIT_TERMINAL_PROMPT: "0" },
        extendEnv: true,
        stdin: "ignore",
        forceKillAfter: LOCAL_AGENT_COMMAND.KILL_GRACE,
      });
      const stdout = yield* Ref.make(NOTHING_KEPT);
      const stderr = yield* Ref.make(NOTHING_KEPT);
      const drain = (stream: Stream.Stream<Uint8Array, unknown>, into: Ref.Ref<Kept>) =>
        Stream.runForEach(stream, (chunk) => Ref.update(into, (held) => keep(held, chunk)));
      const drains = yield* Effect.forkScoped(
        Effect.all([drain(handle.stdout, stdout), drain(handle.stderr, stderr)], {
          concurrency: 2,
        }),
      );
      const exited = yield* Effect.timeoutOption(handle.exitCode, LOCAL_AGENT_COMMAND.TIMEOUT);
      yield* Effect.ignore(
        Effect.timeoutOption(Fiber.join(drains), LOCAL_AGENT_COMMAND.DRAIN_GRACE),
      );
      const answer: MacAgentAnswer = {
        kind: MAC_AGENT_REQUEST_KIND.RUN_COMMAND,
        exitCode: Option.match(exited, {
          onNone: () => LOCAL_AGENT_COMMAND.NOT_RUN,
          onSome: (code) => Number(code),
        }),
        stdout: textOf(yield* Ref.get(stdout)),
        stderr: textOf(yield* Ref.get(stderr)),
      };
      return answer;
    }),
  );

/** A command asked: run in the agent's worktree where it stands inside the agent's folder; refused otherwise. */
const answeredCommand = (layout: MacAgentLayout, args: unknown) =>
  Effect.gen(function* () {
    const refused = (why: string): MacAgentAnswer => ({
      kind: MAC_AGENT_REQUEST_KIND.RUN_COMMAND,
      exitCode: LOCAL_AGENT_COMMAND.NOT_RUN,
      stdout: "",
      stderr: why,
    });
    const asked = decodeCommandArgs(args);
    if (Option.isNone(asked)) return refused("Not run: the request named no command.");
    const checkout = yield* confinedPath(layout, layout.checkoutPath);
    if (Option.isNone(checkout)) return refused(OUTSIDE);
    return yield* ranCommand(checkout.value, asked.value.command, asked.value.env ?? {}).pipe(
      Effect.catch(() => Effect.succeed(refused("Not run: the command could not be started."))),
    );
  });

/** What one request of a local agent's tools answers, inside the agent's folder given. */
export const answeredLocalAgentRequest = (
  layout: MacAgentLayout,
  request: Pick<MacAgentRequest, "kind" | "args">,
): Effect.Effect<
  MacAgentAnswer,
  never,
  FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner
> =>
  request.kind === MAC_AGENT_REQUEST_KIND.READ_FILE
    ? answeredRead(layout, request.args)
    : answeredCommand(layout, request.args);
