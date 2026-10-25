/**
 * repository-snapshot.ts -- a workspace's repository cloned once into a snapshot of the native agents' image, which a native agent's sandbox opens from instead of cloning.
 *
 * A native harness's sandbox opens from the coding agent's image
 * (`native-sandbox-template.ts`) and clones its repository whole before the
 * runner starts (`coder-host/runner-sessions.ts`), which is most of the time
 * a new agent takes to say anything. A repository snapshot is that clone
 * done once: a persistent sandbox opened from the image's snapshot, the
 * repository's default branch cloned whole into it as an agent's checkout
 * stands (`repository-shell.ts`'s `cloneRepository`, the token at the
 * firewall for the clone alone, so the snapshot holds no credential), and
 * snapshotted. A launch that finds one ready opens from it and fetches only
 * what landed since (`refreshRepository`).
 *
 * Its key is the digest of the image snapshot it was made from, the
 * workspace, the repository as GitHub spells it, and the default branch, so
 * a new image, a renamed repository, or a moved default branch is another
 * snapshot, and none is ever opened on an image or branch it was not made
 * of. A workspace's snapshot is opened only for that workspace's agents,
 * and only by a launch that has just confirmed the workspace's installation
 * reaches the repository, whose own token then fetches the branch.
 *
 * Like the template, the sandbox's name is the lock: of launches that find
 * none at once, Vercel lets one create it and refuses the rest with a 409.
 * The build is marked built only once the clone ended well, before the
 * snapshot is taken, so a snapshot of a half-made checkout is never opened.
 * A snapshot older than `MAX_AGE` is passed by and built again, which bounds
 * what a launch fetches on top of it, and a build left behind past
 * `BUILD_GRACE` is deleted and built again. The scheduled sweep deletes
 * every repository sandbox past either bound, a shard of the names a
 * minute, so a repository no agent starts on any more keeps nothing.
 *
 * Nothing here ever fails a launch: a lookup Vercel did not answer reads as
 * no snapshot, and a build that failed deletes what it made and is logged.
 */

import { createHash } from "node:crypto";
import { Clock, Duration, Effect, Option, type Redacted, Result } from "effect";
import type { GitHubTokenAccess } from "../github/github-app.js";
import { CODER } from "./coder-host/bounds.js";
import { cloneRepository, type RepositorySandbox, snapshotRecordOf } from "./repository-shell.js";
import {
  deploymentOidcToken,
  type ListedSandbox,
  SANDBOX_STATUS,
  SandboxUnavailable,
  type VercelSandboxApi,
  vercelSandboxApi,
} from "./vercel-sandbox-api.js";

export const REPOSITORY_SNAPSHOT = {
  /** Every repository snapshot's sandbox is named with this, its digest after it; no other sweep's prefix is a prefix of it. */
  NAME_PREFIX: "luke-repository-",
  /** How long a snapshot is opened from after it was built: past it, a launch builds it again and the sweep deletes it. */
  MAX_AGE: Duration.days(3),
  /** How long a build may stand unmarked before it is taken for left behind. */
  BUILD_GRACE: Duration.minutes(15),
  /** How long a build may take, its sandbox's own timeout included; one cut off is deleted. */
  BUILD_TIMEOUT: Duration.minutes(10),
  /**
   * How many pages of repository sandboxes one sweep reads, of the shard of
   * names it takes this minute: the digest's first hex digit, one of
   * `SWEEP_SHARDS`, so every snapshot is read within that many minutes
   * however many there are, and none hides behind the pages before it.
   */
  SWEEP_PAGES: 4,
  SWEEP_SHARDS: 16,
  /** How often the sweep runs (`MAINTENANCE_SWEEP.CRONTAB`), which moves it on to the next shard. */
  SWEEP_PERIOD: Duration.minutes(1),
} as const;

/** The sandbox's tags: its key, and the instant a build that ended well was marked at. */
const SNAPSHOT_TAG = {
  KEY: "lukeRepositorySnapshot",
  BUILT: "lukeRepositoryBuilt",
} as const;

/** Vercel's refusal of a name already taken: another launch's build. */
const CONFLICT_STATUS = 409;

/**
 * How long after its last use Vercel keeps a repository snapshot: as long as
 * it is opened from, and its build's grace. Note that the sweep's delete
 * keeps a snapshot another sandbox still resumes from, so a snapshot that
 * never expired would outlive its sandbox for good; and that every sandbox
 * opened from it resets the clock, so one in use does not lapse.
 */
