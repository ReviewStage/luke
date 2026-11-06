/**
 * base-drive.ts -- a workspace's repository cloned once onto a drive with its dependencies installed, which each new agent's own drive is forked from.
 *
 * Vercel's Drives keep a directory apart from the sandbox it is mounted in,
 * and a drive forked from another starts with all it holds: "start a fleet
 * of agents, each working independently on their own read-write copy forked
 * from a base drive" (https://vercel.com/docs/sandbox/concepts/drives). A
 * base drive is that copy's source: one per workspace and repository, in the
 * region every sandbox we create runs in, holding the default branch's
 * checkout as an agent's stands in its workspace (`repository-shell.ts`'s
 * `cloneRepository`) and its `node_modules`.
 *
 * It is filled the way Vercel's examples fill one: a sandbox opened from the
 * image's snapshot with a staging drive mounted read-write at the workspace,
 * the repository cloned through the token at the firewall for the clone
 * alone, so nothing on the drive carries a credential, the dependencies
 * installed with the package manager the checkout's lockfile names, and the
 * sandbox stopped, which lets the drive go; then the staging drive forked
 * under the base drive's own name and deleted, and the sandbox deleted, since
 * a stopped sandbox still holds its name. Note that the fill writes a staging
 * drive rather than the base drive itself, because a launch forks the base
 * drive as soon as it stands, and one that stood empty while its fill's
 * sandbox was still being created was forked empty. It is filled once and
 * never refreshed: each agent fetches its own branch onto its fork and
 * installs again there, which fills in only what changed. A fill that failed
 * stops its sandbox, deletes the staging drive, and deletes the sandbox, so
 * it leaves no base drive, and agents clone as they would without one.
 */

import { createHash } from "node:crypto";
import { Duration, Effect, Option, type Redacted } from "effect";
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
  type OpenedSandbox,
  SandboxUnavailable,
  type VercelSandboxApi,
} from "./vercel-sandbox-api.js";

export const BASE_DRIVE = {
  /** Every base drive, and the sandbox that fills it, is named with this, its digest after it. */
  NAME_PREFIX: "agent-base-",
  /** What a base drive's staging drive, which its fill writes, is named with after the base drive's own name. */
  STAGING_SUFFIX: "-staging",
  /** Where a base drive, and each fork of it, is mounted: the workspace, which the checkout and its record stand in. */
  MOUNT_PATH: REPOSITORY_SANDBOX_CONTRACT.PATH.WORKSPACE,
  /** How long a fill may take, its sandbox's own timeout included. */
  FILL_TIMEOUT: Duration.minutes(10),
} as const;

/** Vercel's refusal of a sandbox name already taken: another launch's fill. */
const CONFLICT_STATUS = 409;

/** How much of the end of a failed install's error output the log is told. */
const INSTALL_ERROR_TAIL_CHARS = 500;

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

/**
 * What a fill clears from its staging drive before it clones: everything
 * at the workspace, which only a fill left behind could hold, since a fill
 * that failed deletes its staging drive where Vercel lets it.
 */
const CLEAR_SCRIPT = "find . -mindepth 1 -maxdepth 1 -exec rm -rf {} +";

/** The staging drive a base drive's fill writes, forked under the base drive's own name once whole. */
function stagingDriveName(name: string): string {
  return `${name}${BASE_DRIVE.STAGING_SUFFIX}`;
}

/** What a fill clones through: a read token for the one repository, and whose it is. */
interface BaseDriveCredential {
  readonly token: Redacted.Redacted;
  readonly access: GitHubTokenAccess;
}

/** What a base drive is of: the workspace, and the repository and branch it holds. */
export interface BaseDriveOf {
  readonly workspaceId: string;
  /** The repository as GitHub spells it. */
  readonly fullName: string;
  readonly defaultBranch: string;
}

/** The base drive's name: the prefix and a digest of the workspace and the repository, each ended by a NUL so neither runs into the other. */
export function baseDriveName(of: BaseDriveOf): string {
  const digest = createHash("sha256");
  for (const field of [of.workspaceId, snapshotRecordOf(of.fullName)]) {
    digest.update(field).update("\0");
  }
  return `${BASE_DRIVE.NAME_PREFIX}${digest.digest("hex").slice(0, 32)}`;
}

/**
 * Whether the base drive is filled: it stands, which it does only once its
 * fill forked it whole from the staging drive (`fillBaseDrive`), and the
 * sandbox that fills it is gone, which a fill deletes only after that fork,
 * so a drive a fill still writes is never forked half-cloned.
 */
export const baseDriveFilled = (api: VercelSandboxApi, of: BaseDriveOf) =>
  Effect.map(
    Effect.all([api.getDrive(baseDriveName(of)), api.getNamed(baseDriveName(of))], {
      concurrency: "unbounded",
    }),
    ([drive, filling]) => drive !== undefined && filling === undefined,
  );

