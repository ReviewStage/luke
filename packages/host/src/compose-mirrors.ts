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
  Exit,
  Fiber,
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

/**
 * compose-mirrors.ts -- cloud agents' mirrors on this Mac: a local copy of each agent's checkout, kept in step over the agent's mirror tunnel, that a dev server can hot-reload from.
 *
 * `MIRRORS_ENSURE` answers an agent's mirror folder,
 * `~/.vespin/mirrors/<agentId>/repository`. The first ensure makes it a
 * worktree of this Mac's shared clone of the repository, detached at the
 * header's `base` (`MirrorPlatform`'s scripts), and answers as soon as the
 * worktree stands. Note that the default branch is had from GitHub beside
 * the worktree's place while the tunnel opens, because the header waits on
 * the sandbox waking, and from it the worktree fetches only what its base
 * changes. While it has none, its tunnel asks the service to wake a
 * stopped sandbox to build it (`SANDBOX_TUNNEL.QUERY.WAKE`), and once it
 * stands it never asks again, so a stopped sandbox stays stopped and the
 * mirror waits for it. From then on the mirror holds one tunnel of the
 * `MIRROR` kind open (`@repo/features/sandbox-tunnel-wire`) with one channel on it,
 * whose messages are the mirror's own (`@repo/features/sandbox-mirror-wire`):
 * each manifest is matched against the mirror's own files, every file whose
 * hash differs asked for and every file the manifest lacks deleted, and each
 * `file` and `delete` written as it arrives (`mirror-disk.ts`). A local edit
 * is simply overwritten.
 *
 * There is one recovery path, which is to reconnect and match: no cursor,
 * no change log, nothing stored between connections. Any socket that drops,
 * is refused, closes as idle, finds the sandbox not running, or fails a
 * step, is opened again on `RECONNECT`, backing off to every 30 seconds,
 * for as long as the mirror stands; the next manifest
 * brings the mirror back in step. Every mirror on disk is kept so from the
 * host's start. A mirror is taken away, its worktree removed from the shared
 * clone and its folder deleted, when the task list shows its agent archived,
 * or when the tunnel closes as gone: the agent archived, or no agent this
 * account reaches, which is how the first try after the host's start finds
 * a mirror whose agent is gone. Only a cloud agent has a mirror, and only the
 * desktop runs this concern. A file's name, bytes, and hash are the agent's
 * and are never logged, traced, or counted.
 */

/** How long a mirror waits before it opens its tunnel again: from `FIRST`, twice as long each time, never longer than `LONGEST`. */
export const MIRROR_RECONNECT = {
  FIRST: Duration.seconds(1),
  LONGEST: Duration.seconds(30),
} as const;

/** How long a script may run: making a worktree may clone a large repository first, as a local agent's does. */
const SCRIPT_WITHIN = {
  WORKTREE: Duration.minutes(25),
  LIST: Duration.minutes(2),
} as const;

/** The folder under a mirror's own that holds its worktree. */
const WORKTREE_FOLDER = "repository";

/** The one channel a mirror opens on its tunnel. */
const CHANNEL = 0;

const RECONNECT = Schedule.exponential(MIRROR_RECONNECT.FIRST).pipe(
  Schedule.modifyDelay(({ duration }) =>
    Effect.succeed(Duration.min(duration, MIRROR_RECONNECT.LONGEST)),
  ),
);

/** How one tunnel's life ended, where the mirror does not try again on its own schedule. */
const TUNNEL_ENDING = {
  /** The mirror was in step and the socket closed: it opens again, its wait started over. */
  DROPPED: "dropped",
  /** The agent is archived, or no agent this account reaches: the mirror is taken away. */
  GONE: "gone",
} as const;

type TunnelEnding = (typeof TUNNEL_ENDING)[keyof typeof TUNNEL_ENDING];

/** The tunnel dropped, or never opened, or a step failed, before the mirror heard its header. */
class MirrorDropped extends Data.TaggedError("MirrorDropped") {}

/** The mirror was taken away before its worktree stood. */
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

/** The agent as the task list carries it, as far as a mirror reads it. */
export interface MirroredAgent {
  readonly repository: string | null;
  readonly archivedAt?: number | undefined;
  /** Set only for a local agent on its starter's device, which has no mirror. */
  readonly machine?: string | undefined;
}

export interface MirrorsDependencies {
  kernel: Pick<HostKernel, "hostedServiceBaseUrl"> & {
    runMode: Pick<RunMode, "sendsNetwork">;
  };
  account: Pick<AccountComposer, "credential">;
  openSocket: OpenTerminalSocket;
  platform: MirrorPlatformSeam;
  /** The agent as the task list holds it now; none where it lists no such agent. */
  agentListed: (agentId: string) => MirroredAgent | undefined;
  /** The task list as each drawing of it stands, from the caller's listening until its scope closes, which archives are read again on. */
  listings: Effect.Effect<Stream.Stream<unknown>, never, Scope.Scope>;
}

type MirrorMethods = PlatformConcernMethods<typeof HOST_PLATFORM_CONCERN.MIRRORS>;

/** One mirror kept on this Mac: the folder its worktree stands in, once it does, and whether its prefetch has ended. */
interface Mirror {
  readonly made: Deferred.Deferred<string, MirrorGone>;
  readonly prefetched: Deferred.Deferred<boolean>;
}

