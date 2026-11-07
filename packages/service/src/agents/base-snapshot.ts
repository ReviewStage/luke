/**
 * base-snapshot.ts -- a workspace's repository cloned once with its dependencies installed and snapshotted, which each new agent's sandbox is created from instead of cloning.
 *
 * Vercel's "Faster startups: skip dependency installation by snapshotting
 * after setup" (https://vercel.com/docs/sandbox/concepts/snapshots): a
 * sandbox from the agents' image clones the default branch and installs, then
 * is snapshotted, and every sandbox created from that snapshot starts with
 * both. A base snapshot is that, one per workspace and repository, recorded
 * by the sandbox that took it: named for the workspace and the repository
 * (`baseSnapshotName`), left stopped on it, its `currentSnapshotId` the base
 * snapshot. Its checkout stands as an agent's stands in its workspace
 * (`repository-shell.ts`'s `cloneRepository`), cloned through the token at
 * the firewall for the clone alone, so the snapshot holds no credential.
 *
 * The sandbox carries a key once its fill ended well (`BASE_TAG.KEY`): a
 * digest of the image it was made on and the default branch it holds, so a
 * new image, whose runner and tools the snapshot would otherwise freeze, or a
 * moved default branch reads as a base to fill again, and none is ever
 * created from on an image or branch it was not made of. The key goes up
 * before the snapshot is taken, so a snapshot of a half-made checkout is
 * never one a launch reads.
 *
 * Nothing refreshes it on a timer. A launch fills it past its answer where
 * it is missing or out of date, and fills it again where the snapshot it
 * named was gone, since it lapses `LAPSE` after its last use and each
 * sandbox created from it is a use, or where the agent's fast-forward from
 * it moved a lockfile (`lockfileMoved`), which a fresh install would no
 * longer match. The sandbox's name is the lock: of fills that find none at
 * once, Vercel lets one create it and refuses the rest with a 409, and a
 * fill replaces a standing base only where it is still the one read
 * (`deleteIfStill`). A fill that failed deletes its own sandbox, so agents
 * clone as they would without one until the next fill.
 */

import { createHash } from "node:crypto";
import { Clock, Duration, Effect, Option, type Redacted } from "effect";
import type { GitHubTokenAccess } from "../github/github-app.js";
import { CODER } from "./coder-host/bounds.js";
import { REPOSITORY_SANDBOX_CONTRACT } from "./repository-sandbox-contract.js";
import {
  cloneRepository,
  GROUP_WRITES,
  REPOSITORY_REFUSAL,
  RepositoryRefusal,
  type RepositorySandbox,
  runInSandbox,
  snapshotRecordOf,
} from "./repository-shell.js";
import {
  type ListedSandbox,
  type OpenedSandbox,
  SANDBOX_STATUS,
  SandboxUnavailable,
  type VercelSandboxApi,
} from "./vercel-sandbox-api.js";

export const BASE_SNAPSHOT = {
  /** Every base snapshot's sandbox is named with this, its digest after it. */
  NAME_PREFIX: "agent-base-",
  /** How long a fill may take, its sandbox's own timeout included. */
  FILL_TIMEOUT: Duration.minutes(10),
  /** How long a fill's sandbox may run before it is taken for one left behind. */
  FILL_GRACE: Duration.minutes(15),
  /** How long after its last use Vercel keeps a base snapshot; each sandbox created from it is a use. */
  LAPSE: Duration.days(30),
} as const;

/** The tag a base's sandbox carries once its fill ended well: the key of what it was made of (`baseKey`). */
const BASE_TAG = { KEY: "agentBaseKey" } as const;

/** Vercel's refusal of a sandbox name already taken: another launch's fill. */
const CONFLICT_STATUS = 409;

/** How much of the end of a failed install's error output the log is told. */
const INSTALL_ERROR_TAIL_CHARS = 500;

/** The lockfiles whose change on the default branch makes the base's install stale. */
const LOCKFILES = ["pnpm-lock.yaml", "package-lock.json"] as const;

/** The variable the lockfile diff reads the base's commit from, so no commit is written into a command. */
const BASE_COMMIT_VARIABLE = "APP_BASE_COMMIT";

/** The lockfile diff's exit where the lockfiles differ, as `git diff --quiet` exits. */
const DIFFERS_EXIT = 1;

/**
 * The dependencies installed in the checkout: with pnpm where its lockfile
 * is pnpm's, with npm where it has a `package.json` and no such lockfile,
 * and nothing in a repository that has neither, which has none to install;
 * written group-writable, as the clone is (`GROUP_WRITES`).
 */
const INSTALL_SCRIPT = [
  "set -e",
  GROUP_WRITES,
  "if [ -f pnpm-lock.yaml ]; then pnpm install; elif [ -f package.json ]; then npm install; fi",
].join("\n");

/** Whether the lockfiles differ between the base's commit and the checkout's HEAD: exits `DIFFERS_EXIT` where they do. */
const LOCKFILE_DIFF_SCRIPT = `git diff --quiet "$${BASE_COMMIT_VARIABLE}" HEAD -- ${LOCKFILES.join(" ")}`;

