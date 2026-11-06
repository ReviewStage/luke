import {
  DEVICE_AGENT_BOUNDS,
  DEVICE_AGENT_REQUEST_KIND,
  type DeviceAgentAnswer,
  type DeviceAgentLayout,
  type DeviceAgentRequest,
  deviceAgentReadArgsSchema,
} from "@repo/features/device-agent-wire";
import { Effect, Option, Schema } from "effect";
import * as FileSystem from "effect/FileSystem";
import { agentFolders } from "./local-agent-box.js";

const decodeReadArgs = Schema.decodeUnknownOption(deviceAgentReadArgsSchema);

function within(root: string, path: string): boolean {
  const base = root.replace(/\/+$/u, "");
  return path === base || path.startsWith(`${base}/`);
}

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

export const answeredLocalAgentRequest = (
  layout: DeviceAgentLayout,
  request: Pick<DeviceAgentRequest, "kind" | "args">,
): Effect.Effect<DeviceAgentAnswer, never, FileSystem.FileSystem> =>
  answeredRead(layout, request.args);
