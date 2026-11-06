import { webSocketOrigin, wireUuidSchema } from "@repo/features";
import {
  MIRROR_BOUNDS,
  MIRROR_FRAME,
  type MirrorFrame,
  type MirrorRequest,
  mirrorFrameSchema,
} from "@repo/features/sandbox-mirror-wire";
import {
  SANDBOX_TUNNEL,
  TUNNEL_CLOSE,
  TUNNEL_FRAME,
  TUNNEL_KIND,
  tunnelFrameSchema,
} from "@repo/features/sandbox-tunnel-wire";
import { GATEWAY_METHOD, RefusedRefusal, readParams } from "@repo/gateway";
import { EXCESS_KEYS, unparsedWire } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import {
  Data,
  Deferred,
  Duration,
  Effect,
  FiberMap,
  Option,
  Path,
  Result,
  Schedule,
  Schema,
  type Scope,
  Stream,
} from "effect";
import { Base64 } from "effect/encoding";
import * as FileSystem from "effect/FileSystem";
import { ChildProcess, type ChildProcessSpawner } from "effect/process";
import type { AccountComposer } from "./compose-account.js";
import type { OpenTerminalSocket, TerminalSocket } from "./compose-terminals.js";
import type { Composer } from "./composer.js";
import type { MirrorPlatformSeam } from "./effect/seams.js";
import type { HOST_PLATFORM_CONCERN, PlatformConcernMethods } from "./host-concerns.js";
import type { HostKernel } from "./host-kernel.js";
import { mirrorDeleted, mirrorMatched, mirrorWritten } from "./mirror-disk.js";
import { openedUnderCredential } from "./relay-credential.js";
import type { RunMode } from "./run-mode.js";

export const MIRROR_RECONNECT = {
  FIRST: Duration.seconds(1),
  LONGEST: Duration.seconds(30),
} as const;

const SCRIPT_WITHIN = {
  WORKTREE: Duration.minutes(25),
  LIST: Duration.minutes(2),
} as const;

const WORKTREE_FOLDER = "repository";

const CHANNEL = 0;

const RECONNECT = Schedule.exponential(MIRROR_RECONNECT.FIRST).pipe(
  Schedule.modifyDelay(({ duration }) =>
    Effect.succeed(Duration.min(duration, MIRROR_RECONNECT.LONGEST)),
  ),
);

const TUNNEL_ENDING = {
  DROPPED: "dropped",
  GONE: "gone",
} as const;

type TunnelEnding = (typeof TUNNEL_ENDING)[keyof typeof TUNNEL_ENDING];

class MirrorDropped extends Data.TaggedError("MirrorDropped") {}

class MirrorGone extends Data.TaggedError("MirrorGone") {}

const mirrorEnsureParamsSchema = Schema.Struct({ agentId: wireUuidSchema });

const readId = readEither(wireUuidSchema);
const readTunnelFrame = readEither(Schema.fromJsonString(tunnelFrameSchema), {
  excess: EXCESS_KEYS.DROP,
});
const readMirrorFrame = readEither(Schema.fromJsonString(mirrorFrameSchema), {
  excess: EXCESS_KEYS.DROP,
});

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface MirroredAgent {
  readonly repository: string | null;
  readonly archivedAt?: number | undefined;
  readonly machine?: string | undefined;
}

export interface MirrorsDependencies {
  kernel: Pick<HostKernel, "hostedServiceBaseUrl"> & {
    runMode: Pick<RunMode, "sendsNetwork">;
  };
  account: Pick<AccountComposer, "credential">;
  openSocket: OpenTerminalSocket;
  platform: MirrorPlatformSeam;
  agentListed: (agentId: string) => MirroredAgent | undefined;
  listings: Effect.Effect<Stream.Stream<unknown>, never, Scope.Scope>;
}

type MirrorMethods = PlatformConcernMethods<typeof HOST_PLATFORM_CONCERN.MIRRORS>;

interface Mirror {
  readonly made: Deferred.Deferred<string, MirrorGone>;
}

function tunnelAddress(socketOrigin: string, agentId: string, wake: boolean): string {
  const query = new URLSearchParams({
    [SANDBOX_TUNNEL.QUERY.AGENT]: agentId,
    [SANDBOX_TUNNEL.QUERY.KIND]: TUNNEL_KIND.MIRROR,
  });
  if (wake) query.set(SANDBOX_TUNNEL.QUERY.WAKE, SANDBOX_TUNNEL.WAKE_ASKED);
  return `${socketOrigin}${SANDBOX_TUNNEL.PATH}?${query}`;
}