const SNAPSHOT_LAPSE = Duration.sum(REPOSITORY_SNAPSHOT.MAX_AGE, REPOSITORY_SNAPSHOT.BUILD_GRACE);

export const REPOSITORY_SNAPSHOT_STATE = {
  /** Built, stopped on its snapshot, and young enough to open from. */
  READY: "ready",
  /** Being built by a launch, within its grace. */
  BUILDING: "building",
  /** None, or one past its age, or one left behind: a launch builds it. */
  WANTED: "wanted",
} as const;

export type RepositorySnapshotLookup =
  | { readonly state: typeof REPOSITORY_SNAPSHOT_STATE.READY; readonly snapshotId: string }
  | { readonly state: typeof REPOSITORY_SNAPSHOT_STATE.BUILDING }
  | {
      readonly state: typeof REPOSITORY_SNAPSHOT_STATE.WANTED;
      /** The sandbox standing in the way of a build, deleted before it. */
      readonly stale?: ListedSandbox;
    };

/** What a repository snapshot is of: the image snapshot it opens on, the workspace, and the repository and branch it holds. */
export interface RepositorySnapshotOf {
  readonly imageSnapshotId: string;
  readonly workspaceId: string;
  /** The repository as GitHub spells it. */
  readonly fullName: string;
  readonly defaultBranch: string;
}

/** What a build clones through: a read token for the one repository, and whose it is. */
export interface RepositorySnapshotCredential {
  readonly token: Redacted.Redacted;
  readonly access: GitHubTokenAccess;
}

/** The snapshot's sandbox's name: the prefix and a digest of what it is of, every field ended by a NUL so none runs into the next. */
export function repositorySnapshotName(of: RepositorySnapshotOf): string {
  const digest = createHash("sha256");
  for (const field of [
    of.imageSnapshotId,
    of.workspaceId,
    snapshotRecordOf(of.fullName),
    of.defaultBranch,
  ]) {
    digest.update(field).update("\0");
  }
  return `${REPOSITORY_SNAPSHOT.NAME_PREFIX}${digest.digest("hex").slice(0, 32)}`;
}

/** Whether the instant is longer ago than the bound; an instant that is not one is never old. */
function olderThan(now: number, at: number | undefined, bound: Duration.Duration): boolean {
  return at !== undefined && Number.isFinite(at) && now - at >= Duration.toMillis(bound);
}

/** The instant a sandbox's build was marked built at, where it was. */
function builtAt(sandbox: ListedSandbox): number | undefined {
  const built = sandbox.tags?.[SNAPSHOT_TAG.BUILT];
  return built === undefined ? undefined : Number(built);
}

/** Whether the sweep deletes the sandbox: built past its age, or unbuilt past its grace. */
function expired(sandbox: ListedSandbox, now: number): boolean {
  const built = builtAt(sandbox);
  return built === undefined
    ? olderThan(now, sandbox.createdAt, REPOSITORY_SNAPSHOT.BUILD_GRACE)
    : olderThan(now, built, REPOSITORY_SNAPSHOT.MAX_AGE);
}

/** The sandbox found under the name as a launch reads it. */
function readOf(found: ListedSandbox | undefined, now: number): RepositorySnapshotLookup {
  if (found === undefined) return { state: REPOSITORY_SNAPSHOT_STATE.WANTED };
  const built = builtAt(found);
  if (built !== undefined) {
    // Note that a snapshot taken once the build was marked holds the whole checkout, and a stopped sandbox's current one is the last taken.
    const usable = found.status === SANDBOX_STATUS.STOPPED && found.currentSnapshotId !== undefined;
    if (usable && !olderThan(now, built, REPOSITORY_SNAPSHOT.MAX_AGE)) {
      return { state: REPOSITORY_SNAPSHOT_STATE.READY, snapshotId: found.currentSnapshotId };
    }
    // Being snapshotted: the build that marked it is still taking it.
    if (found.status === SANDBOX_STATUS.SNAPSHOTTING || found.status === SANDBOX_STATUS.STOPPING) {
      return { state: REPOSITORY_SNAPSHOT_STATE.BUILDING };
    }
    return { state: REPOSITORY_SNAPSHOT_STATE.WANTED, stale: found };
  }
  return found.status === SANDBOX_STATUS.RUNNING &&
    !olderThan(now, found.createdAt, REPOSITORY_SNAPSHOT.BUILD_GRACE)
    ? { state: REPOSITORY_SNAPSHOT_STATE.BUILDING }
    : { state: REPOSITORY_SNAPSHOT_STATE.WANTED, stale: found };
}

