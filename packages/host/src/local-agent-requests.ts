import {
  DEVICE_AGENT_BOUNDS,
  DEVICE_AGENT_REQUEST_KIND,
  type DeviceAgentAnswer,
  type DeviceAgentLayout,
  type DeviceAgentRequest,
  deviceAgentReadArgsSchema,
} from "@luke/features/device-agent-wire";
import { Effect, Option, Schema } from "effect";
import * as FileSystem from "effect/FileSystem";
import { agentFolders } from "./local-agent-box.js";

/**
 * local-agent-requests.ts -- what a local agent's tools ask of this Mac, answered only inside the agent's own folder: a file read.
 *
 * The service asks for a path it built under the agent's folder
 * (`deviceAgentLayout`), but a path is only words: a `..`, or a symlink the
 * agent made in its worktree, could name any file the developer can read.
 * So every target is resolved to its real path first, every symlink
 * followed, and answered only where that real path stands inside the real
 * path of the agent's folder, whose temp folder, worktree, attachments, and
 * installed skills all stand beneath it. Anything else is refused as a path
 * that names no file the agent may read, and a read answers no bytes. A
 * path that does not exist resolves to nothing, and is refused the same
 * way. A read inside the agent's own `gh` sign-in, where a host keeps the
 * agent's GitHub token, is refused too, however it is reached, so no token
 * reaches a tool's answer: gh's config in the agent's home, where a host
 * whose agents run on the box writes it (`local-agent-box.ts`), and the
 * folder a host kept it in before (`layout.githubConfig`).
 *
 * A read answers at most the bytes asked for, and never more than one past
 * `DEVICE_AGENT_BOUNDS.MAX_ANSWER_BYTES`, so the caller still sees a file
 * larger than its bound.
 */

const decodeReadArgs = Schema.decodeUnknownOption(deviceAgentReadArgsSchema);

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
  layout: Pick<DeviceAgentLayout, "folder">,
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
const answeredRead = (layout: DeviceAgentLayout, args: unknown) =>
  Effect.gen(function* () {
    const read = decodeReadArgs(args);
    const answer = (bytes: Uint8Array | null): DeviceAgentAnswer => ({
      kind: DEVICE_AGENT_REQUEST_KIND.READ_FILE,
      bytes,
    });
    if (Option.isNone(read)) return answer(null);
    const path = yield* confinedPath(layout, read.value.path);
    if (Option.isNone(path)) return answer(null);
    const fileSystem = yield* FileSystem.FileSystem;
    for (const sealed of [layout.githubConfig, agentFolders(layout.folder).gh]) {
      const withheld = yield* Effect.option(fileSystem.realPath(sealed));
      if (Option.isSome(withheld) && within(withheld.value, path.value)) return answer(null);
    }
    const bound = Math.max(
      0,
      Math.min(read.value.maxBytes, DEVICE_AGENT_BOUNDS.MAX_ANSWER_BYTES + 1),
    );
    return answer(yield* readBounded(path.value, bound));
  });

/** What one request of a local agent's tools answers, inside the agent's folder given. */
export const answeredLocalAgentRequest = (
  layout: DeviceAgentLayout,
  request: Pick<DeviceAgentRequest, "kind" | "args">,
): Effect.Effect<DeviceAgentAnswer, never, FileSystem.FileSystem> =>
  answeredRead(layout, request.args);