function mirrorMessage(text: string): MirrorFrame | undefined {
  const frame = Result.getOrUndefined(readTunnelFrame(unparsedWire(text)));
  if (frame?.type !== TUNNEL_FRAME.DATA || frame.channel !== CHANNEL) return undefined;
  return Result.getOrUndefined(readMirrorFrame(unparsedWire(decoder.decode(frame.data))));
}

function requestFrame(request: MirrorRequest): string {
  return JSON.stringify({
    type: TUNNEL_FRAME.DATA,
    channel: CHANNEL,
    data: Base64.encode(encoder.encode(JSON.stringify(request))),
  });
}

const ran = (script: string, within: Duration.Duration) =>
  Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make("/bin/sh", ["-c", script], {
        stdin: "ignore",
        stderr: "ignore",
      });
      const [printed, code] = yield* Effect.all(
        [Stream.mkString(Stream.decodeText(handle.stdout)), handle.exitCode],
        { concurrency: "unbounded" },
      );
      return Number(code) === 0 ? Option.some(printed) : Option.none<string>();
    }),
  ).pipe(
    Effect.timeoutOption(within),
    Effect.map(Option.flatten),
    Effect.orElseSucceed(() => Option.none<string>()),
  );

export function composeMirrors(
  dependencies: MirrorsDependencies,
): Effect.Effect<
  Composer & { readonly methods: MirrorMethods },
  never,
  Scope.Scope | FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
