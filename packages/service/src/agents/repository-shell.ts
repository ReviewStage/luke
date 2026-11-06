import {
  CHECKOUT_IDENTITY_SCRIPT,
  type CheckoutIdentity,
  checkoutIdentityEnv,
} from "@repo/features/checkout-identity";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { Data, Duration, Effect, type Redacted } from "effect";
import type { GitHubTokenAccess } from "../github/github-app.js";
import { DEEPEN_STEP, REPOSITORY_SANDBOX_CONTRACT } from "./repository-sandbox-contract.js";
import type { FirewallSources } from "./sandbox-firewall.js";
import { LINK_SANDBOX_STATE_FOLDER, SANDBOX_STATE_FOLDER } from "./sandbox-state-folder.js";
import type { SandboxUnavailable } from "./vercel-sandbox-api.js";

export const REPOSITORY_REFUSAL = {
  NO_REPOSITORY:
    "this task has no repository yet; the developer picks one in the app. " +
    "Nothing of the code has been read.",
  NOT_REACHABLE:
    "the task's repository is not reachable through the GitHub installation connected to the task's workspace: " +
    "the App may have been removed from it, or the workspace's GitHub disconnected. " +
    "The developer picks a reachable repository in the app. Nothing of the code has been read.",
  GITHUB_UNAVAILABLE:
    "GitHub could not be read to confirm the repository. The call may be made again.",
  SANDBOX_UNAVAILABLE: "the sandbox could not be opened. The call may be made again.",
  NO_FIREWALL:
    "the sandbox cannot carry the repository's credential, so the repository could " +
    "not be checked out.",
  CHECKOUT_FAILED: "the repository could not be checked out. The call may be made again.",
} as const;

const REPOSITORY_SHELL_BOUNDS = {
  CHECKOUT_TIMEOUT: Duration.minutes(5),
  CHECKOUT_ERROR_MAX_CHARS: 500,
} as const;

const { PATH: SANDBOX_PATH, VARIABLE: SANDBOX_VARIABLE } = REPOSITORY_SANDBOX_CONTRACT;

const GITHUB_HOST = "github.com";

const COMMAND_ENVIRONMENT = {
  PAGER: "cat",
  GIT_PAGER: "cat",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
  TERM: "dumb",
} as const;

const CHECKOUT_SCRIPT = [
  "set -e",
  LINK_SANDBOX_STATE_FOLDER,
  `if [ "$(cat ${SANDBOX_PATH.CHECKOUT_RECORD} 2>/dev/null)" != "$${SANDBOX_VARIABLE.REPOSITORY}" ]; then rm -rf repository; fi`,
  'partial="repository.$$"',
  'rm -rf "$partial"',
  `if ! git clone --quiet \${${SANDBOX_VARIABLE.DEPTH}:+--depth "$${SANDBOX_VARIABLE.DEPTH}"} --single-branch --branch "$${SANDBOX_VARIABLE.BRANCH}" "$${SANDBOX_VARIABLE.URL}" "$partial"; then`,
  `  head="$(git ls-remote "$${SANDBOX_VARIABLE.URL}" HEAD)"`,
  '  test -z "$head"',
  '  rm -rf "$partial"',
  `  git clone --quiet "$${SANDBOX_VARIABLE.URL}" "$partial"`,
  `  git -C "$partial" symbolic-ref HEAD "refs/heads/$${SANDBOX_VARIABLE.BRANCH}"`,
  "fi",
  'if [ -d repository ]; then rm -rf "$partial"; else mv "$partial" repository; fi',
  `mkdir -p ${SANDBOX_STATE_FOLDER}`,
  `printf '%s' "$${SANDBOX_VARIABLE.REPOSITORY}" > ${SANDBOX_PATH.CHECKOUT_RECORD}`,
].join("\n");