/** The repository snapshot as it stands for the launch: ready to open from, being built, or wanted. */
export const readRepositorySnapshot = (
  api: VercelSandboxApi,
  of: RepositorySnapshotOf,
): Effect.Effect<RepositorySnapshotLookup, SandboxUnavailable> =>
  Effect.gen(function* () {
    const found = yield* api.getNamed(repositorySnapshotName(of));
    return readOf(found, yield* Clock.currentTimeMillis);
  });

/** Whether two reads of a name are of one sandbox: the same creation and the same session. */
function sameSandbox(one: ListedSandbox, other: ListedSandbox): boolean {
  return one.createdAt === other.createdAt && one.currentSessionId === other.currentSessionId;
}

/**
 * The sandbox under the name deleted, where it is still the one given: read
 * again just before, so a sandbox another launch created under the name
 * since is left be. Whether the name now stands free. Note that Vercel
 * deletes by name alone, so a sandbox created between the read and the
 * delete can still go; what that costs is a snapshot not built this time,
 * never a launch, since every launch that finds none clones for itself and
 * the next builds it again.
 */
const deleteIfStill = (api: VercelSandboxApi, read: ListedSandbox) =>
  Effect.gen(function* () {
    const now = yield* api.getNamed(read.name);
    if (now === undefined) return true;
    if (!sameSandbox(now, read)) return false;
    yield* api.deleteSandbox(read.name);
    return true;
  });

/**
 * The repository snapshot built: whatever stale sandbox the read found
 * deleted, the sandbox created from the image's snapshot under the name,
 * the default branch cloned whole into it through the token at the firewall
 * for the clone alone, the build marked, and the snapshot taken, which
 * stops it. A name another launch took first is that launch's build, and
 * this one does nothing. A build that fails or outlasts `BUILD_TIMEOUT`
 * deletes its sandbox, so the next launch builds it again. `open` is the
 * sandbox as the clone reaches it, over the caller's runner.
 */
export const buildRepositorySnapshot = Effect.fn("web/buildRepositorySnapshot")(function* (
  api: VercelSandboxApi,
  of: RepositorySnapshotOf,
  credential: RepositorySnapshotCredential,
  open: (running: string) => RepositorySandbox,
) {
  const name = repositorySnapshotName(of);
  const wanted = readOf(yield* api.getNamed(name), yield* Clock.currentTimeMillis);
  if (wanted.state !== REPOSITORY_SNAPSHOT_STATE.WANTED) return;
  if (wanted.stale !== undefined && !(yield* deleteIfStill(api, wanted.stale))) return;
  const key = name.slice(REPOSITORY_SNAPSHOT.NAME_PREFIX.length);
  const created = yield* api
    .create({
      name,
      snapshotId: of.imageSnapshotId,
      tags: { [SNAPSHOT_TAG.KEY]: key },
      timeoutMs: Duration.toMillis(REPOSITORY_SNAPSHOT.BUILD_TIMEOUT),
      vcpus: CODER.SANDBOX_VCPUS,
      keepLastSnapshots: {
        count: 1,
        expiration: Duration.toMillis(SNAPSHOT_LAPSE),
        deleteEvicted: true,
      },
      env: {},
    })
    .pipe(
      Effect.map(Option.some),
      Effect.catchIf(
        (failure) => failure.status === CONFLICT_STATUS,
        () => Effect.succeed(Option.none<ListedSandbox>()),
      ),
    );
  if (Option.isNone(created)) return;
  yield* Effect.gen(function* () {
    const running = created.value.currentSessionId;
    if (running === undefined) return yield* new SandboxUnavailable({});
    yield* cloneRepository(
      open(running),
      {
        fullName: of.fullName,
        defaultBranch: of.defaultBranch,
        recordedAs: snapshotRecordOf(of.fullName),
      },
      credential.token,
      { access: credential.access },
    );
    // The mark goes up before the snapshot, so the snapshot it leaves is known for a whole checkout.
    const now = yield* Clock.currentTimeMillis;
    yield* api.updateTags(name, { [SNAPSHOT_TAG.KEY]: key, [SNAPSHOT_TAG.BUILT]: String(now) });
    yield* api.snapshot(running, SNAPSHOT_LAPSE);
    yield* Effect.logInfo(`the repository snapshot ${name} is ready`);
  }).pipe(
    Effect.timeoutOrElse({
      duration: REPOSITORY_SNAPSHOT.BUILD_TIMEOUT,
      orElse: () => Effect.fail(new SandboxUnavailable({ detail: "the build timed out" })),
    }),
    // Only this build's own sandbox goes, so a build that failed after another launch replaced it leaves that one be.
    Effect.tapError(() => Effect.ignore(deleteIfStill(api, created.value))),
  );
});