/** What a fill clones through: a read token for the one repository, and whose it is. */
interface BaseSnapshotCredential {
  readonly token: Redacted.Redacted;
  readonly access: GitHubTokenAccess;
}

/** What a base snapshot is of: the workspace, and the repository and branch it holds. */
export interface BaseSnapshotOf {
  readonly workspaceId: string;
  /** The repository as GitHub spells it. */
  readonly fullName: string;
  readonly defaultBranch: string;
}

/** Where a base stands for a launch: ready to create from, being filled, or wanted, with the sandbox in a fill's way. */
export const BASE_STATE = { READY: "ready", FILLING: "filling", WANTED: "wanted" } as const;

export type BaseSnapshotRead =
  | { readonly state: typeof BASE_STATE.READY; readonly snapshotId: string }
  | { readonly state: typeof BASE_STATE.FILLING }
  | { readonly state: typeof BASE_STATE.WANTED; readonly stale?: ListedSandbox };

/** A digest of the fields given, each ended by a NUL so none runs into the next. */
function digestOf(fields: readonly string[]): string {
  const digest = createHash("sha256");
  for (const field of fields) digest.update(field).update("\0");
  return digest.digest("hex").slice(0, 32);
}

/** The base's sandbox's name: the prefix and a digest of the workspace and the repository. */
export function baseSnapshotName(of: BaseSnapshotOf): string {
  return `${BASE_SNAPSHOT.NAME_PREFIX}${digestOf([of.workspaceId, snapshotRecordOf(of.fullName)])}`;
}

/** The key a base made on the image given, of the default branch the base names, carries. */
function baseKey(of: BaseSnapshotOf, image: string): string {
  return digestOf([image, of.defaultBranch]);
}

/** Whether a sandbox is a fill still within its grace: up, and created less than `FILL_GRACE` ago. */
function stillFilling(found: ListedSandbox, now: number): boolean {
  const up =
    found.status === SANDBOX_STATUS.PENDING ||
    found.status === SANDBOX_STATUS.RUNNING ||
    found.status === SANDBOX_STATUS.SNAPSHOTTING ||
    found.status === SANDBOX_STATUS.STOPPING;
  return (
    up &&
    found.createdAt !== undefined &&
    now - found.createdAt < Duration.toMillis(BASE_SNAPSHOT.FILL_GRACE)
  );
}

/** The sandbox found under the base's name as a launch reads it, against the key it should carry. */
function readOf(found: ListedSandbox | undefined, key: string, now: number): BaseSnapshotRead {
  if (found === undefined) return { state: BASE_STATE.WANTED };
  const keyed = found.tags?.[BASE_TAG.KEY] === key;
  if (keyed && found.status === SANDBOX_STATUS.STOPPED && found.currentSnapshotId !== undefined) {
    return { state: BASE_STATE.READY, snapshotId: found.currentSnapshotId };
  }
  if (stillFilling(found, now)) return { state: BASE_STATE.FILLING };
  return { state: BASE_STATE.WANTED, stale: found };
}

/** The base snapshot as it stands for a launch on the image given. */
export const readBaseSnapshot = (api: VercelSandboxApi, of: BaseSnapshotOf, image: string) =>
  Effect.map(
    Effect.all([api.getNamed(baseSnapshotName(of)), Clock.currentTimeMillis]),
    ([found, now]) => readOf(found, baseKey(of, image), now),
  );

/** Whether two reads of a name are of one sandbox: the same creation and the same session. */
function sameSandbox(one: ListedSandbox, other: ListedSandbox): boolean {
  return one.createdAt === other.createdAt && one.currentSessionId === other.currentSessionId;
}

/**
 * The sandbox under the name deleted, where it is still the one given: read
 * again just before, so one another fill created under the name since is
 * left be. Whether the name now stands free.
 */
const deleteIfStill = (api: VercelSandboxApi, read: ListedSandbox) =>
  Effect.gen(function* () {
    const now = yield* api.getNamed(read.name);
    if (now === undefined) return true;
    if (!sameSandbox(now, read)) return false;
    yield* api.deleteSandbox(read.name);
    return true;
  });

/** The dependencies installed in the checkout the sandbox holds, or the refusal in the installer's own words: a fill's, and an agent's after its fast-forward, which installs only what changed since. */
export const installDependencies = Effect.fn("web/installCheckoutDependencies")(function* (
  sandbox: RepositorySandbox,
) {
  const installed = yield* runInSandbox(
    sandbox,
    { command: INSTALL_SCRIPT, workingDirectory: REPOSITORY_SANDBOX_CONTRACT.PATH.CHECKOUT },
    REPOSITORY_REFUSAL.CHECKOUT_FAILED,
  );
  if (installed.exitCode !== 0) {
    return yield* new RepositoryRefusal({
      reason: REPOSITORY_REFUSAL.CHECKOUT_FAILED,
      detail: installed.stderr.trim().slice(-INSTALL_ERROR_TAIL_CHARS),
    });
  }
});