const EXTRA_CHECKOUT_SCRIPT = [
  "set -e",
  `folder="$${SANDBOX_VARIABLE.FOLDER}"`,
  'if [ -d "$folder/.git" ]; then exit 0; fi',
  'partial="$folder.$$"',
  'rm -rf "$partial"',
  `if ! git clone --quiet --single-branch --branch "$${SANDBOX_VARIABLE.BRANCH}" "$${SANDBOX_VARIABLE.URL}" "$partial"; then`,
  `  head="$(git ls-remote "$${SANDBOX_VARIABLE.URL}" HEAD)"`,
  '  test -z "$head"',
  '  rm -rf "$partial"',
  `  git clone --quiet "$${SANDBOX_VARIABLE.URL}" "$partial"`,
  `  git -C "$partial" symbolic-ref HEAD "refs/heads/$${SANDBOX_VARIABLE.BRANCH}"`,
  "fi",
  'rm -rf "$folder"',
  'mv "$partial" "$folder"',
].join("\n");

const REFRESH_SCRIPT = [
  "set -e",
  LINK_SANDBOX_STATE_FOLDER,
  "test -d repository/.git",
  `test "$(cat ${SANDBOX_PATH.CHECKOUT_RECORD} 2>/dev/null)" = "$${SANDBOX_VARIABLE.REFRESH}"`,
  "cd repository",
  `if git fetch --quiet origin "$${SANDBOX_VARIABLE.BRANCH}"; then`,
  `  git checkout --quiet -B "$${SANDBOX_VARIABLE.BRANCH}" FETCH_HEAD`,
  "else",
  "  if git rev-parse --quiet --verify HEAD >/dev/null; then exit 1; fi",
  '  head="$(git ls-remote origin HEAD)"',
  '  test -z "$head"',
  "fi",
  "cd ..",
  `printf '%s' "$${SANDBOX_VARIABLE.REPOSITORY}" > ${SANDBOX_PATH.CHECKOUT_RECORD}`,
].join("\n");

const DEEPEN_LOCK_WAIT_SECONDS = 120;

const DEEPEN_SCRIPT = [
  "set -e",
  LINK_SANDBOX_STATE_FOLDER,
  `mkdir -p ${SANDBOX_STATE_FOLDER}`,
  `lock=${SANDBOX_STATE_FOLDER}/deepening`,
  "waited=0",
  `until mkdir "$lock" 2>/dev/null; do waited=$((waited + 1)); [ "$waited" -le ${DEEPEN_LOCK_WAIT_SECONDS} ] || break; sleep 1; done`,
  `trap 'rmdir "$lock" 2>/dev/null || true' EXIT`,
  "cd repository",
  `if [ "$(git rev-parse --is-shallow-repository)" = true ]; then git fetch --quiet --unshallow; fi`,
].join("\n");

export interface RepositoryFirewall {
  readonly write: (sources: FirewallSources) => Effect.Effect<void, SandboxUnavailable>;
}

export interface SandboxRunOptions {
  readonly command: string;
  readonly workingDirectory?: string;
  readonly env?: Record<string, string>;
}

export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface RepositorySandbox {
  readonly run: (options: SandboxRunOptions) => PromiseLike<CommandResult>;
  readonly firewall?: RepositoryFirewall;
}

export class RepositoryRefusal extends Data.TaggedError("RepositoryRefusal")<{
  readonly reason: string;
  readonly detail?: string | undefined;
}> {}

export const SHALLOW_CLONE_DEPTH = "1";

export interface CheckoutRepository {
  readonly fullName: string;
  readonly defaultBranch: string;
  readonly recordedAs?: string;
}

export interface CheckoutDepth {
  readonly depth?: string;
  readonly access?: GitHubTokenAccess;
}

function cloneUrl(repository: string): string {
  return `https://${GITHUB_HOST}/${repository}.git`;
}

