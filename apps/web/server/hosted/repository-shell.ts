import type { UnparsedWireValue } from "@sidecar/wire";
import { describeWire, readEither } from "@sidecar/wire/effect";
import { Data, Duration, Effect, Option, Redacted, Result, Schema } from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import type { SqlClient } from "effect/unstable/sql";
import type { SandboxSession } from "eve/sandbox";
import type { VercelSandboxSession } from "eve/sandbox/vercel";
import { GitHubApp } from "../github/github-app.js";
import type { PlanDocumentBinding } from "./plan-notes.js";

/**
 * repository-shell.ts -- the planning model's one source read: a shell command run in the planning session's sandbox, on a checkout of the plan's GitHub repository.
 *
 * The planning model runs here and so does the sandbox: eve opens one Vercel
 * Sandbox per planning session (`apps/web/eve/sandbox.ts`) and hands a tool
 * its door. The first call that finds no checkout of the plan's repository
 * makes one, at the repository's current default branch and one commit
 * deep, and later calls reuse it; a plan whose repository changed meanwhile
 * is checked out again. The checkout reads the repository through the Luke
 * GitHub App: the owner's reach is confirmed and a token minted for that one
 * repository with contents read (`github-app.ts`), and the token is set as a
 * header at the sandbox's firewall for the clone and withdrawn after it. It
 * never enters the sandbox's filesystem or environment, so no command, and
 * no output of one, can carry it. Every refusal answers `not-run` and says
 * why in words the model can act on, so nothing unread is ever described as
 * read.
 */

/** Why a call ran nothing, in words the model can act on. */
export const REPOSITORY_SHELL_REFUSAL = {
  UNREADABLE: "Not run: the arguments must be exactly `command`, one shell command.",
  NO_REPOSITORY:
    "Not run: this plan has no repository yet; the developer picks one in the app. " +
    "Nothing of the code has been read.",
  SIGN_IN_REQUIRED:
    "Not run: the developer must sign in with GitHub again before the repository can be read. " +
    "Nothing of the code has been read.",
  NOT_REACHABLE:
    "Not run: the plan's repository is not reachable for the developer through the Luke GitHub App: " +
    "the App may have been removed from it, or the developer's access revoked. " +
    "The developer picks a reachable repository in the app. Nothing of the code has been read.",
  GITHUB_UNAVAILABLE:
    "Not run: GitHub could not be read to confirm the repository. The call may be made again.",
  SANDBOX_UNAVAILABLE: "Not run: the sandbox could not be opened. The call may be made again.",
  NO_FIREWALL:
    "Not run: the sandbox cannot carry the repository's credential, so the repository could " +
    "not be checked out.",
  /** The checkout's own words follow this. */
  CHECKOUT_FAILED: "Not run: the repository could not be checked out. The call may be made again.",
} as const;

export const REPOSITORY_SHELL_STATUS = {
  RAN: "ran",
  NOT_RUN: "not-run",
} as const;

export const REPOSITORY_SHELL_BOUNDS = {
  /** The most characters of stdout or stderr one command's result carries. */
  OUTPUT_MAX_CHARS: 20_000,
  /** How long one command may run before it is killed, in seconds, so a command that never ends does not hold the turn. */
  COMMAND_TIMEOUT_SECONDS: 60,
  /** How long the checkout may take before it is given up on. */
  CHECKOUT_TIMEOUT: Duration.minutes(5),
  /** How many characters of the checkout's own error the model is told. */
  CHECKOUT_ERROR_MAX_CHARS: 500,
} as const;

/**
 * What the shell hands the sandbox, which is the whole of what a sandbox
 * sees of it: where the checkout stands and the file beside it naming
 * which repository it is of, and the variables each script reads, so
 * nothing of the repository's name or the model's command is spliced into
 * shell text. A test's sandbox double answers from this contract.
 */