/** The mirror tunnel's address for an agent, asking to wake a stopped sandbox where `wake` says so. */
function tunnelAddress(socketOrigin: string, agentId: string, wake: boolean): string {
  const query = new URLSearchParams({
    [SANDBOX_TUNNEL.QUERY.AGENT]: agentId,
    [SANDBOX_TUNNEL.QUERY.KIND]: TUNNEL_KIND.MIRROR,
  });
  if (wake) query.set(SANDBOX_TUNNEL.QUERY.WAKE, SANDBOX_TUNNEL.WAKE_ASKED);
  return `${socketOrigin}${SANDBOX_TUNNEL.PATH}?${query}`;
}

/** A text frame as a mirror message on the mirror's channel, or nothing where it is none this build reads. */
function mirrorMessage(text: string): MirrorFrame | undefined {
  const frame = Result.getOrUndefined(readTunnelFrame(unparsedWire(text)));
  if (frame?.type !== TUNNEL_FRAME.DATA || frame.channel !== CHANNEL) return undefined;
  return Result.getOrUndefined(readMirrorFrame(unparsedWire(decoder.decode(frame.data))));
}

/** A request as the data frame it rides in. */
function requestFrame(request: MirrorRequest): string {
  return JSON.stringify({
    type: TUNNEL_FRAME.DATA,
    channel: CHANNEL,
    data: Base64.encode(encoder.encode(JSON.stringify(request))),
  });
}

/** A script run once with `/bin/sh`: what it printed where it exited 0 within the bound, none otherwise. */
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

    /** The worktree made where none stands, detached at the header's `base`; the folder once it stands. */
    const made = (agentId: string, mirror: Mirror, base: string) =>
      Effect.gen(function* () {
        const worktree = worktreeOf(agentId);
        if (yield* worktreeStands(agentId)) return worktree;
        const repository = agentListed(agentId)?.repository;
        if (repository === undefined || repository === null) {
          return yield* Effect.fail(new MirrorDropped());
        }
        const prefetched = yield* Deferred.await(mirror.prefetched);
        const script = platform.worktreeScript({ repository, worktree, base, prefetched });
        const finished = yield* ran(script, SCRIPT_WITHIN.WORKTREE);
        if (Option.isNone(finished)) return yield* Effect.fail(new MirrorDropped());
        return worktree;
      });

    /** A manifest matched against the mirror, what differs asked for in requests of at most `REQUEST_PATHS`. */
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

    /** One mirror message applied, in the order the bridge sent it. */
    const applied = (
      agentId: string,
      mirror: Mirror,
      socket: TerminalSocket,
      message: MirrorFrame,
    ) =>
      Effect.gen(function* () {
        switch (message.type) {
          case MIRROR_FRAME.HEADER:
            yield* Deferred.succeed(mirror.made, yield* made(agentId, mirror, message.base));
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

    /**
     * One tunnel's life: opened, read until it closes, and its close read as
     * how the mirror stands. A drop before the header was applied fails, for
     * the backoff to wait on; one after it answers dropped, so the wait
     * starts over; a gone close answers gone.
     */
    const attempt = (agentId: string, mirror: Mirror) =>
      Effect.scoped(
        Effect.gen(function* () {
          if (socketOrigin === undefined) return yield* Effect.fail(new MirrorDropped());
          // Note that only a mirror with no worktree yet asks to wake the sandbox, once it stands it never does.
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

    /** The mirror taken away: its worktree removed from the shared clone, and its folder deleted. */
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

    /** The default branch checked out beside the worktree's place where none stands, and whether that ended well, false however else it ends. */
    const prefetched = (agentId: string, mirror: Mirror) =>
      Effect.gen(function* () {
        const repository = agentListed(agentId)?.repository;
        if (repository === undefined || repository === null) return false;
        if (yield* worktreeStands(agentId)) return false;
        const script = platform.prefetchScript({ repository, worktree: worktreeOf(agentId) });
        return Option.isSome(yield* ran(script, SCRIPT_WITHIN.WORKTREE));
      }).pipe(
        Effect.onExit((exit) =>
          Deferred.succeed(mirror.prefetched, Exit.isSuccess(exit) && exit.value),
        ),
      );

    /** The mirror kept in step, its prefetch run beside its first tunnel, its tunnel opened again on `RECONNECT`, and `FIRST` after one that was in step, until its agent is gone. */
    const kept = (agentId: string, mirror: Mirror) =>
      Effect.gen(function* () {
        const prefetch = yield* Effect.forkChild(prefetched(agentId, mirror));
        yield* Effect.retry(attempt(agentId, mirror), RECONNECT).pipe(
          Effect.repeat({
            schedule: Schedule.spaced(MIRROR_RECONNECT.FIRST),
            until: (ended: TunnelEnding) => ended === TUNNEL_ENDING.GONE,
          }),
        );
        yield* Fiber.interrupt(prefetch);
        yield* removed(agentId);
      });

    /** The mirror kept for an agent, its tunnel's fiber started where none runs; made at once where its worktree already stands, whether or not the sandbox runs. */
    const started = (agentId: string) =>
      Effect.gen(function* () {
        const standing = mirrors.get(agentId);
        if (standing !== undefined) return standing;
        const mirror: Mirror = {
          made: yield* Deferred.make<string, MirrorGone>(),
          prefetched: yield* Deferred.make<boolean>(),
        };
        mirrors.set(agentId, mirror);
        if (yield* worktreeStands(agentId))
          yield* Deferred.succeed(mirror.made, worktreeOf(agentId));
        yield* FiberMap.run(fibers, agentId, Effect.provideContext(kept(agentId, mirror), context));
        return mirror;
      });

    /** Every mirror whose agent the task list shows archived, taken away. */
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
