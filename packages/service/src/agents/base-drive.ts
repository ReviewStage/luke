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
 * image's snapshot with the drive mounted read-write at the workspace, the
 * repository cloned through the token at the firewall for the clone alone,
 * so nothing on the drive carries a credential, the dependencies installed
 * with the package manager the checkout's lockfile names, and the sandbox
 * stopped, which lets the drive go, and then deleted, since a stopped sandbox
 * still holds its name. It is filled once and never refreshed: each agent
 * fetches its own branch onto its fork and installs again there, which fills
 * in only what changed. A fill that failed stops its sandbox, deletes the
 * drive, and deletes the sandbox, so it leaves no base drive, and agents
 * clone as they would without one.
 */

import { createHash } from "node:crypto";
import { Duration, Effect, Option } from "effect";
import { CODER } from "./coder-host/bounds.js";
import { REPOSITORY_SANDBOX_CONTRACT } from "./repository-sandbox-contract.js";
import {
  cloneRepository,
  REPOSITORY_REFUSAL,
  RepositoryRefusal,
  type RepositorySandbox,
  runInSandbox,
  snapshotRecordOf,
} from "./repository-shell.js";
import type { RepositorySnapshotCredential } from "./repository-snapshot.js";
import {
  NAME_TAKEN,
  type OpenedSandbox,
  SandboxUnavailable,
  type VercelSandboxApi,
} from "./vercel-sandbox-api.js";

export const BASE_DRIVE = {
  /** Every base drive, and the sandbox that fills it, is named with this, its digest after it. */
  NAME_PREFIX: "agent-base-",
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
 * and nothing in a repository that has neither, which has none to install.
 */
const INSTALL_SCRIPT = [
  "set -e",
  "if [ -f pnpm-lock.yaml ]; then pnpm install; elif [ -f package.json ]; then npm install; fi",
].join("\n");

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

/** The dependencies installed in the checkout the sandbox holds, or the refusal in the installer's own words. */
const installDependencies = Effect.fn("web/installBaseDriveDependencies")(function* (
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
 * The workspace's repository's base drive filled, where it has none: the
 * drive created, a sandbox opened from the agents' image with it mounted
 * at the workspace, the default branch cloned whole onto it through the
 * token at the firewall for the clone alone, its dependencies installed, and
 * the sandbox stopped and deleted. A sandbox name another launch took first
 * is that launch's fill, and this one does nothing. A fill that failed or
 * outlasted `FILL_TIMEOUT` stops its sandbox, deletes the drive, and deletes
 * the sandbox; one whose sandbox was never created deletes the drive. `open`
 * is the sandbox as the clone reaches it, over the caller's runner.
 */
export const fillBaseDrive = Effect.fn("web/fillBaseDrive")(function* (
  api: VercelSandboxApi,
  of: BaseDriveOf,
  image: string,
  credential: RepositorySnapshotCredential,
  open: (sandbox: { readonly name: string; readonly running: string }) => RepositorySandbox,
) {
  const name = baseDriveName(of);
  if ((yield* api.getDrive(name)) !== undefined) return;
  yield* api.getOrCreateDrive(name);
  // Note that a name another launch took first is that launch's fill, whose drive this one leaves be.
  const created = yield* api
    .create({
      name,
      from: { image },
      tags: {},
      timeoutMs: Duration.toMillis(BASE_DRIVE.FILL_TIMEOUT),
      vcpus: CODER.SANDBOX_VCPUS,
      keepLastSnapshots: {
        count: 1,
        expiration: Duration.toMillis(BASE_DRIVE.FILL_TIMEOUT),
        deleteEvicted: true,
      },
      env: {},
      mounts: { [BASE_DRIVE.MOUNT_PATH]: name },
      persistent: false,
      // Note that a name another fill holds is refused, because it is this fill's lock.
      whenNameTaken: NAME_TAKEN.REFUSE,
    })
    .pipe(
      Effect.map(Option.some),
      Effect.catchIf(
        (failure) => failure.status === CONFLICT_STATUS,
        () => Effect.succeed(Option.none<OpenedSandbox>()),
      ),
      Effect.tapError(() => Effect.ignore(api.deleteDrive(name))),
    );
  if (Option.isNone(created)) return;
  const running = created.value.currentSessionId;
  // Note that the stop goes first, because Vercel refuses to delete a drive still mounted.
  const stopped = Effect.flatMap(api.session({ name, sessionId: running }), (session) =>
    session.stop(),
  );
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
    yield* stopped;
    yield* api.deleteSandbox(name);
    yield* Effect.logInfo(`the base drive ${name} is filled`);
  }).pipe(
    Effect.timeoutOrElse({
      duration: BASE_DRIVE.FILL_TIMEOUT,
      orElse: () => Effect.fail(new SandboxUnavailable({ detail: "the fill timed out" })),
    }),
    Effect.tapError(() =>
      Effect.forEach(
        [stopped, api.deleteDrive(name), api.deleteSandbox(name)],
        (step) => Effect.ignore(step),
        { discard: true },
      ),
    ),
  );
});
