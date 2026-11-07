import {
  CHECKOUT_IDENTITY_SCRIPT,
  type CheckoutIdentity,
  checkoutIdentityEnv,
} from "@repo/features/checkout-identity";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { Data, Duration, Effect, type Redacted } from "effect";
import type { GitHubTokenAccess } from "../github/github-app.js";
import { REPOSITORY_SANDBOX_CONTRACT } from "./repository-sandbox-contract.js";
import type { FirewallSources } from "./sandbox-firewall.js";
import { LINK_SANDBOX_STATE_FOLDER, SANDBOX_STATE_FOLDER } from "./sandbox-state-folder.js";
import type { SandboxUnavailable } from "./vercel-sandbox-api.js";

/**
 * repository-shell.ts -- an agent's checkout of the task's GitHub repository in its session's sandbox: the clone, its refresh, and the commit identity set in it.
 *
 * A checkout reads the repository through our GitHub App, or the
 * member's own token: the token is set as a header at the sandbox's
 * firewall for the clone and withdrawn after it. It never enters the
 * sandbox's filesystem or environment, so no command, and no output of one,
 * can carry it. Every refusal says why in words the model can act on, so
 * nothing unread is ever described as read (`coder-host/checkout.ts`).
 */

/** Why the checkout could not be reached, in words the model can act on, without the verb each tool puts ahead of them. */
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
  /** The checkout's own words follow this. */
  CHECKOUT_FAILED: "the repository could not be checked out. The call may be made again.",
} as const;

const REPOSITORY_SHELL_BOUNDS = {
  /** How long the checkout may take before it is given up on. */
  CHECKOUT_TIMEOUT: Duration.minutes(5),
  /** How many characters of the checkout's own error the model is told. */
  CHECKOUT_ERROR_MAX_CHARS: 500,
} as const;

const { PATH: SANDBOX_PATH, VARIABLE: SANDBOX_VARIABLE } = REPOSITORY_SANDBOX_CONTRACT;

const GITHUB_HOST = "github.com";

/** The environment the checkout and every git run in it see: no pager, git taking no lock and asking nothing. */
const COMMAND_ENVIRONMENT = {
  PAGER: "cat",
  GIT_PAGER: "cat",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
  TERM: "dumb",
} as const;

/**
 * How every write of the checkout is made: group-writable, files and
 * folders alike. Note that this is because a coding agent's runner runs as
 * a user in the default user's group (`machine/vercel-machine.ts`), and
 * what the default user writes at its own umask, 0022, that user alone may
 * write; a clone shares its repository with the group too
 * (`core.sharedRepository`), so git keeps what it writes under `.git` so
 * whoever writes it.
 */
export const GROUP_WRITES = "umask 0002";

/** The clone's own config: its repository shared with the group (`GROUP_WRITES`). */
const SHARED_CLONE = "-c core.sharedRepository=group";

/**
 * The checkout: a whole clone of the one branch into a directory of this
 * call's own, its writes the group's (`GROUP_WRITES`), moved into place once
 * whole. Note that a checkout
 * another call of the same session finished first is kept and this one's
 * dropped, so two first calls racing (the brain's and its
 * worker's) end on one checkout; that a checkout of another repository,
 * where the task's changed, is removed first; and that a repository with no
 * commits yet has no branch to clone, so where the remote names no HEAD it
 * is cloned empty, its HEAD left on the branch asked for with nothing on it
 * yet, while a branch missing from a repository that has commits still fails
 * the clone in git's own words.
 */
const CHECKOUT_SCRIPT = [
  "set -e",
  GROUP_WRITES,
  LINK_SANDBOX_STATE_FOLDER,
  `if [ "$(cat ${SANDBOX_PATH.CHECKOUT_RECORD} 2>/dev/null)" != "$${SANDBOX_VARIABLE.REPOSITORY}" ]; then rm -rf repository; fi`,
  'partial="repository.$$"',
  'rm -rf "$partial"',
  `if ! git clone --quiet ${SHARED_CLONE} --single-branch --branch "$${SANDBOX_VARIABLE.BRANCH}" "$${SANDBOX_VARIABLE.URL}" "$partial"; then`,
  `  head="$(git ls-remote "$${SANDBOX_VARIABLE.URL}" HEAD)"`,
  '  test -z "$head"',
  '  rm -rf "$partial"',
  `  git clone --quiet ${SHARED_CLONE} "$${SANDBOX_VARIABLE.URL}" "$partial"`,
  `  git -C "$partial" symbolic-ref HEAD "refs/heads/$${SANDBOX_VARIABLE.BRANCH}"`,
  "fi",
  'if [ -d repository ]; then rm -rf "$partial"; else mv "$partial" repository; fi',
  `mkdir -p ${SANDBOX_STATE_FOLDER}`,
  `printf '%s' "$${SANDBOX_VARIABLE.REPOSITORY}" > ${SANDBOX_PATH.CHECKOUT_RECORD}`,
].join("\n");