function gitRefusal(failed: CommandResult): RepositoryRefusal {
  const detail = failed.stderr.trim().slice(0, REPOSITORY_SHELL_BOUNDS.CHECKOUT_ERROR_MAX_CHARS);
  return new RepositoryRefusal({
    reason:
      detail === ""
        ? REPOSITORY_REFUSAL.CHECKOUT_FAILED
        : `${REPOSITORY_REFUSAL.CHECKOUT_FAILED} git said: ${detail}`,
  });
}

export function runInSandbox(
  sandbox: RepositorySandbox,
  options: SandboxRunOptions,
  refusal: string,
) {
  return Effect.tryPromise({
    try: () => sandbox.run(options),
    catch: (thrown) =>
      new RepositoryRefusal({
        reason: refusal,
        ...(thrown instanceof Error ? { detail: thrown.message } : undefined),
      }),
  });
}

const underCloneCredential = /* @__PURE__ */ Effect.fn("web/underCloneCredential")(function* (
  sandbox: RepositorySandbox,
  fullName: string,
  token: Redacted.Redacted,
  access: GitHubTokenAccess,
  run: Effect.Effect<CommandResult, RepositoryRefusal>,
): Effect.fn.Return<void, RepositoryRefusal> {
  const firewall = sandbox.firewall;
  if (firewall === undefined)
    return yield* new RepositoryRefusal({ reason: REPOSITORY_REFUSAL.NO_FIREWALL });
  const refused = () => new RepositoryRefusal({ reason: REPOSITORY_REFUSAL.CHECKOUT_FAILED });
  const timed = run.pipe(
    Effect.timeoutOrElse({
      duration: REPOSITORY_SHELL_BOUNDS.CHECKOUT_TIMEOUT,
      orElse: () => new RepositoryRefusal({ reason: REPOSITORY_REFUSAL.CHECKOUT_FAILED }),
    }),
  );
  const withdrawn = firewall.write({}).pipe(Effect.mapError(refused));
  const ended = yield* firewall.write({ clone: { fullName, token, access } }).pipe(
    Effect.mapError(refused),
    Effect.andThen(timed),
    Effect.onInterrupt(() => Effect.ignore(withdrawn)),
    Effect.exit,
  );
  yield* withdrawn;
  const ran = yield* ended;
  if (ran.exitCode !== 0) return yield* gitRefusal(ran);
});

export const cloneRepository = /* @__PURE__ */ Effect.fn("web/cloneRepository")(function* (
  sandbox: RepositorySandbox,
  confirmed: CheckoutRepository,
  token: Redacted.Redacted,
  { depth, access = { kind: GITHUB_ACCESS.APP } }: CheckoutDepth = {},
): Effect.fn.Return<void, RepositoryRefusal> {
  const clone = runInSandbox(
    sandbox,
    {
      command: CHECKOUT_SCRIPT,
      workingDirectory: SANDBOX_PATH.WORKSPACE,
      env: {
        ...COMMAND_ENVIRONMENT,
        [SANDBOX_VARIABLE.REPOSITORY]: confirmed.recordedAs ?? confirmed.fullName,
        [SANDBOX_VARIABLE.BRANCH]: confirmed.defaultBranch,
        [SANDBOX_VARIABLE.URL]: cloneUrl(confirmed.fullName),
        ...(depth === undefined ? undefined : { [SANDBOX_VARIABLE.DEPTH]: depth }),
      },
    },
    REPOSITORY_REFUSAL.CHECKOUT_FAILED,
  );
  yield* underCloneCredential(sandbox, confirmed.fullName, token, access, clone);
});

