import type { DeviceAgentUpdate } from "@luke/features";
import {
  DEVICE_ARCH,
  DEVICE_PLATFORM,
  type DeviceAgentRelease,
  type DeviceArch,
  type DevicePlatform,
  HOST_UPDATE,
  HOST_UPDATE_FAILURE_MAX_CHARS,
} from "@luke/features/device-agent-wire";
import { HOST_TARGET, type HostTarget, hostTarballUrl } from "@luke/features/host-release";
import { hostVersionMeets, readHostVersion } from "@luke/features/host-wire";
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

/**
 * host-update.ts -- an account install's host updating itself to the newer release Luke names: fetched and checked while its agents run, and switched to once none does, by moving the install's `current` and starting again.
 *
 * Only a host the account install put in place updates itself: `apps/host`
 * hands it the install's releases (`HostReleases`) where the daemon's own
 * real path stands in a version folder of them. This Mac's copy inside the
 * app, a development run, and an install that came before are handed none,
 * and take no notice of a release.
 *
 * Each answered beat names the release Luke publishes where it is newer
 * than the daemon (`deviceAgentBeatAnswerSchema`'s `release`), and the
 * follower hands it here (`LocalAgentsUpdate.heard`). A version above the
 * daemon's own is fetched from GitHub for the box's target
 * (`hostTarballUrl`), on a client that carries nothing of Luke's, while its
 * agents keep running, one fetch at a time: streamed to a staging folder
 * beside the releases and hashed as it arrives within `HOST_FETCH`'s bounds,
 * checked against the SHA-256 the answer named, unpacked by the system's
 * `tar`, its `luke-host` found executable, and renamed into
 * `versions/<version>` (`staged-fetch.ts`). While it waits there every beat
 * says so (`HOST_UPDATE.WAITING`), and the follower switches to it once the
 * device is idle and claims nothing (`LocalAgentsUpdate.switched`): the new
 * version's `luke-host version` must answer that version; every release but
 * the running one, the new one, and the one `current` names is removed; a
 * beat says it is updating; `current` is moved in one `rename(2)`, a new
 * relative link beside it renamed over it; and the daemon ends (`ended`)
 * through its one drain, for its service manager to start it again on
 * `current`. The folder the daemon runs from is never removed, since every
 * runner it starts runs from it.
 *
 * A fetch, check, unpack, or `version` run that fails removes what it
 * staged and leaves `current` alone, and every beat says the update failed
 * and why until it is tried again, about `RETRY_AFTER` later, or at once
 * where Luke names another release. An answer naming no release, once the
 * daemon is on the newest or the release is withdrawn, lets go of what is
 * staged and of any failure, so the next beat names no update. A host never
 * moves to a version at or below its own.
 */

/** How large a host's tarball may be, and how long its download may go without a byte and take whole. */
const HOST_FETCH: FetchBounds = {
  maxBytes: 256 * 1024 * 1024,
  stall: Duration.minutes(1),
  timeout: Duration.minutes(30),
};

/** How long after a failed update it is tried again, while Luke names the same release. */
const RETRY_AFTER = Duration.hours(1);

/** How long the new version's `luke-host version` may take to answer. */
const VERSION_ANSWER = Duration.seconds(30);

/** The names under the releases folder: each release under `versions/`, the link to the one that runs, and what a fetch stages in and a switch links beside it. */
const RELEASES = {
  VERSIONS: "versions",
  CURRENT: "current",
  STAGING_PREFIX: ".update-",
  NEXT_LINK: ".current-next",
} as const;

/** The tarball's one top folder, and the command under a release's folder. */
const TARBALL = {
  FILE: "luke-host.tar.gz",
  ROOT: "luke-host",
  COMMAND: ["bin", "luke-host"],
} as const;

/** The target each platform and architecture a host runs on fetches its release for. */
const TARGET_OF: {
  readonly [Platform in DevicePlatform]?: { readonly [Arch in DeviceArch]?: HostTarget };
} = {
  [DEVICE_PLATFORM.LINUX]: {
    [DEVICE_ARCH.X64]: HOST_TARGET.LINUX_X64,
    [DEVICE_ARCH.ARM64]: HOST_TARGET.LINUX_ARM64,
  },
  [DEVICE_PLATFORM.DARWIN]: { [DEVICE_ARCH.ARM64]: HOST_TARGET.DARWIN_ARM64 },
};

/** The release target of the platform and architecture given; none where Luke builds no host for it. */
export function hostTargetOf(platform: DevicePlatform, arch: DeviceArch): HostTarget | undefined {
  return TARGET_OF[platform]?.[arch];
}

/** The account install's releases, as `apps/host` finds them (`luke-host.sh`'s `account_home`). */
export interface HostReleases {
  /** The releases folder (`~/.local/share/luke-host`): each release under `versions/<version>`, and `current` linking to the one that runs. */
  readonly folder: string;
  /** The name under `versions/` of the release the daemon runs from, which is never removed. */
  readonly running: string;
}

export interface HostUpdateOptions {
  readonly releases: HostReleases;
  /** The daemon's own version, which only a newer release replaces. */
  readonly version: string;
  readonly target: HostTarget;
}