/** The commit the checkout stands at; none where git could not say, as for a sandbox that holds no checkout. */
export const checkoutCommit = (sandbox: RepositorySandbox) =>
  Effect.map(
    runInSandbox(
      sandbox,
      {
        command: "git rev-parse HEAD",
        workingDirectory: REPOSITORY_SANDBOX_CONTRACT.PATH.CHECKOUT,
      },
      REPOSITORY_REFUSAL.CHECKOUT_FAILED,
    ),
    (ran) => (ran.exitCode === 0 ? ran.stdout.trim() : undefined),
  );

/**
 * Whether the checkout's lockfiles moved since the base's commit given, as
 * a fast-forward from a base snapshot finds them: the base's install no
 * longer matches the default branch, so the base is filled again. A diff git
 * could not make reads as no move.
 */
export const lockfileMoved = (sandbox: RepositorySandbox, since: string) =>
  Effect.map(
    runInSandbox(
      sandbox,
      {
        command: LOCKFILE_DIFF_SCRIPT,
        workingDirectory: REPOSITORY_SANDBOX_CONTRACT.PATH.CHECKOUT,
        env: { [BASE_COMMIT_VARIABLE]: since },
      },
      REPOSITORY_REFUSAL.CHECKOUT_FAILED,
    ),
    (ran) => ran.exitCode === DIFFERS_EXIT,
  );

/**
 * The workspace's repository's base snapshot filled, where a launch on the
 * image given wants one: whatever stale sandbox stands under the name
 * deleted where it is still the one read, the sandbox created from the image
 * under the name, the default branch cloned whole into it through the token
 * at the firewall for the clone alone, its dependencies installed, the key
 * tagged, and the snapshot taken, which stops it. A base that reads ready is
 * filled again only where its snapshot is the one `replacing` names: gone
 * under a launch, or with a lockfile its agent's fast-forward moved. A name
 * another launch took first is that launch's fill, and this one does
 * nothing. A fill that failed or outlasted `FILL_TIMEOUT` deletes its
 * sandbox. `open` is the sandbox as the clone reaches it, over the caller's
 * runner.
 */
export const fillBaseSnapshot = Effect.fn("web/fillBaseSnapshot")(function* (
  api: VercelSandboxApi,
  of: BaseSnapshotOf,
  image: string,
  credential: BaseSnapshotCredential,
  open: (sandbox: { readonly name: string; readonly running: string }) => RepositorySandbox,
  replacing?: string,
) {
  const name = baseSnapshotName(of);
  const key = baseKey(of, image);
  const found = yield* api.getNamed(name);
  const read = readOf(found, key, yield* Clock.currentTimeMillis);
  const stale =
    read.state === BASE_STATE.READY && read.snapshotId === replacing
      ? found
      : read.state === BASE_STATE.WANTED
        ? read.stale
        : undefined;
  if (read.state !== BASE_STATE.WANTED && stale === undefined) return;
  if (stale !== undefined && !(yield* deleteIfStill(api, stale))) return;
  const created = yield* api
    .create({
      name,
      from: { image },
      tags: {},
      timeoutMs: Duration.toMillis(BASE_SNAPSHOT.FILL_TIMEOUT),
      vcpus: CODER.SANDBOX_VCPUS,
      keepLastSnapshots: {
        count: 1,
        expiration: Duration.toMillis(BASE_SNAPSHOT.LAPSE),
        deleteEvicted: true,
      },
      env: {},
    })
    .pipe(
      Effect.map(Option.some),
      // Note that a name another launch took first is that launch's fill, which this one leaves be.
      Effect.catchIf(
        (failure) => failure.status === CONFLICT_STATUS,
        () => Effect.succeed(Option.none<OpenedSandbox>()),
      ),
    );
  if (Option.isNone(created)) return;
  const running = created.value.currentSessionId;
  yield* Effect.gen(function* () {
    const sandbox = open({ name, running });
    yield* cloneRepository(
      sandbox,
      {
        fullName: of.fullName,
        defaultBranch: of.defaultBranch,
        recordedAs: snapshotRecordOf(of.fullName),
      },
      credential.token,
      { access: credential.access },
    );
    yield* installDependencies(sandbox);
    // The key goes up before the snapshot, so the snapshot it leaves is known for a whole checkout.
    yield* api.updateTags(name, { [BASE_TAG.KEY]: key });
    yield* (yield* api.session({ name, sessionId: running })).snapshot(BASE_SNAPSHOT.LAPSE);
    yield* Effect.logInfo(`the base snapshot ${name} is filled`);
  }).pipe(
    Effect.timeoutOrElse({
      duration: BASE_SNAPSHOT.FILL_TIMEOUT,
      orElse: () => Effect.fail(new SandboxUnavailable({ detail: "the fill timed out" })),
    }),
    // Only this fill's own sandbox goes, so a fill that failed after another replaced it leaves that one be.
    Effect.tapError(() => Effect.ignore(deleteIfStill(api, created.value))),
  );
});