> {
  return Effect.gen(function* () {
    const { kernel, account, openSocket, platform, agentListed } = dependencies;
    const context = yield* Effect.context<
      FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
    >();
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const fibers = yield* FiberMap.make<string>();
    const mirrors = new Map<string, Mirror>();
    const socketOrigin = webSocketOrigin(kernel.hostedServiceBaseUrl);

    const folderOf = (agentId: string) => path.join(platform.folder, agentId);
    const worktreeOf = (agentId: string) => path.join(folderOf(agentId), WORKTREE_FOLDER);
    const worktreeStands = (agentId: string) =>
      Effect.orElseSucceed(fileSystem.exists(path.join(worktreeOf(agentId), ".git")), () => false);

    const made = (agentId: string, base: string) =>
      Effect.gen(function* () {
        const worktree = worktreeOf(agentId);
        if (yield* worktreeStands(agentId)) return worktree;
        const repository = agentListed(agentId)?.repository;
        if (repository === undefined || repository === null) {
          return yield* Effect.fail(new MirrorDropped());
        }
        const script = platform.worktreeScript({ repository, worktree, base });
        const finished = yield* ran(script, SCRIPT_WITHIN.WORKTREE);
        if (Option.isNone(finished)) return yield* Effect.fail(new MirrorDropped());
        return worktree;
      });

    const matched = (
      agentId: string,
      socket: TerminalSocket,
      files: Extract<MirrorFrame, { readonly type: "manifest" }>["files"],
    ) =>
      Effect.gen(function* () {
        const worktree = worktreeOf(agentId);
        const listing = yield* ran(platform.listScript(worktree), SCRIPT_WITHIN.LIST);
        if (Option.isNone(listing)) return yield* Effect.fail(new MirrorDropped());
        const listed = listing.value.split("\0").filter((file) => file !== "");
        const asked = yield* mirrorMatched(worktree, listed, files);
        for (let at = 0; at < asked.length; at += MIRROR_BOUNDS.REQUEST_PATHS) {
          const paths = asked.slice(at, at + MIRROR_BOUNDS.REQUEST_PATHS);
          yield* socket.send({ text: requestFrame({ type: MIRROR_FRAME.REQUEST, paths }) });
        }
      });

    const applied = (
      agentId: string,
      mirror: Mirror,
      socket: TerminalSocket,
      message: MirrorFrame,
    ) =>
      Effect.gen(function* () {
        switch (message.type) {
          case MIRROR_FRAME.HEADER:
            yield* Deferred.succeed(mirror.made, yield* made(agentId, message.base));
            return;
          case MIRROR_FRAME.MANIFEST:
            return yield* matched(agentId, socket, message.files);
          case MIRROR_FRAME.FILE:
            yield* mirrorWritten(worktreeOf(agentId), message);
            return;
          case MIRROR_FRAME.DELETE:
            yield* mirrorDeleted(worktreeOf(agentId), message.path);
            return;
          case MIRROR_FRAME.SKIPPED:
            return;
        }
      });

    const attempt = (agentId: string, mirror: Mirror) =>
      Effect.scoped(
        Effect.gen(function* () {
          if (socketOrigin === undefined) return yield* Effect.fail(new MirrorDropped());
          const address = tunnelAddress(socketOrigin, agentId, !(yield* worktreeStands(agentId)));
          const opening = yield* openedUnderCredential(account.credential, openSocket, address);
          if (!("socket" in opening)) return yield* Effect.fail(new MirrorDropped());
          const { socket } = opening;
          yield* socket.send({
            text: JSON.stringify({ type: TUNNEL_FRAME.OPEN, channel: CHANNEL }),
          });
          let inStep = false;
          let closeCode: number | undefined;
          yield* Stream.runForEach(socket.arrivals, (arrival) => {
            if ("close" in arrival) {
              closeCode = arrival.close;
              return Effect.void;
            }
            const message = "text" in arrival ? mirrorMessage(arrival.text) : undefined;
            if (message === undefined) return Effect.void;
            return Effect.andThen(
              applied(agentId, mirror, socket, message),
              Effect.sync(() => {
                if (message.type === MIRROR_FRAME.HEADER) inStep = true;
              }),
            );
          });
          if (closeCode === TUNNEL_CLOSE.GONE) return TUNNEL_ENDING.GONE;
          if (!inStep) return yield* Effect.fail(new MirrorDropped());
          return TUNNEL_ENDING.DROPPED;
        }),
      );

    const removed = (agentId: string) =>
      Effect.gen(function* () {
        const mirror = mirrors.get(agentId);
        mirrors.delete(agentId);
        if (mirror !== undefined) yield* Deferred.fail(mirror.made, new MirrorGone());
        yield* ran(platform.removeScript(worktreeOf(agentId)), SCRIPT_WITHIN.LIST);
        yield* Effect.ignore(
          fileSystem.remove(folderOf(agentId), { recursive: true, force: true }),
        );
      });

    const kept = (agentId: string, mirror: Mirror) =>
      Effect.retry(attempt(agentId, mirror), RECONNECT).pipe(
        Effect.repeat({
          schedule: Schedule.spaced(MIRROR_RECONNECT.FIRST),
          until: (ended: TunnelEnding) => ended === TUNNEL_ENDING.GONE,
        }),
        Effect.andThen(removed(agentId)),
      );

    const started = (agentId: string) =>
      Effect.gen(function* () {
        const standing = mirrors.get(agentId);
        if (standing !== undefined) return standing;
        const mirror: Mirror = { made: yield* Deferred.make<string, MirrorGone>() };
        mirrors.set(agentId, mirror);
        if (yield* worktreeStands(agentId))
          yield* Deferred.succeed(mirror.made, worktreeOf(agentId));
        yield* FiberMap.run(fibers, agentId, Effect.provideContext(kept(agentId, mirror), context));
        return mirror;
      });

    const archivedRemoved = Effect.suspend(() =>
      Effect.forEach(
        [...mirrors.keys()].filter((agentId) => agentListed(agentId)?.archivedAt !== undefined),
        (agentId) =>
          FiberMap.run(fibers, agentId, Effect.provideContext(removed(agentId), context)),
        { discard: true },
      ),
    );

    const methods: MirrorMethods = {
      [GATEWAY_METHOD.MIRRORS_ENSURE]: (params) =>
        Effect.gen(function* () {
          const { agentId } = yield* readParams(
            mirrorEnsureParamsSchema,
            params,
            "ensuring a mirror names the agent",
          );
          const agent = agentListed(agentId);
          if (
            !kernel.runMode.sendsNetwork ||
            agent === undefined ||
            agent.archivedAt !== undefined ||
            agent.machine !== undefined
          ) {
            return yield* Effect.fail(
              new RefusedRefusal({ message: "no cloud agent of this account to mirror" }),
            );
          }
          const mirror = yield* started(agentId);
          const folder = yield* Effect.mapError(
            Deferred.await(mirror.made),
            () => new RefusedRefusal({ message: "the agent is gone" }),
          );
          return { folder };
        }),
    };

    const lifetime = Effect.gen(function* () {
      if (!kernel.runMode.sendsNetwork) return;
      const standing = yield* Effect.orElseSucceed(
        fileSystem.readDirectory(platform.folder),
        () => [],
      );
      for (const name of standing) {
        if (Result.isSuccess(readId(unparsedWire(name)))) yield* started(name);
      }
      const listings = yield* dependencies.listings;
      yield* Effect.forkScoped(Stream.runForEach(listings, () => archivedRemoved));
    });

    return { methods, lifetime };
  });
}