export const REPOSITORY_SANDBOX_CONTRACT = {
  PATH: {
    WORKSPACE: "/workspace",
    CHECKOUT: "/workspace/repository",
    CHECKOUT_RECORD: ".luke/repository",
  },
  VARIABLE: {
    /** The repository the call is about, `owner/name`, read by the probe and the checkout. */
    REPOSITORY: "LUKE_REPOSITORY",
    /** The default branch the checkout is of. */
    BRANCH: "LUKE_BRANCH",
    /** The clone's URL, which carries no credential; its presence is what makes a run the checkout. */
    URL: "LUKE_CLONE_URL",
    /** How deep the clone is; unset, the whole history, which a coding agent's branch and pull request need. */
    DEPTH: "LUKE_CLONE_DEPTH",
    /** The model's command, which bash reads from the variable and never from shell text. */
    COMMAND: "LUKE_COMMAND",
  },
} as const;

const { PATH: SANDBOX_PATH, VARIABLE: SANDBOX_VARIABLE } = REPOSITORY_SANDBOX_CONTRACT;

const GITHUB_HOST = "github.com";

/** The firewall with nothing injected: eve's default open internet, which is what every command but the clone runs under. */
const OPEN_INTERNET = "allow-all";

/** The environment the checkout and every command see: no pager, git taking no lock and asking nothing. */
const COMMAND_ENVIRONMENT = {
  PAGER: "cat",
  GIT_PAGER: "cat",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
  TERM: "dumb",
} as const;

/**
 * The whole environment the model's command sees, as the Mac runner once
 * gave one: a search path and a home carried over from the sandbox's own,
 * the fixed values above, and nothing else the sandbox's process carries,
 * so `env` prints no variable of the sandbox's or eve's into a stored
 * result.
 */
const COMMAND_CLEAN_ENVIRONMENT = [
  'PATH="$PATH"',
  'HOME="$HOME"',
  'LANG="${LANG:-C.UTF-8}"',
  ...Object.entries(COMMAND_ENVIRONMENT).map(([name, value]) => `${name}=${value}`),
].join(" ");

/**
 * Whether the checkout standing is this repository's: exit 0 when the
 * checkout and its record both stand and the record names the repository
 * the variable carries.
 */
const CHECKED_OUT_SCRIPT = [
  `[ -d repository/.git ] || exit 1`,
  `[ "$(cat ${SANDBOX_PATH.CHECKOUT_RECORD} 2>/dev/null)" = "$${SANDBOX_VARIABLE.REPOSITORY}" ]`,
].join("\n");

/**
 * The checkout: a clone of the one branch, as deep as the depth variable
 * says and whole where it says nothing, into a directory of this call's
 * own, moved into place once whole. Note that a checkout
 * another call of the same session finished first is kept and this one's
 * dropped, so two first calls racing (the planning model's and its
 * worker's) end on one checkout; and that a checkout of another repository,
 * where the plan's changed, is removed first.
 */
const CHECKOUT_SCRIPT = [
  "set -e",
  `if [ "$(cat ${SANDBOX_PATH.CHECKOUT_RECORD} 2>/dev/null)" != "$${SANDBOX_VARIABLE.REPOSITORY}" ]; then rm -rf repository; fi`,
  'partial="repository.$$"',
  'rm -rf "$partial"',
  `git clone --quiet \${${SANDBOX_VARIABLE.DEPTH}:+--depth "$${SANDBOX_VARIABLE.DEPTH}"} --single-branch --branch "$${SANDBOX_VARIABLE.BRANCH}" "$${SANDBOX_VARIABLE.URL}" "$partial"`,
  'if [ -d repository ]; then rm -rf "$partial"; else mv "$partial" repository; fi',
  "mkdir -p .luke",
  `printf '%s' "$${SANDBOX_VARIABLE.REPOSITORY}" > ${SANDBOX_PATH.CHECKOUT_RECORD}`,
].join("\n");