/** The dependencies installed in the checkout the sandbox holds, or the refusal in the installer's own words: a fill's, and an agent's on its fork, which installs only what changed since. */
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

/**
 * The workspace's repository's base drive filled, where it has none: its
 * staging drive created, a sandbox opened from the agents' image with it
 * mounted at the workspace, whatever an earlier fill left on it cleared
 * (`CLEAR_SCRIPT`), the default branch cloned whole onto it through
 * the token at the firewall for the clone alone, its dependencies installed,
 * the sandbox stopped, the staging drive forked under the base drive's name,
 * and the sandbox and the staging drive deleted. A sandbox name another
 * launch took first is that launch's fill, and this one does nothing; a
 * base drive another fill finished before this one's sandbox stood has this
 * one undo what it made, as a failed fill does. A fill
 * that failed or outlasted `FILL_TIMEOUT` stops its sandbox, deletes the
 * staging drive, and deletes the sandbox; one whose sandbox was never
 * created deletes the staging drive. A staging drive left once the base
 * drive stands is said in the log and let be, since the base drive is whole;
 * a fill's sandbox left beside it is deleted by the next fill.
 * `open` is the sandbox as the clone reaches it, over the caller's runner.
 */
export const fillBaseDrive = Effect.fn("web/fillBaseDrive")(function* (
  api: VercelSandboxApi,
  of: BaseDriveOf,
  image: string,
  credential: BaseDriveCredential,
  open: (sandbox: { readonly name: string; readonly running: string }) => RepositorySandbox,
) {
  const name = baseDriveName(of);
  if ((yield* api.getDrive(name)) !== undefined) {
    // Note that a fill's sandbox beside a base drive that stands is one whose delete failed after the fork, which keeps the drive from reading as filled, so it goes here.
    if ((yield* api.getNamed(name)) !== undefined) yield* Effect.ignore(api.deleteSandbox(name));
    return;
  }
  const staging = stagingDriveName(name);
  yield* api.getOrCreateDrive(staging);
  // Note that a name another launch took first is that launch's fill, whose drive this one leaves be.
  const created = yield* api
    .create({
      name,
      image,
      tags: {},
      timeoutMs: Duration.toMillis(BASE_DRIVE.FILL_TIMEOUT),
      vcpus: CODER.SANDBOX_VCPUS,
      // Note that no expiration is sent, because Vercel refuses one as short as the fill, and a sandbox that is not persistent takes no snapshot to expire.
      keepLastSnapshots: { count: 1, deleteEvicted: true },
      env: {},
      mounts: { [BASE_DRIVE.MOUNT_PATH]: staging },
      persistent: false,
    })
    .pipe(
      Effect.map(Option.some),
      Effect.catchIf(
        (failure) => failure.status === CONFLICT_STATUS,
        () => Effect.succeed(Option.none<OpenedSandbox>()),
      ),
      Effect.tapError(() => Effect.ignore(api.deleteDrive(staging))),
    );
  if (Option.isNone(created)) return;
  const running = created.value.currentSessionId;
  // Note that the stop goes first, because Vercel refuses to delete a drive still mounted.
  const stopped = Effect.flatMap(api.session({ name, sessionId: running }), (session) =>
    session.stop(),
  );
  const undone = Effect.forEach(
    [stopped, api.deleteDrive(staging), api.deleteSandbox(name)],
    (step) => Effect.ignore(step),
    { discard: true },
  );
  // Note that a fill which finished between this one's look for the base drive and its sandbox made the drive already, so this one undoes what it made.
  if ((yield* api.getDrive(name)) !== undefined) return yield* undone;
  yield* Effect.gen(function* () {
    const sandbox = open({ name, running });
    // Note that what a failed fill left is cleared, or the clone would keep its checkout and the install build on it.
    const cleared = yield* runInSandbox(
      sandbox,
      { command: CLEAR_SCRIPT, workingDirectory: BASE_DRIVE.MOUNT_PATH },
      REPOSITORY_REFUSAL.CHECKOUT_FAILED,
    );
    if (cleared.exitCode !== 0) {
      return yield* new RepositoryRefusal({
        reason: REPOSITORY_REFUSAL.CHECKOUT_FAILED,
        detail: "the staging drive could not be cleared",
      });
    }
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
    yield* stopped;
    yield* api.forkDrive(staging, name);
    yield* api.deleteSandbox(name);
    yield* Effect.logInfo(`the base drive ${name} is filled`);
  }).pipe(
    Effect.timeoutOrElse({
      duration: BASE_DRIVE.FILL_TIMEOUT,
      orElse: () => Effect.fail(new SandboxUnavailable({ detail: "the fill timed out" })),
    }),
    Effect.tapError(() => undone),
  );
  yield* api
    .deleteDrive(staging)
    .pipe(
      Effect.catch(() =>
        Effect.logWarning(`the base drive ${name}'s staging drive was not deleted`),
      ),
    );
});