/** A host's update of itself: what its follower carries (`LocalAgentsUpdate`), and what waits until it switched, after which the daemon ends. */
interface HostUpdate {
  readonly follower: LocalAgentsUpdate;
  readonly ended: Effect.Effect<void>;
}

/** Where the update stands: the release it is on, none while there is none, and what a beat says of it, none while it fetches the first time. */
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

/** A host's update of itself, on the services it is made with, its fetches ending with the scope it is made in. */
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

  /** Whether a version is one to move to: read whole as `MAJOR.MINOR.PATCH`, above the daemon's own, and not the folder it runs from. */
  const newer = (version: string) =>
    readHostVersion(version)?.join(".") === version &&
    !hostVersionMeets(options.version, version) &&
    version !== releases.running;

  /** The release under `versions/` that `current` names now, where it names one. */
  const currentNamed = Effect.map(
    Effect.option(fileSystem.readLink(current)),
    Option.map((link) => path.basename(link)),
  );

  /** The release's staged folder removed, never the one the daemon runs from or the one `current` names. */
  const stagedRemoved = (release: DeviceAgentRelease | undefined) =>
    Effect.gen(function* () {
      if (release === undefined || release.version === releases.running) return;
      if (Option.contains(yield* currentNamed, release.version)) return;
      yield* fileSystem.remove(folderOf(release.version), { recursive: true, force: true });
    }).pipe(Effect.ignore);

  /** The update failed for the reason given, which every beat says until it is tried again. */
  const failed = (release: DeviceAgentRelease, reason: string) =>
    Effect.gen(function* () {
      report(`Luke host: could not update to ${release.version}: ${reason}`);
      yield* Ref.set(standing, {
        release,
        update: {
          update: HOST_UPDATE.FAILED,
          updateFailure: reason.slice(0, HOST_UPDATE_FAILURE_MAX_CHARS),
        },
      });
    });

  /** The release fetched for the box's target, checked, unpacked, and kept under `versions/` whole; the reason where it was not. */
  const fetched = (release: DeviceAgentRelease) =>
    Effect.gen(function* () {
      const { version } = release;
      const sha256 = release.sha256[target];
      if (sha256 === undefined) {
        return yield* Effect.fail(`Luke host ${version} has no build for ${target}`);
      }
      report(`Luke host: fetching ${version}, to switch to once no agent runs.`);
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
            // Note that the command must be a file someone may run, since the service manager starts the release through it.
            if (
              !Option.exists(command, (info) => info.type === "File" && (info.mode & 0o111) !== 0)
            ) {
              return yield* Effect.fail(`the ${version} download holds no luke-host to run`);
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

  /** The release fetched, tried again about every `RETRY_AFTER` while it fails, and then waiting for the device to be idle. */
  const attempts = (release: DeviceAgentRelease) =>
    fetched(release).pipe(
      Effect.tapError((reason) => failed(release, reason)),
      Effect.retry(Schedule.jittered(Schedule.spaced(RETRY_AFTER))),
      Effect.andThen(
        Effect.gen(function* () {
          yield* Ref.set(standing, { release, update: { update: HOST_UPDATE.WAITING } });
          report(`Luke host: ${release.version} is ready, and switches in once no agent runs.`);
        }),
      ),
      // Note that the schedule never ends, so a failure is only ever tried again.
      Effect.ignore,
      Effect.provideContext(services),
    );

  /** What the new version's `luke-host version` printed, nothing where it did not answer, failed, or outlasted `VERSION_ANSWER`. */
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

  /** Every release under `versions/` removed but the one the daemon runs from, the new one, and the one `current` names. */
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

  /** `current` moved to the version given in one `rename(2)`: a relative link made beside it and renamed over it. */
  const currentMoved = (version: string) =>
    Effect.gen(function* () {
      const next = path.join(releases.folder, RELEASES.NEXT_LINK);
      yield* fileSystem.remove(next, { force: true });
      yield* fileSystem.symlink(path.join(RELEASES.VERSIONS, version), next);
      yield* fileSystem
        .rename(next, current)
        .pipe(Effect.tapError(() => Effect.ignore(fileSystem.remove(next, { force: true }))));
    }).pipe(Effect.mapError(() => `current could not be moved to ${version}`));

  /** The switch to the release given, each step in order; the reason where one failed. */
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
      report(`Luke host: switching to ${version}.`);
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
        // Note that a fetch under way for another release is ended first, so one fetch runs at a time.
        yield* FiberHandle.clear(fetching);
        yield* stagedRemoved(held);
        yield* Ref.set(standing, { release, update: undefined });
        if (release !== undefined) yield* FiberHandle.run(fetching, attempts(release));
      }).pipe(Effect.provideContext(services)),
    switched: (beat) =>
      Effect.gen(function* () {
        const { release, update } = yield* Ref.get(standing);
        if (release === undefined || update?.update !== HOST_UPDATE.WAITING) return false;
        // Note that a switch cut off, as the follow ends with a lease lost, waits again, since every step of it can be taken once more.
        const outcome = yield* Effect.result(
          switchedTo(release, beat).pipe(
            Effect.onInterrupt(() =>
              Ref.set(standing, { release, update: { update: HOST_UPDATE.WAITING } }),
            ),
          ),
        );
        if (Result.isSuccess(outcome)) {
          report(`Luke host: switched to ${release.version}, so it starts again on it.`);
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