/** The model's command, run by its own bash under the time bound and the clean environment, from the checkout root. Note that the variable is read by the outer bash, ahead of `env -i`, so the command reaches the inner bash as an argument and no variable. */
const COMMAND_SCRIPT = `timeout ${REPOSITORY_SHELL_BOUNDS.COMMAND_TIMEOUT_SECONDS}s env -i ${COMMAND_CLEAN_ENVIRONMENT} bash -c "$${SANDBOX_VARIABLE.COMMAND}"`;

/**
 * The sandbox as the shell reaches it: one command run, and, where the
 * provider has a firewall, its policy. eve's common handle declares no
 * firewall, and a Vercel Sandbox's answers one at runtime; a sandbox that
 * answers none cannot carry the checkout's credential and checks nothing out.
 */
export interface RepositorySandbox {
  readonly run: SandboxSession["run"];
  readonly setNetworkPolicy?: VercelSandboxSession["setNetworkPolicy"];
}

/** The door to the session's sandbox, opened on first use: eve's `ctx.getSandbox()`, or a test's double. */
export type RepositorySandboxDoor = () => Promise<RepositorySandbox>;

/** What one call runs under: the plan, the repository it names now, and the session's sandbox. */
export interface RepositoryCall {
  readonly plan: PlanDocumentBinding;
  /** The plan's repository as the row holds it, `owner/name`; null for a plan with none. */
  readonly repository: string | null;
  readonly sandbox: RepositorySandboxDoor;
}

/** What a command answered: its exit code and its two outputs, each cut to the bound. */
interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

// A type rather than an interface, so a result is a `WireRecord` the model is handed as it stands.
export type RepositoryShellResult =
  | ({ readonly status: typeof REPOSITORY_SHELL_STATUS.RAN } & CommandResult)
  | { readonly status: typeof REPOSITORY_SHELL_STATUS.NOT_RUN; readonly reason: string };

/** What the shell may reach: the store and GitHub for the checkout's confirmation and token. */
export type RepositoryShellServices = SqlClient.SqlClient | HttpClient.HttpClient | GitHubApp;

const RUN_IN_REPOSITORY_INPUT = Schema.Struct({
  command: describeWire(
    Schema.String.check(Schema.isMinLength(1)),
    'One bash command, run from the root of the repository checkout, such as "ls", ' +
      '"grep -rn invite src", or "cat package.json".',
  ),
});

const readInput = readEither(RUN_IN_REPOSITORY_INPUT);

/** The tool as a planning model is offered it: its name, its words, and its input schema. */
export const RUN_IN_REPOSITORY_TOOL = {
  name: "run_in_repository",
  description:
    "Run one bash command in a checkout of the plan's GitHub repository, from the checkout root. " +
    "Use it to read the code: ls, find, grep, cat, sed, git log. " +
    "The checkout is the repository's default branch, one commit deep, made on the first call " +
    "and kept for the conversation; it is meant for reading, and nothing written to it reaches " +
    "the repository. " +
    "Answers the exit code, stdout, and stderr, or `not-run` and why.",
  inputSchema: RUN_IN_REPOSITORY_INPUT,
} as const;

/** Why a step of the shell ran nothing, carried as the refusal the model reads; the coding agent's checkout answers the same word. */
export class ShellRefusal extends Data.TaggedError("ShellRefusal")<{ readonly reason: string }> {}

/** The planning checkout is one commit deep: it is read and never pushed from. */
const PLANNING_CLONE_DEPTH = "1";

/** A repository as the checkout clones it: the full name as GitHub spells it, the branch the clone is of, and the name the checkout's record keeps where a caller spells it otherwise. */
export interface CheckoutRepository {
  readonly fullName: string;
  readonly defaultBranch: string;
  /** What the checkout record names, which the probe compares; GitHub's spelling when unsaid. */
  readonly recordedAs?: string;
}

/** How deep a checkout is cloned: one commit for a read, the whole history for a coding agent. */
export interface CheckoutDepth {
  /** The commits kept; absent, every one. */
  readonly depth?: string;
}