export const cloneExtraRepository = /* @__PURE__ */ Effect.fn("web/cloneExtraRepository")(
  function* (
    sandbox: RepositorySandbox,
    confirmed: { readonly fullName: string; readonly branch: string; readonly folder: string },
    token: Redacted.Redacted,
    access: GitHubTokenAccess,
  ): Effect.fn.Return<void, RepositoryRefusal> {
    const clone = runInSandbox(
      sandbox,
      {
        command: EXTRA_CHECKOUT_SCRIPT,
        workingDirectory: SANDBOX_PATH.WORKSPACE,
        env: {
          ...COMMAND_ENVIRONMENT,
          [SANDBOX_VARIABLE.FOLDER]: confirmed.folder,
          [SANDBOX_VARIABLE.BRANCH]: confirmed.branch,
          [SANDBOX_VARIABLE.URL]: cloneUrl(confirmed.fullName),
        },
      },
      REPOSITORY_REFUSAL.CHECKOUT_FAILED,
    );
    yield* underCloneCredential(sandbox, confirmed.fullName, token, access, clone);
  },
);

export function snapshotRecordOf(fullName: string): string {
  return fullName.toLowerCase();
}

export const refreshRepository = /* @__PURE__ */ Effect.fn("web/refreshRepository")(function* (
  sandbox: RepositorySandbox,
  confirmed: CheckoutRepository,
  token: Redacted.Redacted,
  access: GitHubTokenAccess = { kind: GITHUB_ACCESS.APP },
): Effect.fn.Return<void, RepositoryRefusal> {
  const refresh = runInSandbox(
    sandbox,
    {
      command: REFRESH_SCRIPT,
      workingDirectory: SANDBOX_PATH.WORKSPACE,
      env: {
        ...COMMAND_ENVIRONMENT,
        [SANDBOX_VARIABLE.REFRESH]: snapshotRecordOf(confirmed.fullName),
        [SANDBOX_VARIABLE.REPOSITORY]: confirmed.recordedAs ?? confirmed.fullName,
        [SANDBOX_VARIABLE.BRANCH]: confirmed.defaultBranch,
      },
    },
    REPOSITORY_REFUSAL.CHECKOUT_FAILED,
  );
  yield* underCloneCredential(sandbox, confirmed.fullName, token, access, refresh);
});

function deepenStep(
  sandbox: RepositorySandbox,
  command: string,
  step: (typeof DEEPEN_STEP)[keyof typeof DEEPEN_STEP],
) {
  return runInSandbox(
    sandbox,
    {
      command,
      workingDirectory: SANDBOX_PATH.WORKSPACE,
      env: { ...COMMAND_ENVIRONMENT, [SANDBOX_VARIABLE.DEEPEN]: step },
    },
    REPOSITORY_REFUSAL.CHECKOUT_FAILED,
  );
}

export const deepenRepository = /* @__PURE__ */ Effect.fn("web/deepenRepository")(function* (
  sandbox: RepositorySandbox,
): Effect.fn.Return<void, RepositoryRefusal> {
  const fetched = yield* deepenStep(sandbox, DEEPEN_SCRIPT, DEEPEN_STEP.FETCH).pipe(
    Effect.timeoutOrElse({
      duration: REPOSITORY_SHELL_BOUNDS.CHECKOUT_TIMEOUT,
      orElse: () => new RepositoryRefusal({ reason: REPOSITORY_REFUSAL.CHECKOUT_FAILED }),
    }),
  );
  if (fetched.exitCode !== 0) return yield* gitRefusal(fetched);
});

export const setCheckoutIdentity = /* @__PURE__ */ Effect.fn("web/setCheckoutIdentity")(function* (
  sandbox: RepositorySandbox,
  identity: CheckoutIdentity,
): Effect.fn.Return<void, RepositoryRefusal> {
  const set = yield* runInSandbox(
    sandbox,
    {
      command: CHECKOUT_IDENTITY_SCRIPT,
      workingDirectory: SANDBOX_PATH.CHECKOUT,
      env: { ...COMMAND_ENVIRONMENT, ...checkoutIdentityEnv(identity) },
    },
    REPOSITORY_REFUSAL.CHECKOUT_FAILED,
  );
  if (set.exitCode !== 0) return yield* gitRefusal(set);
});

export interface CheckedOutSandbox {
  readonly sandbox: RepositorySandbox;
  readonly repository: string;
}