/**
 * The sandbox a launch opened from a repository snapshot found it gone, or
 * not the checkout it should be: deleted, where it is still the one that
 * answered that snapshot, so the next launch builds it again rather than
 * failing on it too.
 */
export const forgetRepositorySnapshot = (
  api: VercelSandboxApi,
  of: RepositorySnapshotOf,
  snapshotId: string,
) =>
  Effect.gen(function* () {
    const name = repositorySnapshotName(of);
    const found = yield* api.getNamed(name);
    if (found?.currentSnapshotId !== snapshotId) return;
    yield* Effect.logWarning(`the repository snapshot ${name} was unusable, so it is built again`);
    yield* api.deleteSandbox(name);
  });

/** What one sweep of the repository snapshots came to: how many it read, and how many it deleted. */
export interface RepositorySnapshotSweepOutcome {
  readonly listed: number;
  readonly deleted: number;
}

/** The names the sweep reads this minute: the prefix and the one hex digit of the digest its shard begins with. */
function shardPrefixAt(now: number): string {
  const minute = Math.floor(now / Duration.toMillis(REPOSITORY_SNAPSHOT.SWEEP_PERIOD));
  return `${REPOSITORY_SNAPSHOT.NAME_PREFIX}${(minute % REPOSITORY_SNAPSHOT.SWEEP_SHARDS).toString(16)}`;
}

/**
 * The sweep's turn at the repository snapshots: a few pages of this
 * minute's shard of them read (`SWEEP_SHARDS`), and each built past
 * `MAX_AGE` or left unbuilt past `BUILD_GRACE` deleted with its snapshots,
 * unless a launch replaced it since it was listed, so a repository no agent
 * starts on keeps nothing. A delete Vercel refused is left for the shard's
 * next turn.
 */
export const sweepRepositorySnapshots = (
  api: VercelSandboxApi,
): Effect.Effect<RepositorySnapshotSweepOutcome, SandboxUnavailable> =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const prefix = shardPrefixAt(now);
    let listed = 0;
    let deleted = 0;
    let cursor: string | undefined;
    for (let page = 0; page < REPOSITORY_SNAPSHOT.SWEEP_PAGES; page += 1) {
      const read = yield* api.listNamedPage(prefix, cursor);
      for (const sandbox of read.sandboxes) {
        if (!sandbox.name.startsWith(prefix)) continue;
        listed += 1;
        if (!expired(sandbox, now)) continue;
        const gone = yield* Effect.result(deleteIfStill(api, sandbox));
        if (Result.isSuccess(gone) && gone.success) deleted += 1;
      }
      if (read.next === undefined) break;
      cursor = read.next;
    }
    return { listed, deleted };
  });

/**
 * The scheduled sweep's turn, over the deployment's own credentials: a
 * Vercel that could not be asked is logged by its status alone and left for
 * the next minute's sweep.
 */
export const sweepNativeRepositorySnapshots = Effect.fn("web/sweepRepositorySnapshots")(
  function* () {
    const api = yield* vercelSandboxApi(deploymentOidcToken);
    const swept = yield* sweepRepositorySnapshots(api).pipe(
      Effect.catch((failure) =>
        Effect.as(
          Effect.logWarning(`the repository snapshots were not swept: ${failure.message}`),
          { listed: 0, deleted: 0 } satisfies RepositorySnapshotSweepOutcome,
        ),
      ),
    );
    if (swept.deleted > 0) {
      yield* Effect.logInfo(
        `${swept.deleted} repository snapshots deleted of ${swept.listed} listed`,
      );
    }
    return swept;
  },
);