function notRun(reason: string): RepositoryShellResult {
  return { status: REPOSITORY_SHELL_STATUS.NOT_RUN, reason };
}

function truncated(output: string): string {
  return output.slice(0, REPOSITORY_SHELL_BOUNDS.OUTPUT_MAX_CHARS);
}

/** The path every request of the clone is under: the repository's own git endpoint, which no other repository's path shares. */
function cloneUrl(repository: string): string {
  return `https://${GITHUB_HOST}/${repository}.git`;
}

/**
 * The firewall for the clone: open internet, and the token as GitHub's
 * header on requests under the one repository's git endpoint alone, so a
 * request for a neighbouring repository, or for the repository's pages
 * outside git, carries nothing.
 */
function cloneNetworkPolicy(repository: string, token: Redacted.Redacted) {
  const basic = Buffer.from(`x-access-token:${Redacted.value(token)}`).toString("base64");
  return {
    allow: {
      "*": [],
      [GITHUB_HOST]: [
        {
          match: { path: { startsWith: `/${repository}.git/` } },
          transform: [{ headers: { authorization: `Basic ${basic}` } }],
        },
      ],
    },
  };
}

/** One run in the sandbox as an effect; a run that threw is the sandbox gone, which is the refusal given. */
function runInSandbox(
  sandbox: RepositorySandbox,
  options: Parameters<SandboxSession["run"]>[0],
  refusal: string,
) {
  return Effect.tryPromise({
    try: () => sandbox.run(options),
    catch: () => new ShellRefusal({ reason: refusal }),
  });
}

/**
 * The clone made in the sandbox with the token at the firewall, or the
 * refusal that stopped it: what the planning checkout and a coding agent's
 * share. The token stands at the firewall for the clone alone: the policy is
 * set back to open internet as the clone ends, however it ended, so no later
 * command runs under it, and a caller that wants the token standing for its
 * own commands sets it again afterwards.
 */
export const cloneRepository = /* @__PURE__ */ Effect.fn("web/cloneRepository")(function* (
  sandbox: RepositorySandbox,
  confirmed: CheckoutRepository,
  token: Redacted.Redacted,
  { depth }: CheckoutDepth = {},
): Effect.fn.Return<void, ShellRefusal> {
  const setNetworkPolicy = sandbox.setNetworkPolicy;
  if (setNetworkPolicy === undefined)
    return yield* new ShellRefusal({ reason: REPOSITORY_SHELL_REFUSAL.NO_FIREWALL });
  const policy = (next: Parameters<typeof setNetworkPolicy>[0]) =>
    Effect.tryPromise({
      try: () => setNetworkPolicy(next),
      catch: () => new ShellRefusal({ reason: REPOSITORY_SHELL_REFUSAL.CHECKOUT_FAILED }),
    });
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
    REPOSITORY_SHELL_REFUSAL.CHECKOUT_FAILED,
  ).pipe(
    Effect.timeoutOrElse({
      duration: REPOSITORY_SHELL_BOUNDS.CHECKOUT_TIMEOUT,
      orElse: () => new ShellRefusal({ reason: REPOSITORY_SHELL_REFUSAL.CHECKOUT_FAILED }),
    }),
  );
  yield* policy(cloneNetworkPolicy(confirmed.fullName, token));
  // Note that the policy is opened again whatever the clone answered, and in
  // a finalizer, so an interrupted clone leaves no credential standing either.
  const cloned = yield* Effect.ensuring(clone, Effect.ignore(policy(OPEN_INTERNET)));
  if (cloned.exitCode !== 0) {
    const detail = cloned.stderr.trim().slice(0, REPOSITORY_SHELL_BOUNDS.CHECKOUT_ERROR_MAX_CHARS);
    return yield* new ShellRefusal({
      reason:
        detail === ""
          ? REPOSITORY_SHELL_REFUSAL.CHECKOUT_FAILED
          : `${REPOSITORY_SHELL_REFUSAL.CHECKOUT_FAILED} git said: ${detail}`,
    });
  }
});

