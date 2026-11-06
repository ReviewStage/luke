import type { DeviceAgentUpdate } from "@repo/features";
import {
  DEVICE_ARCH,
  DEVICE_PLATFORM,
  type DeviceAgentRelease,
  type DeviceArch,
  type DevicePlatform,
  HOST_UPDATE,
  HOST_UPDATE_FAILURE_MAX_CHARS,
} from "@repo/features/device-agent-wire";
import { HOST_TARGET, type HostTarget, hostTarballUrl } from "@repo/features/host-release";
import { hostVersionMeets, readHostVersion } from "@repo/features/host-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  Deferred,
  Duration,
  Effect,
  FiberHandle,
  Option,
  Path,
  Ref,
  Result,
  Schedule,
  Stream,
} from "effect";
import * as FileSystem from "effect/FileSystem";
import type * as HttpClient from "effect/http/HttpClient";
import { ChildProcess, type ChildProcessSpawner } from "effect/process";
import type { LocalAgentsUpdate } from "../compose-local-agents.js";
import { Reporter } from "../effect/seams.js";
import {
  type FetchBounds,
  stagedFolder,
  streamedArchive,
  unpackedArchive,
} from "../staged-fetch.js";

const HOST_FETCH: FetchBounds = {
  maxBytes: 256 * 1024 * 1024,
  stall: Duration.minutes(1),
  timeout: Duration.minutes(30),
};

const RETRY_AFTER = Duration.hours(1);

const VERSION_ANSWER = Duration.seconds(30);

const RELEASES = {
  VERSIONS: "versions",
  CURRENT: "current",
  STAGING_PREFIX: ".update-",
  NEXT_LINK: ".current-next",
} as const;

const TARBALL = {
  FILE: "vespin-host.tar.gz",
  ROOT: "vespin-host",
  COMMAND: ["bin", "vespin-host"],
} as const;

const TARGET_OF: {
  readonly [Platform in DevicePlatform]?: { readonly [Arch in DeviceArch]?: HostTarget };
} = {
  [DEVICE_PLATFORM.LINUX]: {
    [DEVICE_ARCH.X64]: HOST_TARGET.LINUX_X64,
    [DEVICE_ARCH.ARM64]: HOST_TARGET.LINUX_ARM64,
  },
  [DEVICE_PLATFORM.DARWIN]: { [DEVICE_ARCH.ARM64]: HOST_TARGET.DARWIN_ARM64 },
};

export function hostTargetOf(platform: DevicePlatform, arch: DeviceArch): HostTarget | undefined {
  return TARGET_OF[platform]?.[arch];
}

export interface HostReleases {
  readonly folder: string;
  readonly running: string;
}

export interface HostUpdateOptions {
  readonly releases: HostReleases;
  readonly version: string;
  readonly target: HostTarget;
}

interface HostUpdate {
  readonly follower: LocalAgentsUpdate;
  readonly ended: Effect.Effect<void>;
}

interface Standing {
  readonly release: DeviceAgentRelease | undefined;
  readonly update: DeviceAgentUpdate | undefined;
}

const NO_UPDATE: Standing = { release: undefined, update: undefined };

type HostUpdateServices =
  | FileSystem.FileSystem
  | Path.Path
  | HttpClient.HttpClient
  | ChildProcessSpawner.ChildProcessSpawner
  | Reporter;