/**
 * The checkout of a repository an agent works in beside its own: a whole
 * clone of the one branch into a directory of this call's own under the
 * workspace, moved to the folder named once whole, as the agent's own
 * checkout is cloned (`CHECKOUT_SCRIPT`), its writes the group's, and a
 * repository with no commits yet cloned empty the same way. Note that a folder already holding a checkout
 * is kept, so a clone run again on a sandbox that holds it clones nothing.
 */
const EXTRA_CHECKOUT_SCRIPT = [
  "set -e",
  GROUP_WRITES,
  `folder="$${SANDBOX_VARIABLE.FOLDER}"`,
  'if [ -d "$folder/.git" ]; then exit 0; fi',
  'partial="$folder.$$"',
  'rm -rf "$partial"',
  `if ! git clone --quiet ${SHARED_CLONE} --single-branch --branch "$${SANDBOX_VARIABLE.BRANCH}" "$${SANDBOX_VARIABLE.URL}" "$partial"; then`,
  `  head="$(git ls-remote "$${SANDBOX_VARIABLE.URL}" HEAD)"`,
  '  test -z "$head"',
  '  rm -rf "$partial"',
  `  git clone --quiet ${SHARED_CLONE} "$${SANDBOX_VARIABLE.URL}" "$partial"`,
  `  git -C "$partial" symbolic-ref HEAD "refs/heads/$${SANDBOX_VARIABLE.BRANCH}"`,
  "fi",
  'rm -rf "$folder"',
  'mv "$partial" "$folder"',
].join("\n");

/**
 * A whole checkout a fork of a base drive holds (`base-drive.ts`) brought
 * up to its branch as GitHub has it now: the branch fetched through
 * the credential the caller set at the firewall and checked out at what was
 * fetched, its writes the group's (`GROUP_WRITES`), and the record
 * rewritten under the name the caller keeps. Note
 * that a checkout that is missing, or whose record names another repository
 * than the refresh variable, exits before any fetch, so a drive forked from
 * the wrong base never reads GitHub on it; and that the empty
 * checkout of a repository with no commits yet, whose remote still names no
 * HEAD, is already as GitHub has it, so its fetch of no branch is no failure.
 */
