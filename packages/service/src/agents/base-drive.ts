import { createHash } from "node:crypto";
import { Duration, Effect, Option, type Redacted } from "effect";
import type { GitHubTokenAccess } from "../github/github-app.js";
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
import {
  NAME_TAKEN,
  type OpenedSandbox,
  SandboxUnavailable,
  type VercelSandboxApi,
} from "./vercel-sandbox-api.js";

export const BASE_DRIVE = {
  NAME_PREFIX: "agent-base-",
  MOUNT_PATH: REPOSITORY_SANDBOX_CONTRACT.PATH.WORKSPACE,
  FILL_TIMEOUT: Duration.minutes(10),
} as const;

const CONFLICT_STATUS = 409;

const INSTALL_ERROR_TAIL_CHARS = 500;

const INSTALL_SCRIPT = [
  "set -e",
  "if [ -f pnpm-lock.yaml ]; then pnpm install; elif [ -f package.json ]; then npm install; fi",
].join("\n");

interface BaseDriveCredential {
  readonly token: Redacted.Redacted;
  readonly access: GitHubTokenAccess;
}

export interface BaseDriveOf {
  readonly workspaceId: string;
  readonly fullName: string;
  readonly defaultBranch: string;
}

export function baseDriveName(of: BaseDriveOf): string {
  const digest = createHash("sha256");
  for (const field of [of.workspaceId, snapshotRecordOf(of.fullName)]) {
    digest.update(field).update("\0");
  }
  return `${BASE_DRIVE.NAME_PREFIX}${digest.digest("hex").slice(0, 32)}`;
}

export const baseDriveFilled = (api: VercelSandboxApi, of: BaseDriveOf) =>
  Effect.map(
    Effect.all([api.getDrive(baseDriveName(of)), api.getNamed(baseDriveName(of))], {
      concurrency: "unbounded",
    }),
    ([drive, filling]) => drive !== undefined && filling === undefined,
  );

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

export const fillBaseDrive = Effect.fn("web/fillBaseDrive")(function* (
  api: VercelSandboxApi,
  of: BaseDriveOf,
  image: string,
  credential: BaseDriveCredential,
  open: (sandbox: { readonly name: string; readonly running: string }) => RepositorySandbox,
) {
  const name = baseDriveName(of);
  if ((yield* api.getDrive(name)) !== undefined) return;
  yield* api.getOrCreateDrive(name);
  const created = yield* api
    .create({
      name,
      image,
      tags: {},
      timeoutMs: Duration.toMillis(BASE_DRIVE.FILL_TIMEOUT),
      vcpus: CODER.SANDBOX_VCPUS,
      keepLastSnapshots: { count: 1, deleteEvicted: true },
      env: {},
      mounts: { [BASE_DRIVE.MOUNT_PATH]: name },
      persistent: false,
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