export const hostUpdate = Effect.fnUntraced(function* (options: HostUpdateOptions) {
  const { releases, target } = options;
  const { report } = yield* Reporter;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const services = yield* Effect.context<HostUpdateServices>();
  const standing = yield* Ref.make<Standing>(NO_UPDATE);
  const fetching = yield* FiberHandle.make<void, never>();
  const switched = yield* Deferred.make<void>();
  const versions = path.join(releases.folder, RELEASES.VERSIONS);
  const current = path.join(releases.folder, RELEASES.CURRENT);
  const folderOf = (version: string) => path.join(versions, version);

  const newer = (version: string) =>
    readHostVersion(version)?.join(".") === version &&
    !hostVersionMeets(options.version, version) &&
    version !== releases.running;

  const currentNamed = Effect.map(
    Effect.option(fileSystem.readLink(current)),
    Option.map((link) => path.basename(link)),
  );

  const stagedRemoved = (release: DeviceAgentRelease | undefined) =>
    Effect.gen(function* () {
      if (release === undefined || release.version === releases.running) return;
      if (Option.contains(yield* currentNamed, release.version)) return;
      yield* fileSystem.remove(folderOf(release.version), { recursive: true, force: true });
    }).pipe(Effect.ignore);

  const failed = (release: DeviceAgentRelease, reason: string) =>
    Effect.gen(function* () {
      report(`${PRODUCT_NAME} host: could not update to ${release.version}: ${reason}`);
      yield* Ref.set(standing, {
        release,
        update: {
          update: HOST_UPDATE.FAILED,
          updateFailure: reason.slice(0, HOST_UPDATE_FAILURE_MAX_CHARS),
        },
      });
    });

  const fetched = (release: DeviceAgentRelease) =>
    Effect.gen(function* () {
      const { version } = release;
      const sha256 = release.sha256[target];
      if (sha256 === undefined) {
        return yield* Effect.fail(`${PRODUCT_NAME} host ${version} has no build for ${target}`);
      }
      report(`${PRODUCT_NAME} host: fetching ${version}, to switch to once no agent runs.`);
      yield* stagedFolder(
        {
          parent: releases.folder,
          prefix: RELEASES.STAGING_PREFIX,
          target: folderOf(version),
        },
        (staging) =>
          Effect.gen(function* () {
            const saved = path.join(staging, TARBALL.FILE);
            const archive = yield* streamedArchive(
              hostTarballUrl(version, target),
              saved,
              HOST_FETCH,
            ).pipe(Effect.mapError((failure) => `the ${version} download ${failure}`));
            if (archive.sha256 !== sha256) {
              return yield* Effect.fail(`the ${version} download did not match its SHA-256`);
            }
            yield* unpackedArchive(saved, staging).pipe(
              Effect.mapError((failure) => `the ${version} download ${failure}`),
            );
            const unpacked = path.join(staging, TARBALL.ROOT);
            const command = yield* Effect.option(
              fileSystem.stat(path.join(unpacked, ...TARBALL.COMMAND)),
            );
            if (
              !Option.exists(command, (info) => info.type === "File" && (info.mode & 0o111) !== 0)
            ) {
              return yield* Effect.fail(`the ${version} download holds no vespin-host to run`);
            }
            return unpacked;
          }),
      ).pipe(
        Effect.mapError((failure) =>
          typeof failure === "string"
            ? failure
            : `${version} could not be saved beside the releases`,
        ),
      );
    });

  const attempts = (release: DeviceAgentRelease) =>
    fetched(release).pipe(
      Effect.tapError((reason) => failed(release, reason)),
      Effect.retry(Schedule.jittered(Schedule.spaced(RETRY_AFTER))),
      Effect.andThen(
        Effect.gen(function* () {
          yield* Ref.set(standing, { release, update: { update: HOST_UPDATE.WAITING } });
          report(
            `${PRODUCT_NAME} host: ${release.version} is ready, and switches in once no agent runs.`,
          );
        }),
      ),
      Effect.ignore,
      Effect.provideContext(services),
    );

  const versionAnswered = (version: string) =>
    Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* ChildProcess.make(
          path.join(folderOf(version), ...TARBALL.COMMAND),
          ["version"],
          { stdin: "ignore", stderr: "ignore" },
        );
        const printed = yield* Stream.mkString(Stream.decodeText(handle.stdout));
        return Number(yield* handle.exitCode) === 0 ? printed.trim() : "";
      }),
    ).pipe(
      Effect.timeoutOption(VERSION_ANSWER),
      Effect.map(Option.getOrElse(() => "")),
      Effect.orElseSucceed(() => ""),
    );

  const othersRemoved = (version: string) =>
    Effect.gen(function* () {
      const kept = new Set([releases.running, version, ...Option.toArray(yield* currentNamed)]);
      for (const entry of yield* fileSystem.readDirectory(versions)) {
        if (kept.has(entry)) continue;
        yield* Effect.ignore(
          fileSystem.remove(path.join(versions, entry), { recursive: true, force: true }),
        );
      }
    }).pipe(Effect.ignore);

  const currentMoved = (version: string) =>
    Effect.gen(function* () {
      const next = path.join(releases.folder, RELEASES.NEXT_LINK);
      yield* fileSystem.remove(next, { force: true });
      yield* fileSystem.symlink(path.join(RELEASES.VERSIONS, version), next);
      yield* fileSystem
        .rename(next, current)
        .pipe(Effect.tapError(() => Effect.ignore(fileSystem.remove(next, { force: true }))));
    }).pipe(Effect.mapError(() => `current could not be moved to ${version}`));

  const switchedTo = (release: DeviceAgentRelease, beat: Effect.Effect<unknown>) =>
    Effect.gen(function* () {
      const { version } = release;
      const answered = yield* versionAnswered(version);
      if (answered !== version) {
        return yield* Effect.fail(
          answered === ""
            ? `${version} did not start`
            : `${version} did not start: it says it is ${answered.slice(0, 32)}`,
        );
      }
      yield* othersRemoved(version);
      yield* Ref.set(standing, { release, update: { update: HOST_UPDATE.UPDATING } });
      report(`${PRODUCT_NAME} host: switching to ${version}.`);
      yield* beat;
      yield* currentMoved(version);
    });

  const follower: LocalAgentsUpdate = {
    beating: Effect.map(Ref.get(standing), (now) => now.update),
    waiting: Effect.map(Ref.get(standing), (now) => now.update?.update === HOST_UPDATE.WAITING),
    heard: (named) =>
      Effect.gen(function* () {
        const release = named !== undefined && newer(named.version) ? named : undefined;
        const held = (yield* Ref.get(standing)).release;
        if (
          held?.version === release?.version &&
          held?.sha256[target] === release?.sha256[target]
        ) {
          return;
        }
        yield* FiberHandle.clear(fetching);
        yield* stagedRemoved(held);
        yield* Ref.set(standing, { release, update: undefined });
        if (release !== undefined) yield* FiberHandle.run(fetching, attempts(release));
      }).pipe(Effect.provideContext(services)),
    switched: (beat) =>
      Effect.gen(function* () {
        const { release, update } = yield* Ref.get(standing);
        if (release === undefined || update?.update !== HOST_UPDATE.WAITING) return false;
        const outcome = yield* Effect.result(
          switchedTo(release, beat).pipe(
            Effect.onInterrupt(() =>
              Ref.set(standing, { release, update: { update: HOST_UPDATE.WAITING } }),
            ),
          ),
        );
        if (Result.isSuccess(outcome)) {
          report(`${PRODUCT_NAME} host: switched to ${release.version}, so it starts again on it.`);
          yield* Deferred.succeed(switched, undefined);
          return true;
        }
        yield* stagedRemoved(release);
        yield* failed(release, outcome.failure);
        yield* FiberHandle.run(fetching, Effect.delay(attempts(release), RETRY_AFTER));
        return false;
      }).pipe(Effect.provideContext(services)),
  };

  return { follower, ended: Deferred.await(switched) } satisfies HostUpdate;
});
