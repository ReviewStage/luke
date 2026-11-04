import {
  CHECKOUT_IDENTITY_SCRIPT,
  type CheckoutIdentity,
  checkoutIdentityEnv,
} from "@repo/features/checkout-identity";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { Data, Duration, Effect, type Redacted } from "effect";
import type { SandboxSession } from "eve/sandbox";
import type { GitHubTokenAccess } from "../github/github-app.js";
import { DEEPEN_STEP, REPOSITORY_SANDBOX_CONTRACT } from "./repository-sandbox-contract.js";
import {
  cloneEntry,
  FIREWALL_SLOT,
  type FirewallEntry,
  type FirewallSlot,
} from "./sandbox-firewall.js";
import { LINK_SANDBOX_STATE_FOLDER, SANDBOX_STATE_FOLDER } from "./sandbox-state-folder.js";
import type { SandboxUnavailable } from "./vercel-sandbox-api.js";

/**
 * repository-shell.ts -- an agent's checkout of the task's GitHub repository in its session's sandbox: the clone, its deepening, and the commit identity set in it.
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
 * The checkout: a clone of the one branch, as deep as the depth variable
 * says and whole where it says nothing, into a directory of this call's
 * own, moved into place once whole. Note that a checkout
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

/**
 * A whole checkout a repository snapshot holds (`repository-snapshot.ts`)
 * brought up to its branch as GitHub has it now: the branch fetched through
 * the credential the caller set at the firewall and checked out at what was
 * fetched, and the record rewritten under the name the caller keeps. Note
 * that a checkout that is missing, or whose record names another repository
 * than the refresh variable, exits before any fetch, so a sandbox opened
 * from the wrong snapshot never reads GitHub on it; and that the empty
 * checkout of a repository with no commits yet, whose remote still names no
 * HEAD, is already as GitHub has it, so its fetch of no branch is no failure.
 */
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

/** How long a deepen waits on another deepen of the same checkout before it goes ahead, in seconds. */
const DEEPEN_LOCK_WAIT_SECONDS = 120;

/**
 * The rest of a shallow checkout's history fetched, from the workspace
 * root, through the credential the caller set at the firewall. Note that
 * two first writes of one session may deepen at once, so the fetch runs
 * under a lock of its own and asks again under it, so the second finds the
 * history whole and fetches nothing; and that a lock a stopped sandbox left
 * standing is waited on for a bounded while and then taken over, so no
 * deepen waits forever.
 */
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

/**
 * The firewall of the sandbox session a checkout runs in, bound to the
 * session and its account: an entry set in its slot, or withdrawn, the
 * whole policy composed from what stands (`sandbox-firewall.ts`).
 */
export interface RepositoryFirewall {
  readonly set: (
    slot: FirewallSlot,
    entry: FirewallEntry,
  ) => Effect.Effect<void, SandboxUnavailable>;
  readonly withdraw: (slot: FirewallSlot) => Effect.Effect<void, SandboxUnavailable>;
}

/**
 * The sandbox as the shell reaches it: one command run, and, where the
 * provider has a firewall, that firewall. eve's common handle declares no
 * firewall, and a Vercel Sandbox's has one; a sandbox with none cannot
 * carry the checkout's credential and checks nothing out.
 */
export interface RepositorySandbox {
  readonly run: SandboxSession["run"];
  readonly firewall?: RepositoryFirewall;
}

/** What a command answered: its exit code and its two outputs, each cut to the bound. */
interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Why the checkout could not be reached or read, as the reason the tool that asked words for the model; a coding agent's checkout answers the same word. */
export class RepositoryRefusal extends Data.TaggedError("RepositoryRefusal")<{
  readonly reason: string;
  /** What a run that threw said, in its own words, for the log and a turn's record alone, never the model; none where it threw no error. */
  readonly detail?: string | undefined;
}> {}

/** A shallow checkout is one commit deep: a coding agent's until its first write deepens it. */
export const SHALLOW_CLONE_DEPTH = "1";

/** A repository as the checkout clones it: the full name as GitHub spells it, the branch the clone is of (the default branch, or a coding agent's start branch), and the name the checkout's record keeps where a caller spells it otherwise. */
export interface CheckoutRepository {
  readonly fullName: string;
  readonly defaultBranch: string;
  /** What the checkout record names, which the probe compares; GitHub's spelling when unsaid. */
  readonly recordedAs?: string;
}

/** How deep a checkout is cloned: one commit for a read, the whole history for a coding agent; and whose the token is. */
export interface CheckoutDepth {
  /** The commits kept; absent, every one. */
  readonly depth?: string;
  /** Whose the token is; absent, an installation token. */
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
  options: Parameters<SandboxSession["run"]>[0],
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
 * repository's own git endpoint alone (`cloneEntry`), in a slot of its own,
 * and the refusal for a git that failed. The token stands for the run
 * alone: its slot is withdrawn as the run ends, however it ended, and in a
 * finalizer, so an interrupted run leaves no credential of its own standing
 * either and no later command runs under it, while what else stands at the
 * firewall stays.
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
  yield* firewall
    .set(FIREWALL_SLOT.GITHUB_CLONE, cloneEntry(fullName, token, access))
    .pipe(Effect.mapError(refused));
  const ran = yield* Effect.ensuring(
    timed,
    Effect.ignore(firewall.withdraw(FIREWALL_SLOT.GITHUB_CLONE)),
  );
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

/**
 * What a repository snapshot's checkout records it is of: the repository as
 * GitHub spells it, lower-cased, so a snapshot and the refresh of it agree
 * whatever case a row spells the repository in.
 */
export function snapshotRecordOf(fullName: string): string {
  return fullName.toLowerCase();
}

/**
 * The checkout a repository snapshot holds brought up to the branch named,
 * with the token at the firewall for the fetch alone, as for a clone
 * (`underCloneCredential`), and recorded under the name the caller keeps;
 * refused, in git's own words where it said any, where the checkout is not
 * the snapshot's of that repository or the fetch failed.
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

/** One step of a deepen, run from the workspace root under the step's own mark (`DEEPEN_STEP`). */
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

/**
 * The rest of the standing checkout's history fetched, through the
 * credential the caller already set at the firewall, so a shallow checkout
 * holds its branch's whole history after, as one cloned whole would; one
 * already whole fetches nothing.
 */
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