const REFRESH_SCRIPT = [
  "set -e",
  GROUP_WRITES,
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

/**
 * The firewall of the sandbox session a checkout runs in, bound to the
 * session and its account, and to what stands there beside the checkout's
 * own: the session's whole policy composed from the sources given with
 * those, and sent (`sandbox-firewall.ts`).
 */
export interface RepositoryFirewall {
  readonly write: (sources: FirewallSources) => Effect.Effect<void, SandboxUnavailable>;
}

/** One command run in the sandbox: its line, and where and with what environment it runs. */
export interface SandboxRunOptions {
  readonly command: string;
  readonly workingDirectory?: string;
  readonly env?: Record<string, string>;
}

/** What a command answered: its exit code and its two outputs, each cut to the bound. */
export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * The sandbox as the shell reaches it: one command run, and, where the
 * provider has a firewall, that firewall; a sandbox with none cannot carry
 * the checkout's credential and checks nothing out.
 */
export interface RepositorySandbox {
  readonly run: (options: SandboxRunOptions) => PromiseLike<CommandResult>;
  readonly firewall?: RepositoryFirewall;
}

/** Why the checkout could not be reached or read, as the reason the tool that asked words for the model; a coding agent's checkout answers the same word. */
export class RepositoryRefusal extends Data.TaggedError("RepositoryRefusal")<{
  readonly reason: string;
  /** What a run that threw said, in its own words, for the log and a turn's record alone, never the model; none where it threw no error. */
  readonly detail?: string | undefined;
}> {}

/** A repository as the checkout clones it: the full name as GitHub spells it, the branch the clone is of (the default branch, or a coding agent's start branch), and the name the checkout's record keeps where a caller spells it otherwise. */
export interface CheckoutRepository {
  readonly fullName: string;
  readonly defaultBranch: string;
  /** What the checkout record names, which the probe compares; GitHub's spelling when unsaid. */
  readonly recordedAs?: string;
}

/** Whose the token a checkout is cloned through is: absent, an installation token. */
interface CloneAccess {
  readonly access?: GitHubTokenAccess;
}

/** The path every request of the clone is under: the repository's own git endpoint, which no other repository's path shares. */
function cloneUrl(repository: string): string {
  return `https://${GITHUB_HOST}/${repository}.git`;
}

/** A git run in the checkout that failed, refused with as much of git's own word as the model is told. */
function gitRefusal(failed: CommandResult): RepositoryRefusal {
  const detail = failed.stderr.trim().slice(0, REPOSITORY_SHELL_BOUNDS.CHECKOUT_ERROR_MAX_CHARS);
  return new RepositoryRefusal({
    reason:
      detail === ""
        ? REPOSITORY_REFUSAL.CHECKOUT_FAILED
        : `${REPOSITORY_REFUSAL.CHECKOUT_FAILED} git said: ${detail}`,
  });
}

/** One run in the sandbox as an effect; a run that threw is the sandbox gone, which is the refusal given, with what it threw. */
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

/**
 * A run of git's against GitHub with the token at the firewall, for the
 * repository's own git endpoint alone, and the refusal for a git that
 * failed. The token stands for the run alone: the policy is written again
 * without it as the run ends, however it ended, an interrupted run's as it
 * is interrupted, so no later command runs under it, while what else stands
 * at the firewall stays. A write that failed refuses the checkout, because
 * the policy would otherwise carry the read token on past the run.
 */
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

/**
 * The clone made in the sandbox with the token at the firewall, or the
 * refusal that stopped it: what the brain's checkout and a coding agent's
 * share, the token standing for the clone alone (`underCloneCredential`).
 */
export const cloneRepository = /* @__PURE__ */ Effect.fn("web/cloneRepository")(function* (
  sandbox: RepositorySandbox,
  confirmed: CheckoutRepository,
  token: Redacted.Redacted,
  { access = { kind: GITHUB_ACCESS.APP } }: CloneAccess = {},
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
      },
    },
    REPOSITORY_REFUSAL.CHECKOUT_FAILED,
  );
  yield* underCloneCredential(sandbox, confirmed.fullName, token, access, clone);
});

/**
 * A repository an agent works in beside its own cloned whole into the
 * folder named under the workspace, at the branch given, with the token at
 * the firewall for the clone alone (`underCloneCredential`), or the refusal
 * that stopped it. Nothing records it, since no probe reads it.
 */
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

/**
 * What a base drive's checkout records it is of: the repository as GitHub
 * spells it, lower-cased, so a base drive and the refresh of a fork of it agree
 * whatever case a row spells the repository in.
 */
export function snapshotRecordOf(fullName: string): string {
  return fullName.toLowerCase();
}

/**
 * The checkout a fork of a base drive holds brought up to the branch named,
 * with the token at the firewall for the fetch alone, as for a clone
 * (`underCloneCredential`), and recorded under the name the caller keeps;
 * refused, in git's own words where it said any, where the checkout is not
 * the base drive's of that repository or the fetch failed.
 */
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

/**
 * The commit identity set in the standing checkout's own config, never the
 * sandbox's global one, by the step a device's checkout sets it with too
 * (`CHECKOUT_IDENTITY_SCRIPT`): the developer's GitHub account or our
 * GitHub App's bot, as the coding agent's checkout settled it
 * (`coder-host/checkout.ts`), and the agent's instructions tell it to leave
 * it alone.
 */
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

/** The session's sandbox with a checkout standing in it, and which repository the checkout is of. */
export interface CheckedOutSandbox {
  readonly sandbox: RepositorySandbox;
  readonly repository: string;
}