/**
 * The planning checkout: the repository confirmed reachable and a read
 * token minted for it, then the clone, one commit deep. Note that the
 * repository is recorded under the name the plan holds, which is what the
 * checkout probe compares, so a plan whose spelling differs from GitHub's
 * is still checked out once.
 */
const checkOut = /* @__PURE__ */ Effect.fn("web/repositoryCheckOut")(function* (
  call: RepositoryCall,
  repository: string,
  sandbox: RepositorySandbox,
): Effect.fn.Return<void, ShellRefusal, RepositoryShellServices> {
  const app = yield* GitHubApp;
  const reached = yield* app
    .repositoryReadToken(call.plan.userId, repository)
    .pipe(
      Effect.mapError((failure) =>
        failure._tag === "GitHubSignInRequired"
          ? new ShellRefusal({ reason: REPOSITORY_SHELL_REFUSAL.SIGN_IN_REQUIRED })
          : new ShellRefusal({ reason: REPOSITORY_SHELL_REFUSAL.GITHUB_UNAVAILABLE }),
      ),
    );
  if (Option.isNone(reached))
    return yield* new ShellRefusal({ reason: REPOSITORY_SHELL_REFUSAL.NOT_REACHABLE });
  const { repository: confirmed, token } = reached.value;
  yield* cloneRepository(sandbox, { ...confirmed, recordedAs: repository }, token, {
    depth: PLANNING_CLONE_DEPTH,
  });
});

/**
 * One call of `run_in_repository`: the command run from the checkout root,
 * made first where none of this repository stands, and what it answered;
 * or `not-run` and why.
 */
export function runInRepository(
  call: RepositoryCall,
  input: UnparsedWireValue,
): Effect.Effect<RepositoryShellResult, never, RepositoryShellServices> {
  const ran = Effect.gen(function* () {
    const read = readInput(input);
    if (Result.isFailure(read)) return notRun(REPOSITORY_SHELL_REFUSAL.UNREADABLE);
    // The plan's repository is refused ahead of the sandbox, so a plan with none opens no sandbox.
    const repository = call.repository;
    if (repository === null) return notRun(REPOSITORY_SHELL_REFUSAL.NO_REPOSITORY);
    const sandbox = yield* Effect.tryPromise({
      try: () => call.sandbox(),
      catch: () => new ShellRefusal({ reason: REPOSITORY_SHELL_REFUSAL.SANDBOX_UNAVAILABLE }),
    });
    const standing = yield* runInSandbox(
      sandbox,
      {
        command: CHECKED_OUT_SCRIPT,
        workingDirectory: SANDBOX_PATH.WORKSPACE,
        env: { [SANDBOX_VARIABLE.REPOSITORY]: repository },
      },
      REPOSITORY_SHELL_REFUSAL.SANDBOX_UNAVAILABLE,
    );
    if (standing.exitCode !== 0) yield* checkOut(call, repository, sandbox);
    const result = yield* runInSandbox(
      sandbox,
      {
        command: COMMAND_SCRIPT,
        workingDirectory: SANDBOX_PATH.CHECKOUT,
        env: { ...COMMAND_ENVIRONMENT, [SANDBOX_VARIABLE.COMMAND]: read.success.command },
      },
      REPOSITORY_SHELL_REFUSAL.SANDBOX_UNAVAILABLE,
    );
    return {
      status: REPOSITORY_SHELL_STATUS.RAN,
      exitCode: result.exitCode,
      stdout: truncated(result.stdout),
      stderr: truncated(result.stderr),
    } satisfies RepositoryShellResult;
  });
  return Effect.catchTag(ran, "ShellRefusal", (refusal) => Effect.succeed(notRun(refusal.reason)));
}
